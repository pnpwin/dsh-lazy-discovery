import path from 'node:path';
import { z as stateZod } from 'zod';
import { loadHostRuntime } from './lib/host-runtime.js';
const { configSchema: z, createUserMessage, createMcpToolDefinition, scopeChainOf, scrubbedParentEnv } = await loadHostRuntime();
import { CatalogCache } from './lib/catalog-cache.js';
import { LazyMcpManager, publicToolName } from './lib/mcp-manager.js';
import { createSdkConnector, validateServerConfig } from './lib/sdk-connector.js';
import { createSkillsDiscovery } from './lib/skills.js';
import { initialActivation, foldActivation } from './lib/activation.js';
import { createCredentialResolver } from './lib/credential-bindings.js';
import { installAuthSettings } from './lib/auth-api.js';

export const name = 'lazy-discovery';
export const inject = ['tools', 'skills', 'agents', 'workingDirectory', 'systemPrompt', 'sessionProjections'];
export const Config = z.object({
  uiOnly: z.boolean().default(false),
  cacheDirectory: z.string().required(),
  cacheMaxAgeMs: z.number().step(1).min(1000).max(86400000).default(1800000),
  skillMaxAgeMs: z.number().step(1).min(1000).max(300000).default(60000),
  servers: z.array(z.object({
    serverName: z.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/),
    transport: z.union([z.const('streamable-http'), z.const('stdio')]).required(),
    url: z.string(), command: z.string(), cwd: z.string(),
    args: z.array(String).default([]), headers: z.dict(String).default({}),
    env: z.dict(String).default({}),
    enabled: z.boolean().default(true),
    credentialTarget: z.string().pattern(/^[a-f0-9]{64}$/),
    headerRefs: z.dict(z.object({ name: z.string().required().pattern(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), prefix: z.string() })).default({}),
    envRefs: z.dict(z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)).default({}),
    toolCallTimeoutMs: z.number().step(1).min(100).max(600000).default(120000)
  })).default([])
});
const BOOTSTRAP = `Additional MCP tools and skill instructions are available through lazy discovery; their full catalogs are intentionally omitted.
Before specialized work, use skill_search with a short task description (Russian or English), then load applicable exact skill names with skill before acting. A user-named skill may be loaded directly; do not reload directly injected <skill_content>. Search returns summaries, not instructions. If discovery is incomplete, retry or narrow the query; do not assume absence. Critical permissions and safety rules still apply.
For external MCP capabilities use mcp_tools_search, then mcp_tools_load with selected exact IDs. The native tools appear on your NEXT step. Call those exact native tools normally; loading/searching is not permission to execute. Narrow or rephrase on no match; no generic guessed tool execution. Cached catalogs are hints, and upstream schemas are revalidated before use.
MCP connection credentials may be configured by name in Settings → MCP authorization. Use lazy_mcp_auth_status for binding names and configured states only; never ask for secret values in chat, read credential files, or grant a new server binding through tool arguments. Token Vault is optional: native DSH credential references and launch-environment fallbacks work without it.`;

function toolDefinition(name, description, properties, required, execute, concurrencySafe = true) {
  return { name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
    timeoutMs: 125000, isConcurrencySafe: () => concurrencySafe,
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute };
}

export async function apply(ctx, config) {
  // The package-root row contributes only the Client manifest; /host owns runtime.
  if (config.uiOnly) return;
  if (!path.isAbsolute(config.cacheDirectory)) throw new Error('cacheDirectory must be absolute');
  for (const server of config.servers) validateServerConfig(server);
  const cache = new CatalogCache({ directory: config.cacheDirectory });
  const activation = await ctx.sessionProjections.register({ key: 'localLazyMcpSelection', stateVersion: 1,
    stateSchema: stateZod.object({ selected: stateZod.record(stateZod.string(), stateZod.string()), pending: stateZod.record(stateZod.string(), stateZod.boolean()) }),
    init: initialActivation, apply: foldActivation });
  const manager = await new LazyMcpManager({ servers: config.servers, cache,
    maxAgeMs: config.cacheMaxAgeMs, connect: createSdkConnector({ scrubbedParentEnv }),
    resolveCredentials: createCredentialResolver(() => ctx.get('credentials')),
    createDefinition: ({ name, rawName, tool, call }) => {
      return createMcpToolDefinition(ctx, { name, rawName, description: tool.description,
        inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
        taskRequired: tool.execution?.taskSupport === 'required', call });
    }
  }).initialize();
  const agentDisposers = new Map();
  let disposed = false;
  let skills;
  // Own foreign Agent-context effects before installing any, including partial-apply failures.
  ctx.effect(() => async () => {
    disposed = true;
    for (const stop of [...agentDisposers.values()]) { try { stop(); } catch (error) { ctx.logger.warn(`Agent discovery cleanup: ${String(error)}`); } }
    try { skills?.dispose(); } finally { await manager.close(); await activation.dispose(); }
  });
  // Credentials are optional: disabling Vault UI or lacking a provider never disables
  // literal/keyless MCP connections or skills. Events carry names only.
  ctx.on('credentials/reference-updated', ref => {
    Promise.resolve(manager.invalidateCredentials(ref)).catch(() => {});
  });
  ctx.inject(['credentials'], providerCtx => {
    providerCtx.effect(() => () => manager.invalidateCredentials());
  });
  installAuthSettings(ctx, config);
  const stockSkillDefinitions = new WeakMap();
  const stockSkillScopes = new WeakMap();
  skills = createSkillsDiscovery({ ctx, cache, createUserMessage, getScopeIdentity: scopeChainOf,
    maxAgeMs: config.skillMaxAgeMs,
    isSkillVisible: agent => {
      const current = ctx.tools.get('skill', agent);
      const chain = [...scopeChainOf(agent)];
      const prior = stockSkillScopes.get(agent);
      if (!prior || chain.length !== prior.length || chain.some((item, i) => item !== prior[i])) {
        stockSkillScopes.set(agent, chain); stockSkillDefinitions.set(agent, current);
      }
      return Boolean(current && current === stockSkillDefinitions.get(agent));
    }
  });
  function configure(agent) {
    if (disposed || agentDisposers.has(agent)) return;
    stockSkillDefinitions.set(agent, ctx.tools.get('skill', agent));
    const uninstallSkills = skills.install(agent);
    const effect = agent.ctx.effect(() => {
      const stop = agent.ctx.on('agent/pre-step', async ({ agent: subject, signal }, next) => {
        const decision = await next();
        if (subject !== agent || decision.kind === 'reject') return decision;
        signal.throwIfAborted();
        await manager.restoreAvailable(agent, activation.stateOf(agent.session).selected, signal);
        return decision;
      }, { prepend: true });
      return () => { stop(); manager.release(agent); };
    });
    agentDisposers.set(agent, () => { effect(); uninstallSkills(); manager.release(agent); agentDisposers.delete(agent); });
  }
  ctx.on('agent/created', ({ agent }) => configure(agent));
  ctx.on('agent/disposed', ({ agent }) => agentDisposers.get(agent)?.());
  for (const agent of ctx.agents.list()) configure(agent);
  ctx.systemPrompt.section({ name: 'local-lazy-discovery', order: 91, text: BOOTSTRAP });

  ctx.tools.register(toolDefinition('mcp_tools_search', 'Search configured MCP catalogs without exposing all tool schemas. Returns bounded cards with exact IDs; load selected IDs with mcp_tools_load.', {
    query: { type: 'string', maxLength: 1000 }, server: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 8 }
  }, ['query'], async (args, exec) => manager.search(args.query, { server: args.server, limit: args.limit ?? 5, signal: exec.signal })));

  ctx.tools.register(toolDefinition('mcp_tools_load', 'Load 1–8 discovered MCP tool IDs as native tools for your next step. Does not execute them or grant permission.', {
    ids: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } }
  }, ['ids'], async (args, exec) => {
    if (!exec.agent) throw new Error('An owning Agent is required');
    configure(exec.agent);
    const selected = activation.stateOf(exec.agent.session).selected;
    if (new Set([...Object.keys(selected), ...args.ids]).size > 64) throw new Error('The session selection is limited to 64 tools; use a fresh task session.');
    const plan = await manager.plan(args.ids, exec.signal);
    return plan;
  }, false));

  ctx.tools.register(toolDefinition('skill_search', 'Search the cached skill catalog for this task. Returns only matching summaries and exact names; use skill to load full instructions. English and Russian aliases are supported.', {
    query: { type: 'string', maxLength: 1000 }, limit: { type: 'integer', minimum: 1, maximum: 8 }
  }, ['query'], async (args, exec) => {
    if (!exec.agent) throw new Error('An owning Agent is required');
    configure(exec.agent);
    return skills.search(exec.agent, args.query, { signal: exec.signal, limit: args.limit ?? 5 });
  }));

  ctx.tools.register(toolDefinition('discovery_status', 'Inspect lazy discovery cache/connection counts and schema byte measurements. Does not call an upstream business tool.', {}, [], async (_args, exec) => {
    if (!exec.agent) throw new Error('An owning Agent is required');
    configure(exec.agent);
    await manager.reconcileCredentials(exec.signal);
    const schemas = ctx.tools.schemas(exec.agent);
    const mcpNames = new Set([...manager.servers].flatMap(([server, state]) => (state.catalog?.tools ?? []).map(tool => publicToolName(server, tool.name))));
    const all = [...manager.servers].flatMap(([server, state]) => (state.catalog?.tools ?? []).map(tool => ({ name: publicToolName(server, tool.name), description: tool.description, parameters: tool.inputSchema })));
    const current = schemas.filter(tool => mcpNames.has(tool.name));
    const controls = schemas.filter(tool => ['skill_search', 'mcp_tools_load', 'mcp_tools_search', 'discovery_status'].includes(tool.name));
    const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
    const snapshot = await ctx.skills.snapshot({ cwd, scope: exec.agent, signal: exec.signal });
    const descriptions = snapshot.skills.filter(x => x.invocation.modelInvocable).map(x => ({ name: x.name, description: x.description.slice(0, 500) }));
    return { ...manager.status(exec.agent), skillCache: skills.status(exec.agent),
      skillsAvailable: descriptions.length, skillCatalogComplete: snapshot.complete,
      catalogCoverage: { knownServers: [...manager.servers.values()].filter(s => s.catalog).length, totalServers: manager.servers.size,
        complete: [...manager.servers.values()].every(s => Boolean(s.catalog) && !s.invalid) },
      measurements: { unit: 'serialized JSON UTF-8 bytes; NOT provider tokens or billing; MCP eager comparison covers known catalogs only',
        eagerMcpSchemasBytes: Buffer.byteLength(JSON.stringify(all)), nativeMcpSchemasBytes: Buffer.byteLength(JSON.stringify(current)),
        discoveryControlSchemasBytes: Buffer.byteLength(JSON.stringify(controls)), eagerSkillDescriptionsBytes: Buffer.byteLength(JSON.stringify(descriptions)),
        totalVisibleNativeTools: schemas.length },
      experimentalProxyEnabled: false, configuredServers: config.servers.map(s => s.serverName),
      selectedFromLog: Object.keys(activation.stateOf(exec.agent.session).selected) };
  }));

}
