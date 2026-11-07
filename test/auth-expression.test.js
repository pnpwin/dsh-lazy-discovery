import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSettings } from '../src/lib/auth-state.js';
import { validateBindings } from '../src/lib/credential-bindings.js';

const PRIVATE = 'synthetic-resolved-plaintext-never-persist';
function fixture({ transport = 'streamable-http', effective = {}, validateNext } = {}) {
  const field = transport === 'stdio' ? 'env' : 'headers';
  const expression = { __jsExpr: 'syntheticHeaderOrEnvSource()' };
  const server = { serverName: 'fixture', transport, enabled: false, [field]: expression,
    ...(transport === 'stdio' ? { command: 'synthetic-not-executed', args: ['unchanged'] } : { url: 'https://fixture.invalid/mcp' }) };
  const raw = { cacheDirectory: { __jsExpr: 'syntheticCacheDirectory()' }, servers: [server,
    { serverName: 'other', transport: 'stdio', command: 'synthetic-other', enabled: false, env: { KEEP: { __jsExpr: 'syntheticOtherEnv()' } } }] };
  const config = { ...raw, servers: [{ ...server, [field]: effective }, raw.servers[1]] };
  const entry = { id: 'include:expression-fixture', options: { id: 'expression-fixture', name: '@fixture/host', config: structuredClone(raw) } };
  let writes = 0;
  const editor = { edit: async (_entry, mutate) => {
    const next = mutate(structuredClone(entry.options.config), {});
    validateNext?.(next);
    entry.options.config = next; writes++;
  } };
  const ctx = { root: {}, fiber: { entry }, get: name => name === 'configEditor' ? editor : undefined };
  const settings = createAuthSettings(ctx, config);
  const payload = async (refs, extra = {}) => ({ serverName: 'fixture', revision: (await settings.snapshot()).servers[0].revision,
    enabled: false, confirmed: false, headerRefs: transport === 'streamable-http' ? refs : {}, envRefs: transport === 'stdio' ? refs : {}, ...extra });
  return { raw, config, entry, expression, field, settings, payload, writes: () => writes };
}

test('empty or unrelated resolved HTTP maps permit refs while preserving the whole raw expression', async () => {
  for (const effective of [{}, { 'X-Unrelated': PRIVATE }]) {
    const f = fixture({ effective });
    const before = await f.settings.snapshot();
    assert.equal(before.servers[0].editable, true);
    assert.equal(before.servers[0].hasLiteralCredentials, Object.keys(effective).length > 0);
    const body = await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN', prefix: 'Bearer ' }, 'X-API-Key': { name: 'SYNTHETIC_OTHER' } });
    await f.settings.update(body);
    const saved = f.entry.options.config;
    assert.deepEqual(saved.servers[0].headers, f.expression);
    assert.deepEqual(saved.servers[0].headerRefs, body.headerRefs);
    assert.deepEqual(saved.cacheDirectory, f.raw.cacheDirectory);
    assert.deepEqual(saved.servers[1], f.raw.servers[1]);
    assert.equal(JSON.stringify(saved).includes(PRIVATE), false);
    assert.equal(f.writes(), 1);
  }
});
test('HTTP overlap is case insensitive and cannot rewrite an expression even with literal replacement confirmed', async () => {
  for (const replaceExisting of [false, true]) {
    const f = fixture({ effective: { authorization: PRIVATE } });
    await assert.rejects(f.settings.update(await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN' } }, { replaceExisting })), { code: 'dynamic-config' });
    assert.deepEqual(f.entry.options.config, f.raw); assert.equal(f.writes(), 0);
  }
});
test('one overlapping target rejects the whole multi-binding edit without partial writes', async () => {
  const f = fixture({ effective: { authorization: PRIVATE } });
  const body = await f.payload({ 'X-API-Key': { name: 'SYNTHETIC_FIRST' }, Authorization: { name: 'SYNTHETIC_SECOND' } }, { replaceExisting: true });
  await assert.rejects(f.settings.update(body), { code: 'dynamic-config' });
  assert.deepEqual(f.entry.options.config, f.raw); assert.equal(f.writes(), 0);
});

test('stdio expressions preserve unrelated env values and env overlap remains case sensitive', async () => {
  for (const effective of [{}, { UNRELATED: PRIVATE }, { api_token: PRIVATE }]) {
    const f = fixture({ transport: 'stdio', effective });
    const body = await f.payload({ API_TOKEN: 'SYNTHETIC_TOKEN' });
    await f.settings.update(body);
    assert.deepEqual(f.entry.options.config.servers[0].env, f.expression);
    assert.deepEqual(f.entry.options.config.servers[0].envRefs, body.envRefs);
    assert.equal(JSON.stringify(f.entry.options.config).includes(PRIVATE), false);
    assert.equal(f.writes(), 1);
  }
  const f = fixture({ transport: 'stdio', effective: { API_TOKEN: PRIVATE } });
  await assert.rejects(f.settings.update(await f.payload({ API_TOKEN: 'SYNTHETIC_TOKEN' }, { replaceExisting: true })), { code: 'dynamic-config' });
  assert.equal(f.writes(), 0);
});
test('unknown/nonplain/unresolved effective map shapes still fail closed', async () => {
  for (const effective of [undefined, null, [], 'not-a-map', new Date(0), new Map(), { __jsExpr: 'stillUnresolved()' }]) {
    // Pass undefined explicitly after fixture's default argument initialization.
    const f = fixture({ effective: {} }); f.config.servers[0].headers = effective;
    await assert.rejects(f.settings.update(await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN' } })), { code: 'dynamic-config' });
    assert.equal(f.writes(), 0);
  }
  const f = fixture({ effective: Object.assign(Object.create(null), { 'X-Unrelated': PRIVATE }) });
  await f.settings.update(await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN' } }));
  assert.deepEqual(f.entry.options.config.servers[0].headers, f.expression);
});
test('a later overlapping expression result is rejected by runtime validation, never materialized into saved config', async () => {
  const f = fixture({ effective: {}, validateNext: next => validateBindings({ ...next.servers[0], headers: { Authorization: PRIVATE } }) });
  await assert.rejects(f.settings.update(await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN' } })), { code: 'INVALID_CREDENTIAL_BINDINGS' });
  assert.deepEqual(f.entry.options.config, f.raw); assert.equal(f.writes(), 0);
});
test('raw expression or destination edits still reject stale forms before preservation', async () => {
  for (const change of [server => { server.headers = { __jsExpr: 'changedExpression()' }; }, server => { server.url = 'https://different.invalid/mcp'; }]) {
    const f = fixture(); const body = await f.payload({ Authorization: { name: 'SYNTHETIC_TOKEN' } });
    change(f.entry.options.config.servers[0]);
    await assert.rejects(f.settings.update(body), { code: 'config-changed' });
    assert.equal(f.writes(), 0);
  }
});
