import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillsDiscovery } from '../src/lib/skills.js';

function bus() {
  const hooks = new Map();
  return {
    on(name, callback, options) {
      const list = hooks.get(name) ?? [];
      options?.prepend ? list.unshift(callback) : list.push(callback);
      hooks.set(name, list);
      return () => { const i = list.indexOf(callback); if (i >= 0) list.splice(i, 1); };
    },
    effect(callback) {
      const teardown = callback();
      let active = true;
      return () => { if (active) { active = false; teardown(); } };
    },
    emit(name) { for (const callback of hooks.get(name) ?? []) callback(); },
    async step(payload, initial) {
      const list = [...hooks.get('agent/pre-step') ?? []];
      const next = () => list.length ? list.shift()(payload, next) : Promise.resolve(initial);
      return next();
    },
    count(name) { return (hooks.get(name) ?? []).length; },
  };
}
const skill = (name, modelInvocable = true) => ({ name, description: `${name} description`,
  invocation: { modelInvocable, userInvocable: true }, provider: 'filesystem',
  content: 'SECRET_BODY', metadata: { secret: true }, path: '/private/secret', locator: 'opaque' });
const stock = entries => ({ role: 'user', id: 'stock', source: { kind: 'skill-catalog', entries }, content: [{ type: 'text', text: 'FULL CATALOG' }] });

function fixture(options = {}) {
  const events = bus();
  let stamp = 100;
  let snapshots = 0;
  let observed = { skills: [skill('office'), skill('hidden', false)], complete: true };
  let source = async () => observed;
  const ctx = { on: events.on,
    skills: { snapshot: async input => { snapshots++; return source(input); } },
    workingDirectory: { ensure: async agent => agent.cwd, get: session => session.cwd },
  };
  const agent = { id: 'session-a', ctx: events, cwd: '/workspace/a', session: {
    cwd: '/workspace/a', surface: { nodes: [] }, eventAt: seq => history.get(seq),
  } };
  agent.scope = [{}, {}];
  const history = new Map();
  const writes = [];
  const cache = { read: async () => null, write: async (key, value) => writes.push({ key, value }) };
  let shown = true;
  const discovery = createSkillsDiscovery({ ctx, cache, now: () => stamp,
    getScopeIdentity: item => item.scope, isSkillVisible: () => shown,
    createUserMessage: data => ({ id: 'retirement', role: 'user', ...data }), ...options });
  return { ctx, events, agent, discovery, history, writes,
    get snapshots() { return snapshots; },
    advance: amount => stamp += amount,
    setObserved: value => observed = value,
    setSource: value => source = value,
    setVisible: value => shown = value,
  };
}

test('warm metadata cache uses current cwd/scope, excludes bodies and disabled skills', async () => {
  const f = fixture();
  const result = await f.discovery.search(f.agent, 'office');
  assert.equal(result.results[0].name, 'office');
  assert.equal(result.complete, true);
  await f.discovery.search(f.agent, 'office');
  assert.equal(f.snapshots, 1);
  assert.equal(f.discovery.status(f.agent).cached, true);
  assert.match(f.writes[0].key, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(f.writes);
  for (const forbidden of ['SECRET_BODY', '/private/secret', 'locator', 'metadata', 'hidden']) assert.equal(serialized.includes(forbidden), false);
  f.discovery.dispose();
});

test('TTL and skills/change invalidate warm cache', async () => {
  const f = fixture({ maxAgeMs: 10 });
  await f.discovery.search(f.agent, 'office');
  f.advance(10);
  await f.discovery.search(f.agent, 'office');
  assert.equal(f.snapshots, 2);
  f.events.emit('skills/change');
  assert.equal(f.discovery.status(f.agent).cached, false);
  await f.discovery.search(f.agent, 'office');
  assert.equal(f.snapshots, 3);
  f.discovery.dispose();
});

test('changed cwd, parent scope, and same-id Agent objects cannot reuse authorization', async () => {
  const f = fixture();
  await f.discovery.search(f.agent, 'office');
  f.agent.cwd = f.agent.session.cwd = '/workspace/b';
  await f.discovery.search(f.agent, 'office');
  f.agent.scope = [f.agent.scope[0], {}];
  await f.discovery.search(f.agent, 'office');
  const other = { ...f.agent, scope: f.agent.scope };
  await f.discovery.search(other, 'office');
  assert.equal(f.snapshots, 4);
  f.discovery.dispose();
});

test('missing scope identity disables cross-request reuse safely', async () => {
  const f = fixture({ getScopeIdentity: undefined });
  await f.discovery.search(f.agent, 'office');
  await f.discovery.search(f.agent, 'office');
  assert.equal(f.snapshots, 2);
  assert.equal(f.discovery.status(f.agent).cached, false);
  f.discovery.dispose();
});

test('incomplete discovery is explicitly incomplete and retried, never persisted', async () => {
  const f = fixture();
  f.setObserved({ skills: [skill('office')], complete: false });
  assert.equal((await f.discovery.search(f.agent, 'office')).complete, false);
  assert.equal((await f.discovery.search(f.agent, 'office')).results[0].name, 'office');
  assert.equal(f.snapshots, 2);
  assert.equal(f.writes.length, 0);
  f.discovery.dispose();
});

test('hidden or same-name-shadowed stock registration yields no discovery', async () => {
  const f = fixture();
  await f.discovery.search(f.agent, 'office');
  f.setVisible(false);
  const result = await f.discovery.search(f.agent, 'office');
  assert.deepEqual(result.results, []);
  assert.equal(result.hidden, true);
  assert.equal(f.discovery.status(f.agent).count, 0);
  assert.equal(f.snapshots, 1);
  f.discovery.dispose();
});

test('one cancelled waiter does not cancel shared snapshot', async () => {
  const f = fixture();
  let release;
  const ready = new Promise(resolve => release = resolve);
  f.setSource(() => ready);
  const controller = new AbortController();
  const first = f.discovery.search(f.agent, 'office', { signal: controller.signal });
  const second = f.discovery.search(f.agent, 'office');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('stop only first'));
  await assert.rejects(first, /stop only first/);
  release({ skills: [skill('office')], complete: true });
  assert.equal((await second).results[0].name, 'office');
  assert.equal(f.snapshots, 1);
  f.discovery.dispose();
});

test('invalidation during snapshot rejects old result and does not publish stale cache', async () => {
  const f = fixture();
  let release;
  f.setSource(() => new Promise(resolve => release = resolve));
  const pending = f.discovery.search(f.agent, 'office');
  await new Promise(resolve => setImmediate(resolve));
  f.discovery.invalidate();
  release({ skills: [skill('office')], complete: true });
  await assert.rejects(pending, /invalidated/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.discovery.status(f.agent).cached, false);
  f.discovery.dispose();
});

test('scope changed during snapshot cannot return old scope hints', async () => {
  const f = fixture();
  f.setSource(async () => { f.agent.scope = [{}]; return { skills: [skill('office')], complete: true }; });
  await assert.rejects(f.discovery.search(f.agent, 'office'), /scope changed/);
  f.discovery.dispose();
});

test('disk hints never bypass a fresh current-scope snapshot and failures are optional', async () => {
  let reads = 0;
  const f = fixture({ cache: { read: async (_key, { validate }) => {
    reads++;
    assert.equal(validate({ entries: [skill('unauthorized')] }), false);
    return { value: { entries: [skill('unauthorized')] }, savedAt: 1 };
  }, write: async () => { throw new Error('disk offline'); } } });
  assert.equal((await f.discovery.search(f.agent, 'office')).results[0].name, 'office');
  assert.equal(f.snapshots, 1);
  assert.equal(reads, 1);
  f.discovery.dispose();
});

test('scope changes during disk writes are rechecked before returning hints', async () => {
  let f;
  f = fixture({ cache: { read: async () => null, write: async () => { f.agent.scope = [{}]; } } });
  await assert.rejects(f.discovery.search(f.agent, 'office'), /scope changed/);
  assert.equal(f.discovery.status(f.agent).cached, false);
  f.discovery.dispose();
});

test('visibility changes during asynchronous search cannot expose stale results', async () => {
  let f;
  f = fixture({ search: async entries => { f.setVisible(false); return { results: entries, truncated: false }; } });
  await assert.rejects(f.discovery.search(f.agent, 'office'), /scope changed during search/);
  f.discovery.dispose();
});

test('working-directory changes during snapshot cannot authorize prior directory hints', async () => {
  const f = fixture();
  f.setSource(async () => { f.agent.session.cwd = '/changed'; return { skills: [skill('office')], complete: true }; });
  await assert.rejects(f.discovery.search(f.agent, 'office'), /Working directory changed/);
  f.discovery.dispose();
});

test('transform removes only proposed catalogs, preserving explicit /name bodies and decision flags', () => {
  const f = fixture();
  const body = { source: { kind: 'skill-invocation' }, content: [{ type: 'text', text: '<skill_content>FULL BODY</skill_content>' }] };
  const user = { source: { kind: 'user' }, content: [{ type: 'text', text: '/office' }] };
  const decision = { kind: 'enter', messages: [user, stock([{ name: 'office' }]), body], startsRequestSeries: true, extra: 7 };
  const output = f.discovery.transformDecision(f.agent, decision);
  assert.deepEqual(output.messages, [user, body]);
  assert.equal(output.messages[1], body);
  assert.equal(output.startsRequestSeries, true);
  assert.equal(output.extra, 7);
  const rejected = { kind: 'reject' };
  assert.equal(f.discovery.transformDecision(f.agent, rejected), rejected);
  f.discovery.dispose();
});

test('visible historical catalogs retire compactly; compaction/resume uses current surface', () => {
  const f = fixture();
  f.history.set(1, { type: 'user/message', data: stock([{ name: 'office' }]) });
  f.agent.session.surface.nodes = [1];
  const output = f.discovery.transformDecision(f.agent, { kind: 'enter', messages: [] });
  assert.deepEqual(output.messages[0].source.entries, []);
  assert.match(output.messages[0].content[0].text, /Earlier skill catalogs are retired/);
  f.history.set(2, { type: 'user/message', data: output.messages[0] });
  f.agent.session.surface.nodes = [1, 2];
  assert.deepEqual(f.discovery.transformDecision(f.agent, { kind: 'enter', messages: [] }).messages, []);
  // The raw log still contains the old catalog, but compaction shadowed it.
  f.agent.session.surface.nodes = [];
  assert.deepEqual(f.discovery.transformDecision(f.agent, { kind: 'enter', messages: [] }).messages, []);
  f.discovery.dispose();
});

test('prepend post-next transform wraps stock listeners registered before OR after install', async () => {
  for (const stockFirst of [true, false]) {
    const f = fixture();
    const addStock = () => f.events.on('agent/pre-step', async (_payload, next) => {
      const decision = await next();
      return { ...decision, messages: [...decision.messages, stock([{ name: 'office' }])] };
    });
    if (stockFirst) addStock();
    const uninstall = f.discovery.install(f.agent);
    assert.equal(f.discovery.install(f.agent), uninstall);
    if (!stockFirst) addStock();
    const out = await f.events.step({ agent: f.agent }, { kind: 'enter', messages: [], startsRequestSeries: true });
    assert.deepEqual(out.messages, []);
    assert.equal(out.startsRequestSeries, true);
    uninstall();
    assert.equal(f.discovery.status(f.agent).installed, false);
    f.discovery.dispose();
  }
});

test('documents ordering boundary: a later third-party prepend can reintroduce a catalog', async () => {
  const f = fixture();
  f.discovery.install(f.agent);
  f.events.on('agent/pre-step', async (_payload, next) => {
    const decision = await next();
    return { ...decision, messages: [...decision.messages, stock([])] };
  }, { prepend: true });
  assert.equal((await f.events.step({ agent: f.agent }, { kind: 'enter', messages: [] })).messages.length, 1);
  f.discovery.dispose();
});

test('dispose removes cross-context listeners, invalidates cache and rejects later work', async () => {
  const f = fixture();
  f.discovery.install(f.agent);
  assert.equal(f.events.count('agent/pre-step'), 1);
  assert.equal(f.events.count('skills/change'), 1);
  f.discovery.dispose();
  f.discovery.dispose();
  assert.equal(f.events.count('agent/pre-step'), 0);
  assert.equal(f.events.count('skills/change'), 0);
  await assert.rejects(f.discovery.search(f.agent, 'office'), /disposed/);
});
