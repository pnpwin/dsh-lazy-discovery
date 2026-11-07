import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createSdkConnector, validateServerConfig } from '../src/lib/sdk-connector.js';
import { LazyMcpManager, publicToolName } from '../src/lib/mcp-manager.js';
import { createExperimentalProxy } from '../src/lib/proxy.js';

test('real SDK stdio negotiation, discovery and harmless call', async () => {
  const connect = createSdkConnector();
  const client = await connect({ serverName: 'fixture', transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url))], toolCallTimeoutMs: 5000 });
  try {
    const catalog = await client.listTools(); assert.equal(catalog.tools[0].name, 'echo');
    const result = await client.callTool('echo', { text: 'transport verified' }, { timeout: 5000, toolDefinition: catalog.tools[0] });
    assert.equal(result.content[0].text, 'transport verified');
  } finally { await client.close(); }
});
test('3. proxy is opt-in and cannot exist without exact allowlist', () => {
  assert.throws(() => createExperimentalProxy({ manager: {}, allowTools: [] }), /allowTools/);
  assert.throws(() => validateServerConfig({ serverName: 'x', transport: 'streamable-http', url: 'http://example.com/mcp' }), /loopback/);
});
test('3. FastMCP-style proxy lists exactly two tools, searches and executes only allowlisted exact schema', async () => {
  let calls = 0;
  const tools = ['echo', 'forbidden'].map(name => ({ name, description: `Read-only ${name}`, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }));
  const manager = await new LazyMcpManager({ servers: [{ serverName: 'fixture' }],
    connect: async () => ({ instructions: '', listTools: async () => ({ tools }), callTool: async (_name, args) => { calls++; return { content: [{ type: 'text', text: args.text }] }; }, close: async () => {} }),
    createDefinition: () => { throw new Error('not used'); }
  }).initialize();
  const id = publicToolName('fixture', 'echo');
  const server = createExperimentalProxy({ manager, allowTools: [id] });
  const client = new Client({ name: 'proxy-test', version: '1' }, { capabilities: {} });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left); await client.connect(right);
  try {
    const catalog = await client.listTools(); assert.deepEqual(catalog.tools.map(x => x.name), ['search_tools', 'call_tool']);
    const result = await client.callTool({ name: 'search_tools', arguments: { query: 'echo' } });
    const found = JSON.parse(result.content[0].text).tools; assert.equal(found.length, 1); assert.equal(found[0].id, id);
    const rejected = await client.callTool({ name: 'call_tool', arguments: { id: publicToolName('fixture', 'forbidden'), schema_hash: found[0].schema_hash, arguments: { text: 'no' } } });
    assert.equal(rejected.isError, true); assert.equal(calls, 0);
    const stale = await client.callTool({ name: 'call_tool', arguments: { id, schema_hash: 'outdated', arguments: { text: 'no' } } });
    assert.equal(stale.isError, true); assert.equal(calls, 0);
    const echoed = await client.callTool({ name: 'call_tool', arguments: { id, schema_hash: found[0].schema_hash, arguments: { text: 'proxy verified' } } });
    assert.equal(echoed.content[0].text, 'proxy verified'); assert.equal(calls, 1);
  } finally { await client.close(); await server.close(); await manager.close(); }
});
