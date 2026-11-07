import test from 'node:test';
import assert from 'node:assert/strict';
import { LazyMcpManager, publicToolName, schemaHash } from '../src/lib/mcp-manager.js';

const tool = (name = 'echo') => ({ name, description: `Read-only ${name} test`, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
function fixture({ saved, catalog = [tool()], connectFailure = false } = {}) {
  const data = new Map(saved ?? []); let calls = 0; let connects = 0; let discoveries = 0; let listChanged;
  const cache = { read: async (key, options) => { const value = data.get(key); return value && (!options.validate || options.validate(value.value)) ? value : null; }, write: async (key, value) => data.set(key, { value, savedAt: Date.now() }) };
  const manager = new LazyMcpManager({ servers: [{ serverName: 'fixture', transport: 'stdio', command: 'unused' }], cache,
    connect: async (config, handlers) => { connects++; listChanged = handlers.onListChanged; if (connectFailure) throw new Error('offline'); return {
      instructions: 'Use only the echo fixture.', listTools: async () => { discoveries++; return { tools: catalog }; },
      callTool: async (name, args, opts) => { opts.signal?.throwIfAborted(); calls++; return { content: [{ type: 'text', text: args.text }] }; }, close: async () => {}
    }; }, createDefinition: ({ name, tool, call }) => ({ name, parameters: tool.inputSchema, execute: call })
  });
  const registered = new Map(); const agent = { session: {}, ctx: { tools: { get: name => registered.get(name), register: definition => { registered.set(definition.name, definition); return () => registered.delete(definition.name); } } } };
  return { manager, agent, registered, data, catalog, counts: () => ({ calls, connects, discoveries }), change: () => listChanged() };
}

test('1. native registration is empty until selected, isolated by exact Agent', async () => {
  const f = fixture(); await f.manager.initialize();
  assert.equal(f.registered.size, 0); assert.equal(f.counts().connects, 0);
  const found = await f.manager.search('echo'); assert.equal(found.results.length, 1); assert.equal(f.registered.size, 0);
  const loaded = await f.manager.activate(f.agent, [found.results[0].id]);
  assert.equal(loaded.ready, 'next-step'); assert.equal(f.registered.size, 1); assert.equal(f.counts().calls, 0);
  const independent = { session: {}, ctx: f.agent.ctx }; assert.deepEqual(f.manager.status(independent).activeTools, []);
  f.manager.release(f.agent); assert.equal(f.registered.size, 0); await f.manager.close();
});
test('1. native callback validates same schema and dispatches only selected operation', async () => {
  const f = fixture(); const id = publicToolName('fixture', 'echo'); await f.manager.activate(f.agent, [id]);
  const result = await f.registered.get(id).execute({ text: 'hello' }, { signal: new AbortController().signal });
  assert.equal(result.content[0].text, 'hello'); assert.equal(f.counts().calls, 1); await f.manager.close();
});
test('2. catalog survives restart and warm search/load make zero connections', async () => {
  const initial = fixture(); await initial.manager.search('echo'); await initial.manager.close();
  const warm = fixture({ saved: initial.data }); await warm.manager.initialize();
  const result = await warm.manager.search('echo'); await warm.manager.activate(warm.agent, [result.results[0].id]);
  assert.deepEqual(warm.counts(), { connects: 0, discoveries: 0, calls: 0 });
  await warm.registered.get(result.results[0].id).execute({ text: 'first use' }, { signal: new AbortController().signal });
  assert.deepEqual(warm.counts(), { connects: 1, discoveries: 1, calls: 1 }); await warm.manager.close();
});
test('2. cached schema never authorizes changed operation after reconnect', async () => {
  const initial = fixture(); await initial.manager.search('echo'); await initial.manager.close();
  const altered = tool(); altered.inputSchema.properties.text.type = 'number';
  const warm = fixture({ saved: initial.data, catalog: [altered] }); await warm.manager.initialize();
  const id = publicToolName('fixture', 'echo'); await warm.manager.activate(warm.agent, [id]);
  await assert.rejects(warm.registered.get(id).execute({ text: 'old' }, {}), { code: 'STALE_MCP_SCHEMA' });
  assert.equal(warm.counts().calls, 0); await warm.manager.close();
});
test('2. removal notification blocks stale operation without side effect', async () => {
  const f = fixture(); const id = publicToolName('fixture', 'echo'); await f.manager.activate(f.agent, [id]);
  f.catalog.length = 0; f.change();
  await assert.rejects(f.registered.get(id).execute({ text: 'no' }, {}), { code: 'STALE_MCP_SCHEMA' });
  assert.equal(f.counts().calls, 0); await f.manager.close();
});
test('2. offline discovery is explicit, never reported as complete absence', async () => {
  const f = fixture({ connectFailure: true }); const result = await f.manager.search('echo');
  assert.deepEqual(result.unavailable, ['fixture']); assert.equal(result.results.length, 0); await f.manager.close();
});
test('cancellation before invocation and unload prevent dispatch', async () => {
  const f = fixture(); const id = publicToolName('fixture', 'echo'); await f.manager.activate(f.agent, [id]);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(f.registered.get(id).execute({ text: 'no' }, { signal: abort.signal }));
  assert.equal(f.counts().calls, 0); await f.manager.close(); assert.equal(f.registered.size, 0);
});
test('stable tool identity does not conflate lossy names', () => {
  assert.notEqual(publicToolName('fixture', 'a.b'), publicToolName('fixture', 'a_b'));
  assert.ok(publicToolName('fixture', 'a'.repeat(100)).length <= 64);
  assert.notEqual(schemaHash(tool('x')), schemaHash(tool('y')));
});
