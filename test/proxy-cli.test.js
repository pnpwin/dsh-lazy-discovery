import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkConnector } from '../src/lib/sdk-connector.js';

test('3. experimental proxy CLI works as a real stdio MCP server with a nested local provider', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-proxy-smoke-'));
  const file = path.join(directory, 'proxy.json');
  await writeFile(file, JSON.stringify({ cacheDirectory: path.join(directory, 'catalog'),
    allowTools: ['mcp__fixture__echo'], servers: [{ serverName: 'fixture', transport: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url))], toolCallTimeoutMs: 5000 }] }), { mode: 0o600 });
  const client = await createSdkConnector()({ serverName: 'proxy', transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('../src/proxy.mjs', import.meta.url)), '--experimental', `--config=${file}`], toolCallTimeoutMs: 10000 });
  try {
    const catalog = await client.listTools(); assert.equal(catalog.tools.length, 2);
    const found = await client.callTool('search_tools', { query: 'echo' }, { timeout: 10000 });
    const [tool] = JSON.parse(found.content[0].text).tools;
    assert.equal(tool.id, 'mcp__fixture__echo');
    const echoed = await client.callTool('call_tool', { id: tool.id, schema_hash: tool.schema_hash, arguments: { text: 'stdio proxy verified' } }, { timeout: 10000 });
    assert.equal(echoed.content[0].text, 'stdio proxy verified');
  } finally { await client.close(); }
  // Test artifacts contain no credentials; retained in a dedicated temporary directory for diagnosis.
});
