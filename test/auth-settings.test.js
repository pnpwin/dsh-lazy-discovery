import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSettings, installAuthSettings, readAuthBody, authFailure } from '../src/lib/auth-settings.js';
import { credentialTarget } from '../src/lib/credential-bindings.js';
const PRIVATE = 'synthetic-literal-never-return-or-copy';
function fixture({ credentials = true, configured = true, writable = true } = {}) {
  const raw = { cacheDirectory: { __jsExpr: "dshHomePath('cache/lazy-discovery')" }, skillMaxAgeMs: 60000,
    servers: [ { serverName: 'api', transport: 'streamable-http', url: 'https://example.invalid/mcp?not-for-ui=hidden', headers: { authorization: { __jsExpr: 'process.env.API_TOKEN' }, 'X-Public': 'keep' }, toolCallTimeoutMs: 5000 },
      { serverName: 'other', transport: 'stdio', command: 'trusted-process', args: ['unchanged'], env: { SECRET: { __jsExpr: 'process.env.OTHER_SECRET' } } } ] };
  const config = { ...raw, servers: [{ ...raw.servers[0], headers: { authorization: PRIVATE, 'X-Public': 'keep' }, headerRefs: {}, envRefs: {} }, { ...raw.servers[1], env: { SECRET: PRIVATE }, headerRefs: {}, envRefs: {} }] };
  const root = {};
  const entry = { id: 'include:fixture-auth', options: { id: 'fixture-auth', name: '@pnpwin/dsh-lazy-discovery/host', config: structuredClone(raw) } };
  let edits = 0, resolves = 0;
  const editor = { edit: async (target, change) => { assert.equal(target, entry); const next = change(structuredClone(entry.options.config), {}); entry.options.config = next; edits++; } };
  const provider = { describe: async () => ({ configured, source: 'process environment', writable: true }), resolve: async () => { resolves++; throw new Error('UI must not resolve values'); } };
  const ctx = { root, fiber: { entry }, get: name => name === 'configEditor' && writable ? editor : name === 'credentials' && credentials ? provider : undefined };
  const settings = createAuthSettings(ctx, config);
  const payload = async () => ({ serverName: 'api', revision: (await settings.snapshot()).servers[0].revision, enabled: true, headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } }, envRefs: {}, confirmed: true });
  return { settings, ctx, raw, config, entry, provider, payload, counts: () => ({ edits, resolves }) };
}
test('auth snapshot projects names/status only and hides all literals, query and paths', async () => {
  const f = fixture(); f.config.servers[0].headerRefs = { 'X-API-Key': { name: 'API_TOKEN' } };
  const data = await f.settings.snapshot(), json = JSON.stringify(data);
  assert.equal(data.servers[0].destination, 'https://example.invalid');
  assert.equal(data.servers[1].destination, 'trusted-process');
  assert.equal(data.servers[0].credentials[0].source, 'environment');
  assert.equal(data.servers[0].hasLiteralCredentials, true);
  assert.equal(data.servers[0].revision.length, 64);
  for (const hidden of [PRIVATE, 'hidden', 'process.env', 'OTHER_SECRET']) assert(!json.includes(hidden));
  assert.deepEqual(f.counts(), { edits: 0, resolves: 0 });
});
test('save requires explicit authority and literal replacement acknowledgements', async () => {
  const f = fixture(), body = await f.payload();
  await assert.rejects(f.settings.update({ ...body, confirmed: false }), /confirmation-required/);
  await assert.rejects(f.settings.update(body), /literal-conflict/);
  assert.deepEqual(f.counts(), { edits: 0, resolves: 0 });
  assert.deepEqual(await f.settings.update({ ...body, replaceExisting: true }), { saved: true, serverName: 'api' });
  assert.equal(f.entry.options.config.servers[0].headers.authorization, undefined);
  assert.deepEqual(f.entry.options.config.servers[0].headerRefs, body.headerRefs);
  assert.equal(f.entry.options.config.servers[0].headers['X-Public'], 'keep');
  assert.deepEqual(f.entry.options.config.cacheDirectory, f.raw.cacheDirectory);
  assert.deepEqual(f.entry.options.config.servers[1], f.raw.servers[1]);
  assert(!JSON.stringify(f.entry.options.config).includes(PRIVATE));
});
test('opaque revision detects endpoint or expression changes before a binding is granted', async () => {
  const f = fixture(), body = await f.payload();
  f.entry.options.config.servers[0].url = 'https://different.invalid/mcp';
  await assert.rejects(f.settings.update({ ...body, replaceExisting: true }), /config-changed/);
  assert.equal(f.counts().edits, 0);
});
test('UI grants persist a destination pin while preserving raw endpoint configuration', async () => {
  const f = fixture();
  await f.settings.update({ ...await f.payload(), replaceExisting: true });
  const saved = f.entry.options.config.servers[0];
  assert.equal(saved.credentialTarget, credentialTarget(f.config.servers[0]));
  assert.equal(saved.url, f.raw.servers[0].url);
  assert.equal(saved.credentialTarget.includes(PRIVATE), false);
});
test('changed destination remains readable but needs a fresh confirmation to rebind', async () => {
  const f = fixture();
  const server = f.config.servers[0];
  server.headerRefs = { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } };
  server.credentialTarget = credentialTarget(server);
  server.url = 'https://changed.invalid/mcp';
  f.entry.options.config.servers[0].url = server.url;
  const data = await f.settings.snapshot();
  assert.equal(data.servers[0].bindingTargetChanged, true);
  const body = { ...await f.payload(), replaceExisting: true };
  await assert.rejects(f.settings.update({ ...body, confirmed: false }), /confirmation-required/);
  await f.settings.update(body);
  assert.equal(f.entry.options.config.servers[0].credentialTarget, credentialTarget(server));
});
test('manual reference input works without a Vault dependency using native environment-backed describe', async () => {
  const f = fixture();
  await f.settings.update({ ...await f.payload(), replaceExisting: true });
  assert.equal(f.counts().resolves, 0);
  assert.equal(f.counts().edits, 1);
});
test('missing provider/value fail closed while a disabled binding can be saved independently', async () => {
  for (const options of [{ credentials: false }, { configured: false }]) {
    const f = fixture(options), body = await f.payload();
    await assert.rejects(f.settings.update({ ...body, replaceExisting: true }), /credential-provider-unavailable|credential-missing/);
    await f.settings.update({ ...body, enabled: false, confirmed: false, replaceExisting: true });
    assert.equal(f.entry.options.config.servers[0].enabled, false);
    assert.equal(f.counts().edits, 1);
  }
});
test('read-only profiles and opaque dynamic server lists are reported, never materialized', async () => {
  const ro = fixture({ writable: false });
  assert.equal((await ro.settings.snapshot()).writable, false);
  await assert.rejects(ro.settings.update(await ro.payload()), /config-read-only/);
  const f = fixture(), body = await f.payload();
  f.entry.options.config.servers = { __jsExpr: 'loadServersElsewhere()' };
  assert.equal((await f.settings.snapshot()).servers[0].editable, false);
  await assert.rejects(f.settings.update({ ...body, replaceExisting: true }), /dynamic-config/);
  assert.equal(f.counts().edits, 0);
});
test('unknown fields and secret-value-shaped input are refused', async () => {
  const f = fixture(), body = await f.payload();
  await assert.rejects(f.settings.update({ ...body, value: PRIVATE }), /invalid-request/);
  await assert.rejects(f.settings.update({ ...body, headerRefs: { Authorization: { name: 'API_TOKEN', value: PRIVATE } } }), /invalid-request/);
  await assert.rejects(f.settings.update({ ...body, envRefs: JSON.parse('{"__proto__":"API_TOKEN"}') }), /invalid-bindings/);
});
test('bounded request parser and provider/editor failures never reflect their messages', async () => {
  const req = body => new Request('http://fixture.invalid/api/lazy-discovery/auth/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.deepEqual(await readAuthBody(req('{"serverName":"api"}')), { serverName: 'api' });
  await assert.rejects(readAuthBody(req(PRIVATE)), /invalid-request/);
  await assert.rejects(readAuthBody(req('x'.repeat(32769))), /request-too-large/);
  assert(!JSON.stringify(authFailure(new Error(PRIVATE))).includes(PRIVATE));
  const f = fixture(); f.provider.describe = async () => { throw new Error(PRIVATE); };
  await assert.rejects(f.settings.update(await f.payload()), /credential-missing/);
});
test('HTTP and agent reads share safe projection; writes are user-only', async () => {
  const f = fixture(), definitions = [], routes = [];
  const child = { connection: { fetch: { register: route => { routes.push(route); return async () => {}; } } }, effect: fn => fn() };
  const ctx = { ...f.ctx, tools: { register: tool => { definitions.push(tool); return () => {}; } }, effect: fn => fn(), inject: (deps, fn) => { assert.deepEqual(deps, ['connection']); fn(child); } };
  installAuthSettings(ctx, f.config);
  assert.deepEqual(definitions.map(x => x.name), ['lazy_mcp_auth_status']);
  assert.equal(definitions.some(x => /save|grant|update/.test(x.name)), false);
  assert.deepEqual(routes.map(route => ({ path: route.path, methods: route.methods, body: route.requestBody })), [
    { path: '/api/lazy-discovery/auth', methods: ['GET'], body: 'buffered' },
    { path: '/api/lazy-discovery/auth/save', methods: ['POST'], body: 'streaming' },
  ]);
  const response = await routes[0].fetch(new Request('http://fixture.invalid/api/lazy-discovery/auth'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const ui = await response.json(), agent = await definitions[0].execute();
  // HTTP and agent reads share one root/entry revision domain.
  assert.deepEqual(ui, agent); assert(!JSON.stringify(ui).includes(PRIVATE));
});
