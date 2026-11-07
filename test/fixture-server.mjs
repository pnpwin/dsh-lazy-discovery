import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
const server = new Server({ name: 'lazy-discovery-fixture', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: 'A harmless echo fixture. Never use it for real side effects.' });
const tools = [{ name: 'echo', description: 'Echo text for a harmless integration test.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }];
server.setRequestHandler('tools/list', async () => ({ tools }));
server.setRequestHandler('tools/call', async request => {
  if (request.params.name !== 'echo') throw new Error('Unknown fixture tool');
  if (typeof request.params.arguments?.text !== 'string') return { content: [{ type: 'text', text: 'text must be a string' }], isError: true };
  return { content: [{ type: 'text', text: request.params.arguments.text }] };
});
await server.connect(new StdioServerTransport());
