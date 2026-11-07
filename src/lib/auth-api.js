import { createAuthSettings, authFailure, readAuthBody } from './auth-state.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });

export function installAuthSettings(ctx, config) {
  const settings = createAuthSettings(ctx, config);
  // Binding writes grant authority and remain user-only. The tool is read-only.
  ctx.effect(() => ctx.tools.register({ name: 'lazy_mcp_auth_status', description: 'Read configured lazy MCP credential bindings and configured states, never values. No network connection is opened. Configure or grant bindings only in Settings → MCP authorization.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true, async execute() { try { return await settings.snapshot(); } catch (error) { return authFailure(error); } },
  }));
  const handle = operation => async request => {
    try { return json(await operation(request)); }
    catch (error) { const failure = authFailure(error); return json(failure, failure.error.code === 'operation-failed' ? 503 : 400); }
  };
  ctx.inject(['connection'], child => {
    // Connection's node bridge always supplies a body for streaming routes. GET
    // must therefore be buffered; distinct paths allow POST to stay bounded at
    // 32 KiB by readAuthBody rather than using the carrier's much larger buffer.
    for (const route of [
      { path: '/api/lazy-discovery/auth', methods: ['GET'], requestBody: 'buffered', fetch: handle(() => settings.snapshot()) },
      { path: '/api/lazy-discovery/auth/save', methods: ['POST'], requestBody: 'streaming', fetch: handle(async request => settings.update(await readAuthBody(request))) },
    ]) child.effect(() => child.connection.fetch.register(route));
  });
  return settings;
}
