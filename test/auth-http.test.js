import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { installAuthSettings } from '../src/lib/auth-http.js';
import { installAuthSettings as compatibilityInstall } from '../src/lib/auth-settings.js';

const AUTH = '/api/lazy-discovery/auth';
const SAVE = `${AUTH}/save`;
const PRIVATE = 'synthetic-literal-that-must-not-be-projected';

function fixture() {
  const config = { servers: [{ serverName: 'fixture', transport: 'streamable-http', url: 'https://example.invalid/private?token=hidden',
    headers: { Authorization: PRIVATE }, headerRefs: {}, envRefs: {}, enabled: true }] };
  const entry = { options: { config: structuredClone(config) } };
  const routes = new Map(), tools = new Map(), effects = [];
  let edits = 0, resolves = 0;
  const provider = { describe: async () => ({ configured: true }), resolve: async () => { resolves++; throw new Error(PRIVATE); } };
  const editor = { edit: async (_entry, mutate) => { entry.options.config = mutate(structuredClone(entry.options.config), {}); edits++; } };
  const child = { effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; }, connection: { fetch: {
    register: route => {
      assert.ok(!routes.has(route.path), 'Connection only permits one registration per exact path');
      routes.set(route.path, route);
      return () => { routes.delete(route.path); };
    },
  } } };
  const ctx = { fiber: { entry }, get: name => name === 'credentials' ? provider : name === 'configEditor' ? editor : undefined,
    effect: fn => { const dispose = fn(); effects.push(dispose); return dispose; },
    tools: { register: definition => { assert.ok(!tools.has(definition.name)); tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    inject: (deps, callback) => { assert.deepEqual(deps, ['connection']); callback(child); },
  };
  return { ctx, config, routes, tools, counts: () => ({ edits, resolves }),
    stop: async () => { for (const dispose of effects.splice(0).reverse()) await dispose?.(); } };
}

/** Reproduce Connection's installed node:http -> WHATWG conversion, rather than
 * testing fetch handlers with an already constructed body-less GET Request. */
async function carrier(routes) {
  const failures = [], modes = [];
  const server = http.createServer(async (req, res) => {
    // Synthetic owner admission only; never uses DSH credentials or sessions.
    if (req.headers.authorization !== 'Fixture owner') { res.writeHead(401); res.end(); return; }
    const url = new URL(req.url, 'http://fixture.invalid');
    const method = req.method, route = routes.get(url.pathname);
    const supported = route?.methods.includes(method);
    const bodyMode = supported ? route.requestBody : 'buffered';
    modes.push({ method, path: url.pathname, bodyMode });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([, value]) => typeof value === 'string'));
      let request;
      if (bodyMode === 'buffered') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        request = new Request(url, { method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}), signal: controller.signal });
      } else {
        request = new Request(url, { method, headers, body: Readable.toWeb(req), duplex: 'half', signal: controller.signal });
      }
      const response = supported ? await route.fetch(request) : new Response('not found', { status: 404 });
      const unread = bodyMode === 'streaming' && !req.readableEnded;
      res.writeHead(response.status, { ...Object.fromEntries(response.headers), ...(unread ? { connection: 'close' } : {}) });
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end(); if (unread) req.destroy();
    } catch (error) {
      failures.push(error); res.writeHead(500); res.end('carrier failure');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, modes, failures, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
function request(base, path, { method = 'GET', body, chunks, authenticated = true, contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { method, headers: {
      ...(authenticated ? { Authorization: 'Fixture owner' } : {}), ...(method === 'POST' ? { 'Content-Type': contentType } : {}),
    } }, res => {
      const data = []; res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(data).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (chunks) for (const chunk of chunks) req.write(chunk);
    else if (body !== undefined) req.write(body);
    req.end();
  });
}

test('transport extraction preserves compatibility export and separately disposable method/body registrations', async () => {
  assert.equal(compatibilityInstall, installAuthSettings);
  const f = fixture(); installAuthSettings(f.ctx, f.config);
  assert.deepEqual([...f.routes].map(([path, route]) => ({ path, methods: route.methods, body: route.requestBody })), [
    { path: AUTH, methods: ['GET'], body: 'buffered' }, { path: SAVE, methods: ['POST'], body: 'streaming' },
  ]);
  assert.deepEqual([...f.tools.keys()], ['lazy_mcp_auth_status']);
  await f.stop(); assert.equal(f.routes.size, 0); assert.equal(f.tools.size, 0);
  installAuthSettings(f.ctx, f.config); assert.equal(f.routes.size, 2); await f.stop();
});
test('authenticated real Node carrier GET succeeds; unauthenticated rejection is not a GET transport test', async t => {
  const f = fixture(); installAuthSettings(f.ctx, f.config);
  const transport = await carrier(f.routes); t.after(async () => { await transport.close(); await f.stop(); });
  const unauth = await request(transport.base, AUTH, { authenticated: false });
  assert.equal(unauth.status, 401); assert.equal(transport.modes.length, 0);
  const result = await request(transport.base, AUTH);
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(JSON.parse(result.text), await f.tools.get('lazy_mcp_auth_status').execute());
  for (const value of [PRIVATE, 'private?', 'token=hidden']) assert.ok(!result.text.includes(value));
  assert.deepEqual(f.counts(), { edits: 0, resolves: 0 });
  assert.equal(transport.modes[0].bodyMode, 'buffered'); assert.equal(transport.failures.length, 0);
  assert.equal((await request(transport.base, AUTH, { method: 'HEAD' })).status, 404);
  assert.equal((await request(transport.base, AUTH, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await request(transport.base, SAVE)).status, 404);
});
test('negative control: previous combined streaming route fails before its GET handler', async t => {
  let called = false;
  const routes = new Map([[AUTH, { methods: ['GET', 'POST'], requestBody: 'streaming', fetch: async () => { called = true; return new Response('unexpected'); } }]]);
  const transport = await carrier(routes); t.after(() => transport.close());
  const result = await request(transport.base, AUTH);
  assert.equal(result.status, 500); assert.equal(called, false);
  assert.equal(transport.failures.length, 1); assert.match(transport.failures[0].message, /GET\/HEAD.*body/);
});
test('real streaming POST refuses malformed and chunked oversized bodies without settings writes', async t => {
  const f = fixture(); installAuthSettings(f.ctx, f.config);
  const transport = await carrier(f.routes); t.after(async () => { await transport.close(); await f.stop(); });
  for (const options of [
    { body: '{not-json' }, { body: '{}', contentType: 'text/plain' }, { body: JSON.stringify({ serverName: 'fixture', value: PRIVATE }) },
  ]) {
    const response = await request(transport.base, SAVE, { method: 'POST', ...options });
    assert.equal(response.status, 400); assert.equal(JSON.parse(response.text).error.code, 'invalid-request');
    assert.ok(!response.text.includes(PRIVATE));
  }
  // No Content-Length: this exercises the streaming byte counter, not its header shortcut.
  const oversize = await request(transport.base, SAVE, { method: 'POST', chunks: [' '.repeat(16384), ' '.repeat(16384), 'x'] });
  assert.equal(oversize.status, 400); assert.equal(JSON.parse(oversize.text).error.code, 'request-too-large');
  assert.ok(transport.modes.every(mode => mode.bodyMode === 'streaming'));
  assert.deepEqual(f.counts(), { edits: 0, resolves: 0 }); assert.equal(transport.failures.length, 0);
});
test('well-formed streaming POST retains owner-confirmation checks and writes only the selected raw row', async t => {
  const f = fixture(); installAuthSettings(f.ctx, f.config);
  const transport = await carrier(f.routes); t.after(async () => { await transport.close(); await f.stop(); });
  const snapshot = JSON.parse((await request(transport.base, AUTH)).text);
  const body = { serverName: 'fixture', revision: snapshot.servers[0].revision, enabled: true,
    headerRefs: { 'X-API-Key': { name: 'API_TOKEN' } }, envRefs: {}, confirmed: false };
  const denied = await request(transport.base, SAVE, { method: 'POST', body: JSON.stringify(body) });
  assert.equal(denied.status, 400); assert.equal(JSON.parse(denied.text).error.code, 'confirmation-required');
  assert.equal(f.counts().edits, 0);
  const saved = await request(transport.base, SAVE, { method: 'POST', body: JSON.stringify({ ...body, enabled: false }) });
  assert.equal(saved.status, 200); assert.deepEqual(JSON.parse(saved.text), { saved: true, serverName: 'fixture' });
  assert.deepEqual(f.counts(), { edits: 1, resolves: 0 });
});
