import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export function validateServerConfig(config) {
  if (!config || !/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) throw new Error('Invalid MCP serverName');
  if (config.transport === 'streamable-http') {
    const url = new URL(config.url);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid MCP endpoint');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Plain HTTP is permitted only on loopback');
  } else if (config.transport === 'stdio') {
    if (typeof config.command !== 'string' || !config.command || !Array.isArray(config.args ?? [])) throw new Error('Invalid stdio MCP command');
  } else throw new Error('Unsupported MCP transport');
  if (config.toolCallTimeoutMs !== undefined && (!Number.isInteger(config.toolCallTimeoutMs) || config.toolCallTimeoutMs < 100 || config.toolCallTimeoutMs > 600000)) throw new Error('toolCallTimeoutMs must be 100–600000');
  return config;
}
export function defaultScrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|PASSWORD|SECRET|TOKEN/i.test(key) && !key.startsWith('DSH_')));
}
export function createSdkConnector({ scrubbedParentEnv = defaultScrubbedEnv } = {}) {
  return async (rawConfig, { onListChanged = () => {}, onClose = () => {}, signal } = {}) => {
    const config = validateServerConfig(rawConfig);
    const timeout = config.toolCallTimeoutMs ?? 120000;
    const client = new Client({ name: 'dsh-lazy-discovery', version: '1.0.0' }, {
      capabilities: {}, versionNegotiation: { mode: 'auto' },
      listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: onListChanged } },
      listMaxPages: 100
    });
    let closed = false;
    client.onclose = () => { closed = true; onClose(); };
    const transport = config.transport === 'streamable-http'
      ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers ?? {}, redirect: 'error' } })
      : new StdioClientTransport({ command: config.command, args: config.args ?? [],
          cwd: config.cwd || undefined, env: { ...scrubbedParentEnv(), ...(config.env ?? {}) }, stderr: 'pipe' });
    // Drain rather than retain stderr: no credential-bearing server logs enter the model or an unbounded buffer.
    if (config.transport === 'stdio') transport.stderr?.resume();
    try {
      await client.connect(transport, { timeout: Math.min(timeout, 30000),
        signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(Math.min(timeout, 30000))]) });
      if (closed) throw new Error('MCP transport closed while connecting');
    }
    catch (error) { await client.close().catch(() => transport.close().catch(() => {})); throw error; }
    return {
      get instructions() { return client.getInstructions() ?? ''; },
      listTools: ({ signal: requestSignal } = {}) => client.getServerCapabilities()?.tools === undefined
        ? Promise.resolve({ tools: [] }) : client.listTools(undefined, { cacheMode: 'refresh', timeout, signal: requestSignal }),
      callTool: (name, args, options) => client.callTool({ name, arguments: args }, options),
      close: () => client.close(),
      // Resources remain behind the same lazy connection and timeout policy.
      resource: (method, params, options) => {
        if (method === 'resources/list') return client.getServerCapabilities()?.resources ? client.listResources(params, options) : { resources: [] };
        if (method === 'resources/templates/list') return client.getServerCapabilities()?.resources ? client.listResourceTemplates(params, options) : { resourceTemplates: [] };
        if (method === 'resources/read') return client.readResource(params, options);
        throw new Error('Unknown MCP resource operation');
      }
    };
  };
}
