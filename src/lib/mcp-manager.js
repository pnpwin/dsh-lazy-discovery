import { createHash } from 'node:crypto';
import { searchCatalog } from './search.js';
import { CredentialBindingError, containsCredential, createCredentialResolver, referencedNames, usesCredentials, validateBindings } from './credential-bindings.js';

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
const authChanged = () => new CredentialBindingError('MCP_AUTH_CHANGED', 'MCP credentials changed; operation cancelled');
function credentialFailure(error) {
  return error instanceof CredentialBindingError ? error : new CredentialBindingError('MCP_OPERATION_FAILED', 'Credential-backed MCP operation failed');
}

/** Host-only catalogs; credentials and generation identities never enter durable state. */
export class LazyMcpManager {
  constructor({ servers = [], cache, connect, createDefinition, resolveCredentials = createCredentialResolver(), now = Date.now, maxAgeMs = 1800000, onSchemaChange = () => {} }) {
    this.cache = cache; this.connect = connect; this.createDefinition = createDefinition; this.resolveCredentials = resolveCredentials; this.now = now;
    this.maxAgeMs = maxAgeMs; this.onSchemaChange = onSchemaChange; this.closed = false;
    this.lifecycle = new AbortController(); this.closing = null; this.agents = new Map();
    this.servers = new Map(servers.map(config => {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.serverName)) throw new Error('Invalid serverName');
      validateBindings(config, { checkTarget: false });
      return [config.serverName, { config: structuredClone(config), key: hash({ version: 1, config }), refs: usesCredentials(config),
        catalog: null, savedAt: 0, source: 'empty', client: null, pending: null, refresh: null, invalid: false, revision: 0,
        epoch: 0, controller: new AbortController(), authIdentity: null, authError: null, authQueue: Promise.resolve(),
        retiring: null, closeFailed: false, operations: new Set(), connections: 0, discoveries: 0, calls: 0, cacheHits: 0 }];
    }));
    if (this.servers.size !== servers.length) throw new Error('Duplicate MCP serverName');
  }
  async initialize() {
    for (const state of this.servers.values()) {
      // A name is not an authorization scope. Ref-backed catalogs are memory-only.
      if (state.refs || state.config.enabled === false) continue;
      const saved = await this.cache?.read(state.key, { maxAgeMs: this.maxAgeMs, validate: validateCatalog });
      if (saved) { state.catalog = saved.value; state.savedAt = saved.savedAt; state.source = 'disk'; state.cacheHits++; }
    }
    return this;
  }
  state(name) { const state = this.servers.get(name); if (!state) throw new Error(`Unknown configured MCP server: ${name}`); return state; }
  assertCurrent(state, epoch, signal) {
    if (state.epoch !== epoch) throw authChanged();
    if (this.closed) throw new Error('MCP connection closed during operation');
    signal?.throwIfAborted();
  }
  /** Invalidate synchronously; close/drain asynchronously before any replacement can connect. */
  invalidateState(state) {
    const client = state.client, pending = state.pending, refresh = state.refresh;
    const operations = [...state.operations], prior = state.retiring;
    state.epoch++; state.revision++; state.controller.abort(authChanged()); state.controller = new AbortController();
    state.generation = Symbol('invalidated'); state.client = null; state.pending = null; state.refresh = null;
    state.catalog = null; state.savedAt = 0; state.source = 'empty'; state.invalid = true; state.authIdentity = null;
    for (const registrations of this.agents.values()) for (const [id, item] of registrations) {
      if (item.server === state.config.serverName) { registrations.delete(id); try { item.dispose(); } catch { /* continue retiring all owners */ } }
    }
    const retiring = (async () => {
      // Closing first interrupts transport-owned reads before waiting for their promises.
      if (client) { try { await client.close(); } catch { state.closeFailed = true; } }
      await Promise.allSettled([prior, pending, refresh, ...operations].filter(Boolean));
    })();
    state.retiring = retiring;
    retiring.finally(() => { if (state.retiring === retiring) state.retiring = null; }).catch(() => {});
  }
  invalidateCredentials(name) {
    for (const state of this.servers.values()) if (state.refs && (name === undefined || referencedNames(state.config).includes(name))) {
      this.invalidateState(state); state.authError = 'CREDENTIALS_CHANGED';
    }
  }
  async ensureCredentials(state, signal) {
    signal?.throwIfAborted();
    if (state.config.enabled === false) throw new CredentialBindingError('SERVER_DISABLED', 'MCP server is disabled');
    if (!state.refs) return { config: state.config, identity: null, secrets: [], epoch: state.epoch };
    // Serialize provider reads: a slow old resolution cannot overwrite a newer identity.
    const task = state.authQueue.catch(() => {}).then(async () => {
      const epoch = state.epoch;
      this.assertCurrent(state, epoch);
      let auth;
      try { auth = await this.resolveCredentials(state.config); }
      catch (error) {
        if (state.epoch === epoch) {
          this.invalidateState(state);
          state.authError = error instanceof CredentialBindingError ? error.code : 'CREDENTIALS_UNAVAILABLE';
        }
        throw credentialFailure(error);
      }
      this.assertCurrent(state, epoch);
      if (state.authIdentity !== null && state.authIdentity !== auth.identity) this.invalidateState(state);
      state.authIdentity = auth.identity; state.authError = null;
      return { ...auth, epoch: state.epoch };
    });
    state.authQueue = task.then(() => {}, () => {});
    return waitFor(task, signal);
  }
  async reconcileCredentials(signal) {
    for (const state of this.servers.values()) if (state.refs && state.config.enabled !== false) {
      try { await this.ensureCredentials(state, signal); } catch { if (signal?.aborted) signal.throwIfAborted(); }
    }
    return this.status();
  }
  async connection(state, signal, suppliedAuth) {
    signal?.throwIfAborted();
    if (this.closed) throw new Error('Lazy MCP bridge is closed');
    if (state.config.enabled === false) throw new CredentialBindingError('SERVER_DISABLED', 'MCP server is disabled');
    const auth = suppliedAuth ?? (state.refs ? await this.ensureCredentials(state, signal) : { config: state.config, secrets: [], epoch: state.epoch });
    if (state.retiring) await waitFor(state.retiring, signal);
    this.assertCurrent(state, auth.epoch, signal);
    if (state.closeFailed) throw new CredentialBindingError('MCP_CLOSE_FAILED', 'Previous MCP transport could not close safely');
    if (state.client) return state.client;
    if (!state.pending) {
      const epoch = state.epoch, generation = Symbol('connection'); state.generation = generation;
      const generationSignal = AbortSignal.any([this.lifecycle.signal, state.controller.signal]);
      const pending = (async () => {
        let client;
        try {
          client = await this.connect(auth.config, {
            signal: generationSignal,
            onListChanged: () => { if (state.generation !== generation) return; state.invalid = true; state.revision++; this.onSchemaChange(state.config.serverName); },
            onClose: () => { if (state.generation !== generation) return; state.client = null; state.invalid = true; state.revision++; },
          });
          if (this.closed || state.epoch !== epoch || generationSignal.aborted) {
            try { await client.close(); } catch { state.closeFailed = true; }
            throw authChanged();
          }
          state.client = client; state.connections++;
          return client;
        } catch (error) { throw state.refs ? credentialFailure(error) : error; }
      })();
      state.pending = pending;
      pending.finally(() => { if (state.pending === pending) state.pending = null; }).catch(() => {});
    }
    return waitFor(state.pending, signal);
  }
  async discover(name, signal, suppliedAuth) {
    const state = this.state(name);
    const auth = suppliedAuth ?? await this.ensureCredentials(state, signal);
    this.assertCurrent(state, auth.epoch, signal);
    if (!state.refresh) {
      const epoch = state.epoch, generationSignal = AbortSignal.any([this.lifecycle.signal, state.controller.signal]);
      const refresh = (async () => {
        try {
          const client = await this.connection(state, undefined, auth);
          for (let attempt = 0; attempt < 3; attempt++) {
            const revision = state.revision;
            const response = await client.listTools({ signal: generationSignal });
            this.assertCurrent(state, epoch);
            if (state.client !== client) throw new Error('MCP connection closed during discovery');
            if (revision !== state.revision) continue;
            const catalog = { tools: (response.tools ?? []).map(sanitizeTool), instructions: String(client.instructions ?? '') };
            if (containsCredential(catalog, auth.secrets)) throw new CredentialBindingError('MCP_CREDENTIAL_REFLECTION', 'MCP metadata reflected a credential and was refused');
            if (!validateCatalog(catalog) || JSON.stringify(catalog).length > 8 * 1024 * 1024) throw new Error('MCP catalog is invalid or exceeds its limit');
            state.catalog = catalog; state.savedAt = this.now(); state.source = 'live'; state.invalid = false; state.discoveries++;
            if (!state.refs) { try { await this.cache?.write(state.key, catalog); } catch { /* cache failure is not authority */ } }
            this.assertCurrent(state, epoch);
            if (revision !== state.revision) continue;
            return catalog;
          }
          state.invalid = true;
          throw new Error('MCP catalog changed during discovery; retry search');
        } catch (error) { throw state.refs ? credentialFailure(error) : error; }
      })();
      state.refresh = refresh;
      refresh.finally(() => { if (state.refresh === refresh) state.refresh = null; }).catch(() => {});
    }
    return waitFor(state.refresh, signal);
  }
  async catalog(name, { signal, force = false } = {}) {
    const state = this.state(name), auth = await this.ensureCredentials(state, signal);
    if (!force && state.catalog && !state.invalid && this.now() - state.savedAt <= this.maxAgeMs) { state.cacheHits++; return state.catalog; }
    return this.discover(name, signal, auth);
  }
  async search(query, { server, limit = 5, signal } = {}) {
    const entries = [], unavailable = [], snapshots = [];
    for (const name of server ? [server] : this.servers.keys()) {
      try {
        const catalog = await this.catalog(name, { signal }), state = this.state(name);
        if (state.catalog !== catalog || state.invalid) throw authChanged();
        snapshots.push({ name, catalog, epoch: state.epoch });
      } catch { if (signal?.aborted) signal.throwIfAborted(); unavailable.push(name); }
    }
    // An earlier server can rotate while a later server is still discovering.
    for (const { name, catalog, epoch } of snapshots) {
      const state = this.state(name);
      if (state.epoch !== epoch || state.catalog !== catalog || state.invalid) { unavailable.push(name); continue; }
      for (const tool of catalog.tools) entries.push({ id: publicToolName(name, tool.name), name: tool.name, kind: 'tool', provider: name, description: tool.description });
    }
    return { ...searchCatalog(entries, query, { limit, maxChars: 5000 }), unavailable };
  }
  cachedResolution(id) {
    for (const [name, state] of this.servers) if (state.config.enabled !== false && state.catalog && !state.invalid && this.now() - state.savedAt <= this.maxAgeMs) {
      const tool = state.catalog.tools.find(tool => publicToolName(name, tool.name) === id);
      if (tool) return { server: name, tool, hash: schemaHash(tool), epoch: state.epoch, catalogSnapshot: state.catalog };
    }
  }
  async resolve(id, signal) {
    await this.reconcileCredentials(signal);
    const cached = this.cachedResolution(id); if (cached) return cached;
    for (const name of this.servers.keys()) {
      try {
        const catalog = await this.catalog(name, { signal }), state = this.state(name);
        if (state.catalog !== catalog || state.invalid) continue;
        const tool = catalog.tools.find(tool => publicToolName(name, tool.name) === id);
        if (tool) return { server: name, tool, hash: schemaHash(tool), epoch: state.epoch, catalogSnapshot: catalog };
      } catch { if (signal?.aborted) signal.throwIfAborted(); }
    }
    throw new Error(`Unknown or unavailable MCP tool ID: ${id}. Search again.`);
  }
  assertCatalog(item, signal) {
    const state = this.state(item.server);
    this.assertCurrent(state, item.epoch, signal);
    if (state.invalid || state.catalog !== item.catalogSnapshot) {
      const error = new Error('MCP catalog changed; search and load it again'); error.code = 'STALE_MCP_SCHEMA'; throw error;
    }
  }
  async plan(ids, signal) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== 'string')) throw new Error('Choose 1–8 exact tool IDs');
    const selected = [];
    for (const id of [...new Set(ids)]) selected.push({ id, ...await this.resolve(id, signal) });
    for (const item of selected) this.assertCatalog(item, signal);
    return { version: 1, activated: selected.map(x => ({ id: x.id, hash: x.hash })), ready: 'next-step',
      serverInstructions: [...new Set(selected.map(x => x.server))].map(server => ({ server, text: this.state(server).catalog.instructions })),
      instructions: 'The selected native schemas become available on the next step after this result is committed. Loading is not execution authorization.' };
  }
  async restoreAvailable(agent, selected, signal) {
    await this.reconcileCredentials(signal);
    const admitted = new Map();
    for (const [id, expected] of Object.entries(selected)) {
      const item = this.cachedResolution(id);
      if (item && item.hash === expected) admitted.set(id, expected);
    }
    const registrations = this.registrations(agent);
    for (const [id, item] of registrations) if (admitted.get(id) !== item.hash) { item.dispose(); registrations.delete(id); }
    // Restoring never connects, including an expired/ref-backed catalog.
    for (const id of admitted.keys()) if (!registrations.has(id)) await this.activate(agent, [id], signal, { restoring: true });
  }
  registrations(agent) {
    requiredAgent(agent); if (!this.agents.has(agent)) this.agents.set(agent, new Map()); return this.agents.get(agent);
  }
  async activate(agent, ids, signal, { restoring = false } = {}) {
    requiredAgent(agent);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 8 || ids.some(id => typeof id !== 'string')) throw new Error('Choose 1–8 exact tool IDs');
    const selected = [];
    for (const id of [...new Set(ids)]) {
      const item = restoring ? this.cachedResolution(id) : await this.resolve(id, signal);
      if (item) selected.push({ id, ...item });
    }
    const registered = this.registrations(agent);
    for (const item of selected) {
      this.assertCatalog(item, signal);
      const existing = registered.get(item.id);
      if (existing?.hash === item.hash && existing.epoch === item.epoch) continue;
      const conflict = agent.ctx.tools.get(item.id, agent);
      if (conflict && conflict !== existing?.definition) throw new Error(`Tool name is already owned: ${item.id}`);
      if (existing) { existing.dispose(); registered.delete(item.id); }
      const definition = this.createDefinition({ agent, name: item.id, rawName: item.tool.name, tool: item.tool,
        call: (args, execution) => this.call(item.server, item.tool.name, item.hash, args, execution.signal, item.epoch) });
      const dispose = agent.ctx.tools.register(definition);
      registered.set(item.id, { hash: item.hash, definition, dispose, server: item.server, epoch: item.epoch });
    }
    return { version: 1, activated: selected.map(x => ({ id: x.id, hash: x.hash })), restoring, ready: 'next-step', instructions: 'Call the loaded native tool on your next step. Loading is not authorization to execute.' };
  }
  async call(server, rawName, expectedHash, args, signal, expectedEpoch) {
    const state = this.state(server), auth = await this.ensureCredentials(state, signal);
    if (expectedEpoch !== undefined) this.assertCurrent(state, expectedEpoch, signal);
    const epoch = state.epoch, wasConnected = Boolean(state.client);
    const generationSignal = AbortSignal.any([this.lifecycle.signal, state.controller.signal, ...(signal ? [signal] : [])]);
    const operation = (async () => {
      try {
        const client = await this.connection(state, generationSignal, auth);
        const catalog = !wasConnected || state.source !== 'live' || state.invalid ? await this.discover(server, generationSignal, auth) : await this.catalog(server, { signal: generationSignal });
        this.assertCurrent(state, epoch, generationSignal);
        const current = catalog.tools.find(tool => tool.name === rawName);
        if (state.invalid || state.catalog !== catalog || !current || schemaHash(current) !== expectedHash) {
          this.onSchemaChange(server);
          const error = new Error('MCP schema changed or tool was removed. Search and load it again before execution.'); error.code = 'STALE_MCP_SCHEMA'; throw error;
        }
        state.calls++;
        const result = await client.callTool(rawName, args, { signal: generationSignal, timeout: state.config.toolCallTimeoutMs ?? 120000, toolDefinition: current });
        this.assertCurrent(state, epoch, generationSignal);
        if (containsCredential(result, auth.secrets)) throw new CredentialBindingError('MCP_CREDENTIAL_REFLECTION', 'MCP result reflected a credential and was refused');
        return result;
      } catch (error) {
        if (state.refs && error?.code !== 'STALE_MCP_SCHEMA') throw credentialFailure(error);
        throw error;
      }
    })();
    state.operations.add(operation);
    operation.finally(() => state.operations.delete(operation)).catch(() => {});
    return operation;
  }
  release(agent) {
    const registrations = this.agents.get(agent); if (registrations) for (const item of registrations.values()) item.dispose(); this.agents.delete(agent);
  }
  status(agent) {
    return { servers: [...this.servers].map(([name, s]) => ({ name, enabled: s.config.enabled !== false, catalogSource: s.source,
      tools: s.catalog?.tools.length ?? 0, connected: Boolean(s.client), connections: s.connections, discoveries: s.discoveries, calls: s.calls,
      cacheHits: s.cacheHits, stale: s.invalid, credentialRefs: s.refs, credentialsReady: s.config.enabled !== false && !s.closeFailed && (!s.refs || s.authIdentity !== null),
      ...(s.closeFailed ? { credentialError: 'MCP_CLOSE_FAILED' } : s.authError ? { credentialError: s.authError } : {}), diskCacheEnabled: !s.refs, catalogBytes: s.catalog ? Buffer.byteLength(JSON.stringify(s.catalog.tools)) : 0 })),
      activeTools: [...(this.agents.get(agent)?.keys() ?? [])] };
  }
  async close() {
    if (this.closing) return this.closing;
    this.closed = true; this.lifecycle.abort(new Error('Lazy MCP bridge unloaded'));
    for (const agent of this.agents.keys()) this.release(agent);
    for (const state of this.servers.values()) this.invalidateState(state);
    this.closing = Promise.allSettled([...this.servers.values()].flatMap(state => [state.retiring, state.authQueue].filter(Boolean)));
    return this.closing;
  }
}
