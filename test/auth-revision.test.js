import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthSettings, AuthSettingsError, authFailure, readAuthBody } from '../src/lib/auth-state.js';
import * as compatibility from '../src/lib/auth-settings.js';

const row = serverName => ({ serverName, transport: 'streamable-http', url: `https://fixture.invalid/${serverName}`, enabled: false,
  headers: { 'X-Literal': 'synthetic-not-for-projection' } });
function fixture() {
  let raw = { servers: [row('first'), row('second')] }, writes = 0, resolves = 0;
  const root = Object.freeze({});
  function service({ owner = root, id = 'include:fixture', name = '@pnpwin/dsh-lazy-discovery/host', entry: providedEntry, rootless = false, context } = {}) {
    const entry = providedEntry ?? { id, options: { id: 'fixture', name, config: structuredClone(raw) } };
    entry.options.config = structuredClone(raw);
    const editor = { edit: async (target, change) => {
      assert.equal(target, entry); raw = change(structuredClone(raw), {}); entry.options.config = structuredClone(raw); writes++;
    } };
    const ctx = context ?? { ...(rootless ? {} : { root: owner }), fiber: { entry }, get: kind => kind === 'configEditor' ? editor : kind === 'credentials' ? {
      describe: async () => ({ configured: true }), resolve: async () => { resolves++; throw new Error('Never resolve actual values in settings'); },
    } : undefined };
    return { settings: createAuthSettings(ctx, structuredClone(raw)), entry, ctx };
  }
  const input = (snapshot, serverName) => ({ serverName, revision: snapshot.servers.find(server => server.serverName === serverName).revision,
    enabled: false, headerRefs: { 'X-API-Key': { name: serverName === 'first' ? 'SYNTHETIC_FIRST' : 'SYNTHETIC_SECOND' } }, envRefs: {}, confirmed: false });
  return { root, service, input, counts: () => ({ writes, resolves }), raw: () => raw, mutate: fn => { fn(raw); } };
}

test('pure compatibility exports retain the canonical controller class and functions', () => {
  assert.equal(compatibility.createAuthSettings, createAuthSettings);
  assert.equal(compatibility.AuthSettingsError, AuthSettingsError);
  assert.equal(compatibility.authFailure, authFailure);
  assert.equal(compatibility.readAuthBody, readAuthBody);
});
test('unchanged second-row revision survives first-row save and recreated entry/fiber on same root', async () => {
  const f = fixture(), first = f.service();
  const before = await first.settings.snapshot();
  const secondDraft = f.input(before, 'second');
  await first.settings.update(f.input(before, 'first'));
  const reloaded = f.service(); assert.notEqual(reloaded.entry, first.entry);
  const after = await reloaded.settings.snapshot();
  assert.notEqual(after.servers[0].revision, before.servers[0].revision);
  assert.equal(after.servers[1].revision, before.servers[1].revision);
  await reloaded.settings.update(secondDraft);
  assert.equal(f.raw().servers.every(server => Object.keys(server.headerRefs ?? {}).length === 1), true);
  assert.deepEqual(f.counts(), { writes: 2, resolves: 0 });
  await assert.rejects(reloaded.settings.update(f.input(before, 'first')), { code: 'config-changed' });
  assert.equal(f.counts().writes, 2);
});
test('root, fully qualified entry id and module name independently domain-separate revisions', async () => {
  const f = fixture();
  const revision = async options => (await f.service(options).settings.snapshot()).servers[0].revision;
  const original = await revision({});
  assert.equal(await revision({}), original);
  assert.notEqual(await revision({ owner: Object.freeze({}) }), original);
  assert.notEqual(await revision({ id: 'other-include:fixture' }), original);
  assert.notEqual(await revision({ name: '@fixture/other-module' }), original);
  const ctx = f.service({ owner: { root: f.root } });
  assert.equal((await ctx.settings.snapshot()).servers[0].revision, original, 'root wrappers canonicalize to the same Cordis root');
  assert.deepEqual(Reflect.ownKeys(f.root), [], 'the revision secret is not installed on the root');
});
test('old forms cannot cross entry domains even for identical raw configurations', async () => {
  const f = fixture(), first = f.service();
  const body = f.input(await first.settings.snapshot(), 'second');
  await assert.rejects(f.service({ id: 'include:other' }).settings.update(body), { code: 'config-changed' });
  await assert.rejects(f.service({ owner: {} }).settings.update(body), { code: 'config-changed' });
  assert.equal(f.counts().writes, 0);
});
test('canonical raw serialization tolerates YAML key order but detects raw endpoint/expression/array edits', async () => {
  const f = fixture(), first = f.service();
  const original = (await first.settings.snapshot()).servers[0].revision;
  f.mutate(raw => { raw.servers[0] = Object.fromEntries(Object.entries(raw.servers[0]).reverse()); });
  assert.equal((await f.service().settings.snapshot()).servers[0].revision, original);
  for (const mutate of [
    server => { server.url = 'https://different.invalid/mcp'; },
    server => { server.headers['X-Literal'] = { __jsExpr: 'process.env.SYNTHETIC_DIFFERENT' }; },
    server => { server.args = ['different', 'ordered']; },
  ]) {
    const before = await f.service().settings.snapshot();
    f.mutate(raw => mutate(raw.servers[0]));
    const current = f.service();
    assert.notEqual((await current.settings.snapshot()).servers[0].revision, before.servers[0].revision);
    await assert.rejects(current.settings.update(f.input(before, 'first')), { code: 'config-changed' });
  }
  assert.equal(f.counts().writes, 0);
});
test('no-root callers are private to exact context; anonymous entries never share a form domain', async () => {
  const f = fixture(), entry = { options: { config: f.raw() } };
  const first = f.service({ rootless: true, entry });
  const before = (await first.settings.snapshot()).servers[0].revision;
  const repeated = createAuthSettings(first.ctx, structuredClone(f.raw()));
  assert.equal((await repeated.snapshot()).servers[0].revision, before);
  assert.notEqual((await f.service({ rootless: true, entry }).settings.snapshot()).servers[0].revision, before);
  const anonymousA = f.service({ entry: { options: {} } });
  const anonymousB = f.service({ entry: { options: {} } });
  assert.notEqual((await anonymousA.settings.snapshot()).servers[0].revision, (await anonymousB.settings.snapshot()).servers[0].revision);
});
