import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { publicToolName } from './mcp-manager.js';

export function createExperimentalProxy({ manager, allowTools }) {
  if (!Array.isArray(allowTools) || !allowTools.length || allowTools.some(x => typeof x !== 'string')) throw new Error('Experimental proxy requires an explicit non-empty allowTools list');
  const allowed = new Set(allowTools);
  const server = new Server({ name: 'dsh-lazy-discovery-proxy', version: '1.0.0' }, {
    capabilities: { tools: {} }, instructions: 'Experimental allowlisted MCP search/call proxy. Search first, then use the exact returned id and schema_hash. Discovery is not execution authorization.'
  });
  server.setRequestHandler('tools/list', async () => ({ tools: [
    { name: 'search_tools', description: 'Find allowlisted MCP tools and their exact schemas.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
    { name: 'call_tool', description: 'Call one explicitly allowlisted tool using its discovered schema hash. Requires host approval for the target operation.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, schema_hash: { type: 'string' }, arguments: { type: 'object' } }, required: ['id', 'schema_hash', 'arguments'], additionalProperties: false } }
  ] }));
  server.setRequestHandler('tools/call', async (request, context) => {
    const { name, arguments: args = {} } = request.params;
    try {
      if (name === 'search_tools') {
        if (typeof args.query !== 'string' || args.query.length > 1000) throw new Error('query must be a string up to 1000 characters');
        const entries = [];
        for (const provider of manager.servers.keys()) {
          const catalog = await manager.catalog(provider, { signal: context.signal });
          for (const tool of catalog.tools) if (allowed.has(publicToolName(provider, tool.name))) entries.push({ id: publicToolName(provider, tool.name), name: tool.name, description: tool.description, kind: 'tool', provider });
        }
        const { searchCatalog } = await import('./search.js');
        const found = searchCatalog(entries, args.query, { limit: 5, maxChars: 4000 });
        const tools = [];
        for (const card of found.results) {
          const resolved = await manager.resolve(card.id, context.signal);
          const candidate = { id: card.id, schema_hash: resolved.hash, ...resolved.tool };
          if (JSON.stringify([...tools, candidate]).length > 24000) break;
          tools.push(candidate);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ tools, truncated: tools.length < found.results.length || found.truncated }) }] };
      }
      if (name === 'call_tool') {
        if (!allowed.has(args.id)) throw new Error('Target tool is not explicitly allowlisted');
        if (!args.arguments || typeof args.arguments !== 'object' || Array.isArray(args.arguments)) throw new Error('arguments must be an object');
        const resolved = await manager.resolve(args.id, context.signal);
        if (args.schema_hash !== resolved.hash) throw new Error('Schema changed: search again');
        return await manager.call(resolved.server, resolved.tool.name, resolved.hash, args.arguments, context.signal);
      }
      throw new Error('Unknown proxy tool');
    } catch (error) {
      return { content: [{ type: 'text', text: String(error.message).slice(0, 1500) }], isError: true };
    }
  });
  return server;
}
export async function serveProxy(options) {
  const server = createExperimentalProxy(options);
  await server.connect(new StdioServerTransport());
  return server;
}
