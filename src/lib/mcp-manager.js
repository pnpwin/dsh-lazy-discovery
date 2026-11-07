import { createHash } from 'node:crypto';
import { searchCatalog } from './search.js';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function publicToolName(server, raw) {
  const full = `mcp__${server}__${raw}`;
  if (/^[A-Za-z0-9_-]+$/.test(full) && full.length <= 64) return full;
  const suffix = createHash('sha256').update(`${server}\0${raw}`).digest('hex').slice(0, 12);
  return `${full.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 51)}_${suffix}`;
}
export function validateCatalog(value) {
  if (!value || !Array.isArray(value.tools) || value.tools.length > 10000) return false;
  const names = new Set();
  for (const tool of value.tools) {
    if (!tool || typeof tool.name !== 'string' || !tool.name || tool.name.length > 512 || names.has(tool.name)) return false;
    if (!tool.inputSchema || tool.inputSchema.type !== 'object' || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) return false;
    if (tool.description !== undefined && (typeof tool.description !== 'string' || tool.description.length > 64000)) return false;
    names.add(tool.name);
  }
  return typeof value.instructions === 'string' && value.instructions.length <= 32768;
}
export function schemaHash(tool) {
  return hash({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema, outputSchema: tool.outputSchema ?? null, execution: tool.execution ?? null });
}
export function sanitizeTool(tool) {
  // Never persist transport config, headers, credentials, arbitrary _meta or icons.
  return { name: tool.name, description: tool.description ?? '', inputSchema: structuredClone(tool.inputSchema),
    ...(tool.outputSchema ? { outputSchema: structuredClone(tool.outputSchema) } : {}),
    ...(tool.execution ? { execution: { taskSupport: tool.execution.taskSupport } } : {}) };
}
function requiredAgent(agent) { if (!agent?.ctx || !agent?.session) throw new Error('An owning DSH Agent is required'); }
function waitFor(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Discovery aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}

/** Host-only catalog; execution always revalidates current upstream schema before dispatch. */
export class LazyMcpManager {
  constructor({ servers = [], cache, connect, createDefinition, now = Date.now, maxAgeMs = 1800000, onSchemaChange = () => {} }) {
    this.cache = cache; this.connect = connect; this.createDefinition = createDefinition; this.now = now;
    this.maxAgeMs = maxAgeMs; this.onSchemaChange = onSchemaChange; this.closed = false;
    this.lifecycle = new AbortController(); this.closing = null;
    this.agents = new Map();
    this.servers = new Map(servers.map(config => {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) throw new Error('Invalid serverName');
      const identity = hash({ version: 1, config });
      return [config.serverName, { config: structuredClone(config), key: identity, catalog: null, savedAt: 0,
        source: 'empty', client: null, pending: null, refresh: null, invalid: false, revision: 0,
        connections: 0, discoveries: 0, calls: 0, cacheHits: 0 }];
    }));
    if (this.servers.size !== servers.length) throw new Error('Duplicate MCP serverName');
  }
  async initialize() {
    for (const state of this.servers.values()) {
      const saved = await this.cache?.read(state.key, { maxAgeMs: this.maxAgeMs, validate: validateCatalog });
      if (saved) { state.catalog = saved.value; state.savedAt = saved.savedAt; state.source = 'disk'; state.cacheHits++; }
    }
    return this;
  }
  state(name) { const state = this.servers.get(name); if (!state) throw new Error(`Unknown configured MCP server: ${name}`); return state; }
  async connection(state, signal) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Lazy MCP bridge is closed');
    if (state.client) return state.client;
    if (!state.pending) {
      state.pending = (async () => {
        const generation = Symbol('connection'); state.generation = generation;
        const client = await this.connect(state.config, {
          signal: this.lifecycle.signal,
          onListChanged: () => { if (state.generation !== generation) return; state.invalid = true; state.revision++; this.onSchemaChange(state.config.serverName); },
          onClose: () => { if (state.generation !== generation) return; state.client = null; state.invalid = true; state.revision++; }
        });
        if (this.closed) { await client.close(); throw new Error('Lazy MCP bridge closed during connection'); }
        state.client = client; state.connections++;
        return client;
      })().finally(() => { state.pending = null; });
    }
    // One caller's cancellation must not cancel another caller's shared connection.
    const client = await waitFor(state.pending, signal);
    signal?.throwIfAborted();
    return client;
  }
  async discover(name, signal) {
    const state = this.state(name);
    if (!state.refresh) {
      state.refresh = (async () => {
        const client = await this.connection(state);
        for (let attempt = 0; attempt < 3; attempt++) {
          const revision = state.revision;
          const response = await client.listTools({ signal: this.lifecycle.signal });
          if (this.closed || state.client !== client) throw new Error('MCP connection closed during discovery');
          if (revision !== state.revision) continue;
          const catalog = { tools: (response.tools ?? []).map(sanitizeTool), instructions: String(client.instructions ?? '') };
          if (!validateCatalog(catalog) || JSON.stringify(catalog).length > 8 * 1024 * 1024) throw new Error('MCP catalog is invalid or exceeds its limit');
          state.catalog = catalog; state.savedAt = this.now(); state.source = 'live'; state.invalid = false; state.discoveries++;
          try { await this.cache?.write(state.key, catalog); } catch { /* Read-only cache storage does not block current discovery. */ }
          if (revision !== state.revision) continue;
          return catalog;
        }
        state.invalid = true;
        throw new Error('MCP catalog changed during discovery; retry search');
      })().finally(() => { state.refresh = null; });
    }
    const catalog = await waitFor(state.refresh, signal);
    signal?.throwIfAborted();
    return catalog;
  }
  async catalog(name, { signal, force = false } = {}) {
    const state = this.state(name); signal?.throwIfAborted();
    if (!force && state.catalog && !state.invalid && this.now() - state.savedAt <= this.maxAgeMs) {
      state.cacheHits++; return state.catalog;
    }
    return this.discover(name, signal);
  }
  async search(query, { server, limit = 5, signal } = {}) {
    const entries = []; const unavailable = [];
    for (const name of server ? [server] : this.servers.keys()) {
      try {
        const catalog = await this.catalog(name, { signal });
        for (const tool of catalog.tools) entries.push({ id: publicToolName(name, tool.name), name: tool.name,
          kind: 'tool', provider: name, description: tool.description });
      } catch (error) {
        if (signal?.aborted) throw error;
        unavailable.push(name);
      }
    }
    return { ...searchCatalog(entries, query, { limit, maxChars: 5000 }), unavailable };
  }
  async resolve(id, signal) {
    for (const [name, state] of this.servers) {
      if (state.catalog && !state.invalid && this.now() - state.savedAt <= this.maxAgeMs) {
        const tool = state.catalog.tools.find(tool => publicToolName(name, tool.name) === id);
        if (tool) return { server: name, tool, hash: schemaHash(tool) };
      }
    }
    for (const name of this.servers.keys()) {
      const catalog = await this.catalog(name, { signal });
      const tool = catalog.tools.find(tool => publicToolName(name, tool.name) === id);
      if (tool) return { server: name, tool, hash: schemaHash(tool) };
    }
    throw new Error(`Unknown MCP tool ID: ${id}. Search again.`);
  }
  async plan(ids, signal) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== 'string')) throw new Error('Choose 1–8 exact tool IDs');
    const selected = [];
    for (const id of [...new Set(ids)]) selected.push({ id, ...await this.resolve(id, signal) });
    signal?.throwIfAborted();
    return { version: 1, activated: selected.map(x => ({ id: x.id, hash: x.hash })), ready: 'next-step',
      serverInstructions: [...new Set(selected.map(x => x.server))].map(server => ({ server, text: this.state(server).catalog.instructions })),
      instructions: 'The selected native schemas become available on the next step after this result is committed. Loading is not execution authorization.' };
  }
  async restoreAvailable(agent, selected, signal) {
    const admitted = new Map();
    for (const [id, expected] of Object.entries(selected)) {
      for (const [server, state] of this.servers) {
        if (!state.catalog || state.invalid || this.now() - state.savedAt > this.maxAgeMs) continue;
        const tool = state.catalog.tools.find(tool => publicToolName(server, tool.name) === id);
        if (tool && schemaHash(tool) === expected) admitted.set(id, expected);
      }
    }
    const registrations = this.registrations(agent);
    for (const [id, item] of registrations) {
      if (admitted.get(id) !== item.hash) { item.dispose(); registrations.delete(id); }
    }
    // No network discovery while restoring a Session. A cache miss requires an explicit search/load.
    for (const id of admitted.keys()) if (!registrations.has(id)) await this.activate(agent, [id], signal, { restoring: true });
  }
  registrations(agent) {
    requiredAgent(agent);
    if (!this.agents.has(agent)) this.agents.set(agent, new Map());
    return this.agents.get(agent);
  }
  async activate(agent, ids, signal, { restoring = false } = {}) {
    requiredAgent(agent);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== 'string')) throw new Error('Choose 1–8 exact tool IDs');
    const selected = [];
    for (const id of [...new Set(ids)]) selected.push({ id, ...await this.resolve(id, signal) });
    signal?.throwIfAborted();
    const registered = this.registrations(agent);
    for (const item of selected) {
      const existing = registered.get(item.id);
      if (existing?.hash === item.hash) continue;
      // Shadowing an unrelated scoped registration would silently change its authority.
      const conflict = agent.ctx.tools.get(item.id, agent);
      if (conflict && conflict !== existing?.definition) throw new Error(`Tool name is already owned: ${item.id}`);
      if (existing) { existing.dispose(); registered.delete(item.id); }
      const definition = this.createDefinition({ agent, name: item.id, rawName: item.tool.name, tool: item.tool,
        call: (args, execution) => this.call(item.server, item.tool.name, item.hash, args, execution.signal) });
      const dispose = agent.ctx.tools.register(definition);
      registered.set(item.id, { hash: item.hash, definition, dispose, server: item.server });
    }
    return { version: 1, activated: selected.map(x => ({ id: x.id, hash: x.hash })), restoring,
      ready: 'next-step', instructions: 'Call the loaded native tool on your next step. Loading is not authorization to execute.' };
  }
  async call(server, rawName, expectedHash, args, signal) {
    const state = this.state(server);
    signal?.throwIfAborted();
    const wasConnected = Boolean(state.client);
    const client = await this.connection(state, signal);
    // A disk snapshot is a hint, never authority to execute a stale or removed operation.
    const catalog = !wasConnected || state.source !== 'live' || state.invalid
      ? await this.discover(server, signal) : await this.catalog(server, { signal });
    const current = catalog.tools.find(tool => tool.name === rawName);
    if (!current || schemaHash(current) !== expectedHash) {
      this.onSchemaChange(server);
      const error = new Error('MCP schema changed or tool was removed. Search and load it again before execution.');
      error.code = 'STALE_MCP_SCHEMA'; throw error;
    }
    signal?.throwIfAborted();
    state.calls++;
    // Do not retry side effects after uncertain transport failures.
    return client.callTool(rawName, args, { signal, timeout: state.config.toolCallTimeoutMs ?? 120000, toolDefinition: current });
  }
  release(agent) {
    const registrations = this.agents.get(agent);
    if (registrations) for (const item of registrations.values()) item.dispose();
    this.agents.delete(agent);
  }
  status(agent) {
    return { servers: [...this.servers].map(([name, s]) => ({ name, catalogSource: s.source,
      tools: s.catalog?.tools.length ?? 0, connected: Boolean(s.client), connections: s.connections,
      discoveries: s.discoveries, calls: s.calls, cacheHits: s.cacheHits, stale: s.invalid,
      catalogBytes: s.catalog ? Buffer.byteLength(JSON.stringify(s.catalog.tools)) : 0 })),
      activeTools: [...(this.agents.get(agent)?.keys() ?? [])] };
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lifecycle.abort(new Error('Lazy MCP bridge unloaded'));
    for (const agent of this.agents.keys()) this.release(agent);
    this.closing = Promise.allSettled([...this.servers.values()].map(async state => {
      const client = state.client; state.client = null;
      if (client) await client.close().catch(() => {});
      if (state.pending) await state.pending.catch(() => {});
      if (state.refresh) await state.refresh.catch(() => {});
    }));
    return this.closing;
  }
}
