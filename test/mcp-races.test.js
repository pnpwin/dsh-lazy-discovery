import test from 'node:test';
import assert from 'node:assert/strict';
import { LazyMcpManager, publicToolName, schemaHash } from '../src/lib/mcp-manager.js';
import { initialActivation, foldActivation } from '../src/lib/activation.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function promptly(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Operation did not settle promptly')), 500);
    })]);
  } finally { clearTimeout(timer); }
}
function tool(extra = {}) {
  return { name: 'echo', description: 'A harmless read-only fixture.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false }, ...extra };
}
function fakeAgent() {
  const registered = new Map();
  return { registered, session: {}, ctx: { tools: {
    get: name => registered.get(name),
    register: definition => {
      assert.ok(!registered.has(definition.name), 'no duplicate registration');
      registered.set(definition.name, definition);
      return () => { if (registered.get(definition.name) === definition) registered.delete(definition.name); };
    },
  } } };
}
function fixture(t, { list, connectGate, close = () => {}, cache } = {}) {
  let handlers;
  const counters = { connects: 0, lists: 0, calls: 0, closes: 0 };
  const manager = new LazyMcpManager({
    servers: [{ serverName: 'fixture', transport: 'stdio', command: 'not-executed' }], cache,
    connect: async (_config, callbacks) => {
      handlers = callbacks;
      counters.connects++;
      if (connectGate) await connectGate.promise;
      return {
        instructions: 'Fixture instructions.',
        listTools: async options => { counters.lists++; return list ? list(counters.lists, options, callbacks) : { tools: [tool()] }; },
        callTool: async () => { counters.calls++; return { content: [{ type: 'text', text: 'ok' }] }; },
        close: async () => { counters.closes++; await close(); callbacks.onClose(); },
      };
    },
    createDefinition: ({ name, tool: upstream, call }) => ({ name, parameters: upstream.inputSchema,
      execute: (args, execution = {}) => call(args, execution) }),
  });
  t.after(async () => {
    connectGate?.resolve();
    await manager.close();
  });
  return { manager, counters, notify: () => handlers.onListChanged(), handlers: () => handlers };
}

test('notification during listing cannot publish or authorize the pre-notification schema', { timeout: 2_000 }, async t => {
  const started = deferred();
  const stalePage = deferred();
  const changed = tool({ inputSchema: { type: 'object', properties: { count: { type: 'integer' } } } });
  const f = fixture(t, { list: async number => {
    if (number === 1) { started.resolve(); return stalePage.promise; }
    return { tools: [changed] };
  } });
  const pending = f.manager.discover('fixture');
  await started.promise;
  f.notify();
  stalePage.resolve({ tools: [tool()] });
  const catalog = await pending;
  assert.deepEqual(catalog.tools[0].inputSchema, changed.inputSchema);
  assert.equal(f.counters.lists, 2);
  await assert.rejects(f.manager.call('fixture', 'echo', schemaHash(tool()), {}, new AbortController().signal), { code: 'STALE_MCP_SCHEMA' });
  assert.equal(f.counters.calls, 0);
});

test('notification during cache persistence is revalidated before discovery returns', { timeout: 2_000 }, async t => {
  const writing = deferred();
  const finishWrite = deferred();
  let writes = 0;
  const changed = tool({ description: 'New instructions and semantics.' });
  const f = fixture(t, {
    cache: { write: async () => { if (++writes === 1) { writing.resolve(); await finishWrite.promise; } } },
    list: async number => ({ tools: [number === 1 ? tool() : changed] }),
  });
  const pending = f.manager.discover('fixture');
  await writing.promise;
  f.notify();
  finishWrite.resolve();
  assert.equal((await pending).tools[0].description, changed.description);
  assert.equal(f.counters.lists, 2);
});

test('continually changing catalogs fail closed after a bounded retry count', { timeout: 2_000 }, async t => {
  const f = fixture(t, { list: async (_number, _options, callbacks) => {
    callbacks.onListChanged();
    return { tools: [tool()] };
  } });
  await assert.rejects(f.manager.discover('fixture'), /changed during discovery/);
  assert.equal(f.counters.lists, 3);
  assert.equal(f.manager.state('fixture').invalid, true);
  assert.equal(f.counters.calls, 0);
});

test('execution task support participates in schema identity and blocks a stale native callback', async t => {
  const optional = tool({ execution: { taskSupport: 'optional' } });
  const required = tool({ execution: { taskSupport: 'required' } });
  assert.notEqual(schemaHash(optional), schemaHash(required));
  assert.notEqual(schemaHash(tool()), schemaHash(required));
  let upstream = optional;
  const f = fixture(t, { list: async () => ({ tools: [upstream] }) });
  const agent = fakeAgent();
  const id = publicToolName('fixture', 'echo');
  const plan = await f.manager.plan([id]);
  await f.manager.restoreAvailable(agent, Object.fromEntries(plan.activated.map(x => [x.id, x.hash])));
  const native = agent.registered.get(id);
  upstream = required;
  f.notify();
  await assert.rejects(native.execute({}, {}), { code: 'STALE_MCP_SCHEMA' });
  assert.equal(f.counters.calls, 0);
});

test('one cancelled connection waiter settles promptly without aborting a shared connection', { timeout: 2_000 }, async t => {
  const connectGate = deferred();
  const f = fixture(t, { connectGate });
  const controller = new AbortController();
  const first = f.manager.connection(f.manager.state('fixture'), controller.signal);
  const rejection = assert.rejects(first, /cancel first waiter/);
  const second = f.manager.connection(f.manager.state('fixture'));
  controller.abort(new Error('cancel first waiter'));
  await promptly(rejection);
  assert.equal(f.handlers().signal.aborted, false);
  assert.equal(f.counters.connects, 1);
  connectGate.resolve();
  assert.ok(await promptly(second));
  assert.equal(f.counters.closes, 0);
});

test('one cancelled discovery waiter does not abort or duplicate a shared catalog request', { timeout: 2_000 }, async t => {
  const started = deferred();
  const listGate = deferred();
  let requestSignal;
  const f = fixture(t, { list: async (_number, options) => { requestSignal = options.signal; started.resolve(); return listGate.promise; } });
  const controller = new AbortController();
  const first = f.manager.discover('fixture', controller.signal);
  const rejection = assert.rejects(first, /cancel discovery waiter/);
  const second = f.manager.discover('fixture');
  await started.promise;
  controller.abort(new Error('cancel discovery waiter'));
  await promptly(rejection);
  assert.equal(requestSignal.aborted, false);
  listGate.resolve({ tools: [tool()] });
  assert.equal((await promptly(second)).tools[0].name, 'echo');
  assert.equal(f.counters.lists, 1);
});

test('unload closes transport and aborts lifecycle before waiting for pending discovery', { timeout: 2_000 }, async t => {
  const started = deferred();
  const listGate = deferred();
  let discoverySignal;
  const f = fixture(t, {
    list: async (_number, options) => { discoverySignal = options.signal; started.resolve(); return listGate.promise; },
    close: () => listGate.reject(new Error('fixture transport closed')),
  });
  const pending = f.manager.discover('fixture');
  const rejection = assert.rejects(pending, /transport closed|connection closed/);
  await started.promise;
  await promptly(f.manager.close());
  await rejection;
  assert.equal(discoverySignal.aborted, true);
  assert.equal(f.counters.closes, 1);
  assert.equal(f.manager.state('fixture').client, null);
  await f.manager.close();
  assert.equal(f.counters.closes, 1);
});

test('plan is effect-free until a successful committed tool result is folded then restored', async t => {
  const f = fixture(t);
  const agent = fakeAgent();
  const otherAgent = fakeAgent();
  const id = publicToolName('fixture', 'echo');
  const plan = await f.manager.plan([id]);
  assert.equal(plan.ready, 'next-step');
  assert.equal(f.counters.calls, 0);
  assert.equal(agent.registered.size, 0);
  assert.equal(f.manager.status(agent).activeTools.length, 0);
  assert.deepEqual(Object.keys(plan.activated[0]).sort(), ['hash', 'id']);
  assert.ok(!JSON.stringify(plan).includes('inputSchema'));

  const call = { type: 'tool/call', data: { name: 'mcp_tools_load', callId: 'load-1' } };
  const result = { type: 'tool/result', data: { message: { toolCallId: 'load-1', isError: false, content: [{ type: 'text', text: JSON.stringify(plan) }] } } };
  const before = foldActivation(initialActivation(), call);
  await f.manager.restoreAvailable(agent, before.selected);
  assert.equal(agent.registered.size, 0, 'an unfinished call is not activation');
  const committed = foldActivation(before, result);
  assert.equal(agent.registered.size, 0, 'log folding itself does not mutate the registry');
  await f.manager.restoreAvailable(agent, committed.selected);
  assert.equal(agent.registered.size, 1);
  assert.equal(otherAgent.registered.size, 0);
  assert.equal(f.counters.calls, 0);
  assert.equal(f.counters.lists, 1, 'restore did not repeat network discovery');
});

test('failed, unrelated and unmatched results cannot activate selected tools', async t => {
  const f = fixture(t);
  const id = publicToolName('fixture', 'echo');
  const plan = await f.manager.plan([id]);
  const pending = foldActivation(initialActivation(), { type: 'tool/call', data: { name: 'mcp_tools_load', callId: 'load-1' } });
  for (const [callId, isError, error] of [['load-1', true, undefined], ['different-call', false, undefined], ['load-1', false, { code: 'DENIED' }]]) {
    const state = foldActivation(pending, { type: 'tool/result', data: { error, message: { toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(plan) }] } } });
    const agent = fakeAgent();
    await f.manager.restoreAvailable(agent, state.selected);
    assert.equal(agent.registered.size, 0);
  }
});

test('malformed logged activation JSON never throws or mutates committed selection', () => {
  const pending = foldActivation(initialActivation(), { type: 'tool/call', data: { name: 'mcp_tools_load', callId: 'load-1' } });
  for (const value of [null, [], 1, 'text', { version: 1, activated: [null] }, { version: 1, activated: [1] }, { version: 1, activated: [{ id: '__proto__', hash: 'a'.repeat(64) }] }]) {
    const state = foldActivation(pending, { type: 'tool/result', data: { message: { toolCallId: 'load-1', isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] } } });
    assert.deepEqual(state.selected, {});
    assert.deepEqual(state.pending, {});
  }
});

test('prototype-named result IDs cannot bypass a prior matching load call', () => {
  const plan = { version: 1, activated: [{ id: publicToolName('fixture', 'echo'), hash: schemaHash(tool()) }] };
  for (const toolCallId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const initial = initialActivation();
    const state = foldActivation(initial, { type: 'tool/result', data: { message: { toolCallId, isError: false, content: [{ type: 'text', text: JSON.stringify(plan) }] } } });
    assert.equal(state, initial);
    assert.deepEqual(state.selected, {});
  }
});

test('restore does not perform network work for missing, expired or hash-mismatched cache hints', async t => {
  const f = fixture(t);
  const agent = fakeAgent();
  const id = publicToolName('fixture', 'echo');
  await f.manager.restoreAvailable(agent, { [id]: schemaHash(tool()) });
  assert.equal(f.counters.connects, 0);
  const plan = await f.manager.plan([id]);
  await f.manager.restoreAvailable(agent, { [id]: '0'.repeat(64) });
  assert.equal(agent.registered.size, 0);
  f.manager.state('fixture').savedAt = 0;
  await f.manager.restoreAvailable(agent, { [id]: plan.activated[0].hash });
  assert.equal(agent.registered.size, 0);
  assert.equal(f.counters.connects, 1);
  assert.equal(f.counters.lists, 1);
});

test('old transport callbacks cannot invalidate a replacement connection generation', async t => {
  const f = fixture(t);
  const first = await f.manager.connection(f.manager.state('fixture'));
  const oldHandlers = f.handlers();
  oldHandlers.onClose();
  const second = await f.manager.connection(f.manager.state('fixture'));
  assert.notEqual(first, second);
  const before = f.manager.state('fixture').revision;
  oldHandlers.onClose();
  oldHandlers.onListChanged();
  assert.equal(f.manager.state('fixture').client, second);
  assert.equal(f.manager.state('fixture').revision, before);
});
