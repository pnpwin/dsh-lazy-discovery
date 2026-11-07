import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialResolver, credentialTarget, referencedNames, usesCredentials, validateBindings, containsCredential } from '../src/lib/credential-bindings.js';

const server = extra => ({ serverName: 'fixture', transport: 'streamable-http', url: 'https://example.invalid/mcp', ...extra });
test('literal servers work without a provider and refs are resolved without mutating configuration', async () => {
  const literal = server({ headers: { 'X-Mode': 'literal' } });
  assert.equal(usesCredentials(literal), false);
  const absent = createCredentialResolver();
  assert.deepEqual((await absent(literal)).config, literal);
  const config = server({ headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } } });
  const resolve = createCredentialResolver(() => ({ resolve: async name => ({ value: `synthetic-${name}` }) }));
  const result = await resolve(config);
  assert.equal(result.config.headers.Authorization, 'Bearer synthetic-API_TOKEN');
  assert.equal(result.config.headerRefs, undefined);
  assert.equal(config.headers, undefined);
  assert.deepEqual(referencedNames(config), ['API_TOKEN']);
  assert.deepEqual(result.secrets, ['synthetic-API_TOKEN']);
  assert.ok(!result.identity.includes('synthetic'));
  assert.equal((await resolve(config)).identity, result.identity);
});
test('provider is looked up on every invocation; missing/throwing providers fail closed safely', async () => {
  let provider = { resolve: async () => ({ value: 'synthetic-first' }) };
  const resolve = createCredentialResolver(() => provider);
  const config = server({ headerRefs: { Authorization: { name: 'TOKEN' } } });
  const first = await resolve(config);
  provider = { resolve: async () => ({ value: 'synthetic-second' }) };
  assert.notEqual((await resolve(config)).identity, first.identity);
  provider = undefined;
  await assert.rejects(resolve(config), { code: 'CREDENTIALS_UNAVAILABLE' });
  provider = { resolve: async () => { throw new Error('never-publish-this-secret'); } };
  try { await resolve(config); assert.fail(); } catch (error) { assert.ok(!String(error).includes('never-publish')); }
  provider = { resolve: async () => undefined };
  await assert.rejects(resolve(config), { code: 'CREDENTIAL_NOT_CONFIGURED' });
});
test('bindings reject ambiguous headers/env, unsupported transports and unsafe names', () => {
  for (const config of [
    server({ headers: { authorization: 'literal' }, headerRefs: { Authorization: { name: 'TOKEN' } } }),
    server({ headerRefs: { Authorization: { name: 'TOKEN' }, authorization: { name: 'OTHER' } } }),
    server({ headerRefs: { Host: { name: 'TOKEN' } } }),
    server({ headerRefs: { Authorization: { name: 'DSH_TOKEN' } } }),
    server({ headerRefs: { Authorization: { name: 'TOKEN', prefix: '\r\n' } } }),
    server({ headerRefs: { Authorization: { name: 'TOKEN', typo: true } } }),
    server({ envRefs: { API_TOKEN: 'TOKEN' } }),
    { serverName: 'stdio', transport: 'stdio', env: { API_TOKEN: 'literal' }, envRefs: { API_TOKEN: 'TOKEN' } },
    { serverName: 'stdio', transport: 'stdio', envRefs: { DSH_TEST: 'TOKEN' } },
    { serverName: 'stdio', transport: 'stdio', envRefs: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`A${i}`, 'TOKEN'])) },
  ]) assert.throws(() => validateBindings(config), { code: 'INVALID_CREDENTIAL_BINDINGS' });
});
test('destination pins exclude secret settings and reject endpoint changes before resolution', async () => {
  const config = server({ headerRefs: { Authorization: { name: 'TOKEN' } } });
  config.credentialTarget = credentialTarget(config);
  assert.equal(credentialTarget({ ...config, headers: { 'X-Unrelated': 'synthetic' } }), config.credentialTarget);
  const changed = { ...config, url: 'https://other.invalid/mcp' };
  assert.throws(() => validateBindings(changed), { code: 'CREDENTIAL_TARGET_CHANGED' });
  assert.doesNotThrow(() => validateBindings(changed, { checkTarget: false }));
  let reads = 0;
  const resolve = createCredentialResolver(() => ({ resolve: async () => { reads++; return { value: 'synthetic' }; } }));
  await assert.rejects(resolve(changed), { code: 'CREDENTIAL_TARGET_CHANGED' });
  assert.equal(reads, 0);
  assert.notEqual(credentialTarget({ transport: 'stdio', command: 'a', args: [] }), credentialTarget({ transport: 'stdio', command: 'a', args: ['different'] }));
  for (const header of ['mcp-session-id', 'MCP-Protocol-Version', 'Content-Type', 'content-length', 'connection', 'transfer-encoding', 'accept', 'origin', 'proxy-authorization']) {
    assert.throws(() => validateBindings(server({ headerRefs: { [header]: { name: 'TOKEN' } } })), { code: 'INVALID_CREDENTIAL_BINDINGS' });
  }
});

test('stdio env refs, bounds, disabled and header value validation', async () => {
  const resolve = createCredentialResolver(() => ({ resolve: async () => ({ value: 'synthetic\nmultiline' }) }));
  const config = { serverName: 'stdio', transport: 'stdio', command: 'unused', envRefs: { API_TOKEN: 'TOKEN' } };
  assert.equal((await resolve(config)).config.env.API_TOKEN, 'synthetic\nmultiline');
  await assert.rejects(resolve(server({ headerRefs: { Authorization: { name: 'TOKEN' } } })), { code: 'INVALID_CREDENTIAL_VALUE' });
  await assert.rejects(resolve({ ...config, enabled: false }), { code: 'SERVER_DISABLED' });
  assert.equal(containsCredential({ schema: { default: 'synthetic-secret' } }, ['synthetic-secret']), true);
  assert.equal(containsCredential({ ['synthetic-secret']: 1 }, ['synthetic-secret']), true);
  assert.equal(containsCredential({ value: 'safe' }, ['synthetic-secret']), false);
});
