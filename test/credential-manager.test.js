import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createCredentialResolver, credentialTarget } from '../src/lib/credential-bindings.js';
import { LazyMcpManager, publicToolName, schemaHash } from '../src/lib/mcp-manager.js';
import { createSdkConnector } from '../src/lib/sdk-connector.js';

const tool = { name: 'echo', description: 'Harmless fixture operation', inputSchema: { type: 'object', properties: {} } };
const id = publicToolName('fixture', 'echo');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function agent() {
  const registered = new Map();
  return { registered, session: {}, ctx: { tools: { get: name => registered.get(name), register: definition => {
    assert.ok(!registered.has(definition.name)); registered.set(definition.name, definition);
    return () => { if (registered.get(definition.name) === definition) registered.delete(definition.name); };
  } } } };
}
function fixture(t, { connect, refs = true, enabled = true, extraServers = [], provider: initialProvider } = {}) {
  let value = 'synthetic-initial-token', reads = 0, connections = 0, closes = 0, calls = 0, cacheReads = 0, cacheWrites = 0;
  let provider = initialProvider ?? { resolve: async () => { reads++; return value === undefined ? undefined : { value }; } };
  const configs = [], callbacks = [];
  const server = { serverName: 'fixture', transport: 'streamable-http', url: 'https://example.invalid/mcp', enabled,
    ...(refs ? { headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } } } : {}) };
  const manager = new LazyMcpManager({ servers: [server, ...extraServers],
    resolveCredentials: createCredentialResolver(() => provider),
    cache: { read: async () => { cacheReads++; return null; }, write: async () => { cacheWrites++; } },
    connect: async (config, handlers) => {
      configs.push(config); callbacks.push(handlers); connections++;
      if (connect) return connect(config, handlers);
      return { instructions: '', listTools: async () => ({ tools: [tool] }),
        callTool: async () => { calls++; return { content: [{ type: 'text', text: 'ok' }] }; },
        close: async () => { closes++; handlers.onClose(); } };
    },
    createDefinition: ({ name, call }) => ({ name, execute: (args, execution = {}) => call(args, execution) }),
  });
  t.after(() => manager.close());
  return { manager, configs, callbacks, rotate: next => { value = next; }, provider: next => { provider = next; },
    counts: () => ({ reads, connections, closes, calls, cacheReads, cacheWrites }) };
}

test('ref boot/resume performs zero network/cache work; missing core isolates only ref servers', async t => {
  const f = fixture(t, { extraServers: [{ serverName: 'literal', transport: 'stdio', command: 'unused' }] });
  await f.manager.initialize();
  assert.equal(f.counts().reads, 0); assert.equal(f.counts().cacheReads, 1); assert.equal(f.counts().connections, 0);
  const a = agent(); await f.manager.restoreAvailable(a, { [id]: schemaHash(tool) });
  assert.equal(a.registered.size, 0); assert.equal(f.counts().connections, 0);
  f.provider(undefined);
  const missing = await f.manager.search('echo');
  assert.deepEqual(missing.unavailable, ['fixture']); assert.ok(missing.results.some(item => item.provider === 'literal'));
  assert.equal(f.manager.status().servers.find(s => s.name === 'fixture').credentialError, 'CREDENTIALS_UNAVAILABLE');
  assert.equal(f.counts().cacheWrites, 1, 'only literal metadata is durable');
});
test('rotation discovered per operation invalidates every agent definition; no stale callback/new principal dispatch', async t => {
  const f = fixture(t), first = agent(), second = agent();
  await f.manager.activate(first, [id]); await f.manager.activate(second, [id]);
  const original = first.registered.get(id);
  assert.equal(f.counts().cacheWrites, 0); assert.equal(f.configs[0].headerRefs, undefined);
  f.rotate('synthetic-rotated-token');
  await assert.rejects(original.execute({}, {}), { code: 'MCP_AUTH_CHANGED' });
  assert.equal(first.registered.size, 0); assert.equal(second.registered.size, 0); assert.equal(f.counts().calls, 0);
  await f.manager.activate(first, [id]);
  assert.notEqual(first.registered.get(id), original);
  assert.equal(f.configs[1].headers.Authorization, 'Bearer synthetic-rotated-token');
  assert.equal((await first.registered.get(id).execute({}, {})).content[0].text, 'ok');
  assert.equal(f.counts().calls, 1); assert.equal(f.counts().closes, 1);
});
test('notification invalidation is synchronous, never eager; unavailable refs cannot use warm catalogs', async t => {
  const f = fixture(t), a = agent(); await f.manager.activate(a, [id]);
  f.manager.invalidateCredentials('UNRELATED'); assert.equal(a.registered.size, 1);
  f.manager.invalidateCredentials('API_TOKEN'); assert.equal(a.registered.size, 0);
  assert.equal(f.manager.state('fixture').catalog, null); assert.equal(f.counts().connections, 1);
  f.rotate(undefined);
  assert.deepEqual((await f.manager.search('echo')).unavailable, ['fixture']);
  await f.manager.restoreAvailable(a, { [id]: schemaHash(tool) });
  assert.equal(f.counts().connections, 1); assert.equal(a.registered.size, 0);
});
test('disabled server resolves neither provider nor transport/cache', async t => {
  const f = fixture(t, { enabled: false }); await f.manager.initialize();
  assert.deepEqual((await f.manager.search('echo')).unavailable, ['fixture']);
  await f.manager.reconcileCredentials();
  assert.deepEqual(f.counts(), { reads: 0, connections: 0, closes: 0, calls: 0, cacheReads: 0, cacheWrites: 0 });
});
test('rotation aborts in-flight business request, drains it, never replays side effects', { timeout: 2000 }, async t => {
  const started = deferred(); let calls = 0, capturedSignal;
  const f = fixture(t, { connect: async (_config, handlers) => ({ instructions: '', listTools: async () => ({ tools: [tool] }),
    callTool: async (_name, _args, options) => { calls++; capturedSignal = options.signal; started.resolve(); return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('upstream synthetic-initial-token')), { once: true })); },
    close: async () => handlers.onClose() }) });
  await f.manager.search('echo');
  const call = f.manager.call('fixture', 'echo', schemaHash(tool), {});
  const rejection = assert.rejects(call, error => !String(error).includes('synthetic-initial-token'));
  await started.promise; f.manager.invalidateCredentials('API_TOKEN');
  assert.equal(capturedSignal.aborted, true); await rejection;
  assert.equal(calls, 1); assert.equal(f.counts().connections, 1);
});
test('late old connection cannot publish and replacement awaits old transport closure', { timeout: 2000 }, async t => {
  const gate = deferred(), started = deferred(); let connects = 0, closes = 0;
  const f = fixture(t, { connect: async (_config, handlers) => {
    connects++; if (connects === 1) { started.resolve(); await gate.promise; }
    return { instructions: '', listTools: async () => ({ tools: [tool] }), callTool: async () => ({}), close: async () => { closes++; handlers.onClose(); } };
  } });
  const first = f.manager.search('echo'); await started.promise;
  f.rotate('synthetic-second-token'); f.manager.invalidateCredentials('API_TOKEN');
  const second = f.manager.search('echo');
  await Promise.resolve(); assert.equal(connects, 1);
  gate.resolve(); assert.deepEqual((await first).unavailable, ['fixture']);
  assert.equal((await second).results.length, 1); assert.equal(connects, 2); assert.equal(closes, 1);
  f.callbacks[0].onClose(); f.callbacks[0].onListChanged();
  assert.equal(f.manager.state('fixture').invalid, false);
});
test('late old metadata never publishes to memory or cache after rotation', { timeout: 2000 }, async t => {
  const started = deferred(), gate = deferred(); let lists = 0;
  const f = fixture(t, { connect: async () => ({ instructions: '', listTools: async () => {
    if (++lists === 1) { started.resolve(); return gate.promise; } return { tools: [tool] };
  }, callTool: async () => ({}), close: async () => {} }) });
  const first = f.manager.search('echo'); await started.promise;
  f.manager.invalidateCredentials('API_TOKEN'); gate.resolve({ tools: [{ ...tool, description: 'Old account metadata' }] });
  assert.deepEqual((await first).unavailable, ['fixture']); assert.equal(f.manager.state('fixture').catalog, null);
  assert.equal((await f.manager.search('echo')).results.length, 1); assert.equal(f.counts().cacheWrites, 0);
});
test('provider failures/reflected metadata and results expose no secret or raw diagnostics', async t => {
  for (const mode of ['metadata', 'result', 'error']) {
    const f = fixture(t, { connect: async config => ({ instructions: mode === 'metadata' ? config.headers.Authorization : '',
      listTools: async () => ({ tools: [tool] }), callTool: async () => {
        if (mode === 'error') throw new Error(config.headers.Authorization);
        return { content: [{ type: 'text', text: config.headers.Authorization }] };
      }, close: async () => {} }) });
    if (mode === 'metadata') {
      assert.deepEqual((await f.manager.search('echo')).unavailable, ['fixture']); assert.equal(f.manager.state('fixture').catalog, null);
    } else {
      await f.manager.search('echo');
      await assert.rejects(f.manager.call('fixture', 'echo', schemaHash(tool), {}), error => !String(error).includes('synthetic-initial-token'));
    }
    assert.equal(f.counts().cacheWrites, 0);
  }
});

test('destination mismatch is isolated to one server and performs no credential reads', async t => {
  const original = { serverName: 'bound', transport: 'streamable-http', url: 'https://original.invalid/mcp', headerRefs: { Authorization: { name: 'TOKEN' } } };
  let reads = 0;
  const manager = new LazyMcpManager({ servers: [{ ...original, credentialTarget: credentialTarget(original), url: 'https://changed.invalid/mcp' }, { serverName: 'literal' }],
    resolveCredentials: createCredentialResolver(() => ({ resolve: async () => { reads++; return { value: 'synthetic' }; } })),
    connect: async () => ({ instructions: '', listTools: async () => ({ tools: [tool] }), close: async () => {} }) });
  t.after(() => manager.close());
  await manager.initialize(); const result = await manager.search('echo');
  assert.deepEqual(result.unavailable, ['bound']); assert.equal(result.results[0].provider, 'literal'); assert.equal(reads, 0);
  assert.equal(manager.status().servers[0].credentialError, 'CREDENTIAL_TARGET_CHANGED');
});
test('aggregate search cannot expose an earlier principal while a later server is pending', { timeout: 2000 }, async t => {
  const started = deferred(), gate = deferred();
  const f = fixture(t, { extraServers: [{ serverName: 'later' }], connect: async (config, handlers) => ({ instructions: '',
    listTools: async () => { if (config.serverName === 'later') { started.resolve(); await gate.promise; } return { tools: [tool] }; }, close: async () => handlers.onClose() }) });
  const searching = f.manager.search('echo'); await started.promise;
  f.manager.invalidateCredentials('API_TOKEN'); gate.resolve();
  const result = await searching;
  assert.deepEqual(result.unavailable, ['fixture']); assert.ok(result.results.every(item => item.provider === 'later'));
});
test('provider loss is reconciled locally and retires only ref-backed active registrations', async t => {
  const f = fixture(t), a = agent(); await f.manager.activate(a, [id]);
  f.provider(undefined); await f.manager.reconcileCredentials();
  assert.equal(a.registered.size, 0); assert.equal(f.manager.state('fixture').client, null);
  assert.equal(f.manager.status().servers[0].credentialsReady, false); assert.equal(f.counts().connections, 1);
});
test('unconfirmed transport close blocks any replacement without exposing diagnostic text', async t => {
  const f = fixture(t, { connect: async () => ({ instructions: '', listTools: async () => ({ tools: [tool] }),
    close: async () => { throw new Error('synthetic-initial-token close error'); } }) });
  await f.manager.search('echo'); f.manager.invalidateCredentials('API_TOKEN');
  assert.deepEqual((await f.manager.search('echo')).unavailable, ['fixture']);
  assert.equal(f.counts().connections, 1); assert.equal(f.manager.status().servers[0].credentialError, 'MCP_CLOSE_FAILED');
  assert.ok(!JSON.stringify(f.manager.status()).includes('synthetic-initial-token'));
});

test('connector cannot silently run unresolved bindings or a disabled server', async () => {
  const connect = createSdkConnector();
  await assert.rejects(connect({ serverName: 'fixture', transport: 'streamable-http', url: 'https://example.invalid/mcp', headerRefs: { Authorization: { name: 'TOKEN' } } }), { code: 'CREDENTIALS_UNAVAILABLE' });
  await assert.rejects(connect({ serverName: 'fixture', enabled: false, transport: 'stdio', command: 'never-executed' }), { code: 'SERVER_DISABLED' });
});

test('real stdio credential generations restart process with selected env, no secret echo', { timeout: 10000 }, async t => {
  let token = 'synthetic-env-one';
  const script = `import {Server} from '@modelcontextprotocol/server';import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';const s=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});s.setRequestHandler('tools/list',async()=>({tools:[${JSON.stringify(tool)}]}));s.setRequestHandler('tools/call',async()=>({content:[{type:'text',text:process.env.API_TOKEN==='synthetic-env-one'?'first':'second'}]}));await s.connect(new StdioServerTransport());`;
  const manager = new LazyMcpManager({ servers: [{ serverName: 'fixture', transport: 'stdio', command: process.execPath,
    args: ['--input-type=module', '-e', script], cwd: fileURLToPath(new URL('..', import.meta.url)), envRefs: { API_TOKEN: 'TOKEN' }, toolCallTimeoutMs: 3000 }],
    resolveCredentials: createCredentialResolver(() => ({ resolve: async () => ({ value: token }) })), connect: createSdkConnector(), createDefinition: () => ({}) });
  t.after(() => manager.close());
  await manager.search('echo'); assert.equal((await manager.call('fixture', 'echo', schemaHash(tool), {})).content[0].text, 'first');
  token = 'synthetic-env-two'; manager.invalidateCredentials('TOKEN');
  await manager.search('echo'); assert.equal((await manager.call('fixture', 'echo', schemaHash(tool), {})).content[0].text, 'second');
  assert.equal(manager.status().servers[0].connections, 2);
});

test('real HTTP SDK bearer provider pins headers and never retries a business 401', { timeout: 10000 }, async t => {
  const seen = []; let businessCalls = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, authorization: req.headers.authorization });
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    let request; try { request = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
    if (request.method === 'tools/call') { businessCalls++; res.writeHead(401, { 'www-authenticate': 'Bearer' }); res.end('synthetic HTTP refusal'); return; }
    if (!Object.hasOwn(request, 'id')) { res.writeHead(202); res.end(); return; }
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
    else if (request.method === 'tools/list') result = { tools: [tool] };
    else { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const controller = new AbortController();
  const client = await createSdkConnector()({ serverName: 'fixture', transport: 'streamable-http',
    url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer synthetic-http-token' }, toolCallTimeoutMs: 3000 }, { signal: controller.signal });
  t.after(() => client.close());
  const catalog = await client.listTools();
  await assert.rejects(client.callTool('echo', {}, { timeout: 3000, toolDefinition: catalog.tools[0] }));
  assert.equal(businessCalls, 1);
  assert.ok(seen.length >= 3); assert.ok(seen.every(item => item.authorization === 'Bearer synthetic-http-token'));
  controller.abort(); await client.close();
});
