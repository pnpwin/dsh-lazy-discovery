import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { validateBindings, referencedNames, credentialTarget } from './credential-bindings.js';

// Private, process-local state: ordinary config restarts keep the same Cordis
// root. Nothing is installed on that root, exported, or persisted with config.
const revisionScopes = new WeakMap();
const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
function revisionScope(ctx, entry) {
  let root = ctx.root;
  if (object(root?.root)) root = root.root;
  if (!object(root)) root = ctx; // Standalone/mocked callers are scoped to their exact context.
  let state = revisionScopes.get(root);
  if (!state) {
    state = { key: randomBytes(32), anonymous: new WeakMap(), next: 0 };
    revisionScopes.set(root, state);
  }
  const id = typeof entry?.id === 'string' && entry.id ? entry.id : entry?.options?.id;
  const name = typeof entry?.options?.name === 'string' ? entry.options.name : '';
  if (typeof id === 'string' && id) return { key: state.key, domain: ['lazy-mcp-auth-revision-v1', 'entry', id, name] };
  // Without a stable Loader id, never share anonymous entries merely because
  // their raw rows happen to match. Reuse requires the same entry/context object.
  const owner = object(entry) ? entry : ctx;
  if (!state.anonymous.has(owner)) state.anonymous.set(owner, ++state.next);
  return { key: state.key, domain: ['lazy-mcp-auth-revision-v1', 'anonymous', state.anonymous.get(owner), name] };
}
function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export class AuthSettingsError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const ERROR_CODES = new Set(['invalid-request', 'invalid-bindings', 'invalid-name', 'config-read-only', 'config-changed', 'dynamic-config', 'confirmation-required', 'literal-conflict', 'credential-provider-unavailable', 'credential-missing', 'operation-failed', 'request-too-large']);
export function authFailure(error) {
  if (error instanceof AuthSettingsError && ERROR_CODES.has(error.code)) return { error: { code: error.code } };
  const code = error?.code;
  if (code === 'CREDENTIALS_UNAVAILABLE') return { error: { code: 'credential-provider-unavailable' } };
  if (code === 'CREDENTIAL_NOT_CONFIGURED') return { error: { code: 'credential-missing' } };
  if (typeof code === 'string' && /BINDING|HEADER|REF|ENV|CONFIG/.test(code)) return { error: { code: 'invalid-bindings' } };
  return { error: { code: 'operation-failed' } };
}
function onlyKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new AuthSettingsError('invalid-request');
  return input;
}
function plainMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, '__jsExpr')) throw new AuthSettingsError('invalid-bindings');
  return value;
}
function rows(config) {
  if (!Array.isArray(config?.servers)) throw new AuthSettingsError('dynamic-config');
  return config.servers;
}
function rawServer(config, name) {
  const matches = rows(config).filter(row => row && typeof row === 'object' && !Array.isArray(row) && row.serverName === name);
  if (matches.length !== 1) throw new AuthSettingsError('config-changed');
  return matches[0];
}
function safeDestination(server) {
  if (server.transport === 'streamable-http') {
    try { return new URL(server.url).origin; } catch { return '(configured HTTP endpoint)'; }
  }
  return path.basename(String(server.command ?? '').replace(/\\/g, '/')) || '(configured process)';
}
function sourceKind(source) {
  if (typeof source !== 'string') return undefined;
  if (/dotenv|\.env/i.test(source)) return 'dotenv';
  if (/environment|^env\b|process/i.test(source)) return 'environment';
  if (/file|store|credential|yaml/i.test(source)) return 'stored';
  return 'configured';
}
function hasLiterals(server) {
  return Object.keys(server.headers ?? {}).length > 0 || Object.keys(server.env ?? {}).length > 0;
}
function cloneBindings(headerRefs, envRefs) {
  const header = {}, env = {};
  for (const [key, value] of Object.entries(plainMap(headerRefs))) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new AuthSettingsError('invalid-bindings');
    onlyKeys(value, ['name', 'prefix']);
    header[key] = { name: value.name, ...(value.prefix === undefined ? {} : { prefix: value.prefix }) };
  }
  for (const [key, value] of Object.entries(plainMap(envRefs))) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new AuthSettingsError('invalid-bindings');
    env[key] = value;
  }
  return { headerRefs: header, envRefs: env };
}
export function createAuthSettings(ctx, config) {
  const entry = ctx.fiber?.entry;
  const { key, domain } = revisionScope(ctx, entry);
  // Opaque keyed revisions survive unrelated config saves, but not root/module
  // replacement. Entry domains prevent a form from being replayed at another row.
  const revision = row => createHmac('sha256', key).update(stableJson([domain, row])).digest('hex');
  const provider = () => ctx.get('credentials');
  const editor = () => ctx.get('configEditor');
  async function describe(names) {
    const credentials = provider();
    return Promise.all(names.map(async name => {
      if (!credentials) return { name, configured: false };
      try { const info = await credentials.describe(name); return { name, configured: Boolean(info.configured), ...(info.source ? { source: sourceKind(info.source) } : {}) }; }
      catch { return { name, configured: false }; }
    }));
  }
  async function snapshot() {
    const writable = Boolean(entry && editor());
    const servers = [];
    for (const server of config.servers) {
      let raw, editable = writable;
      try { raw = rawServer(entry?.options?.config, server.serverName); }
      catch { editable = false; }
      const bindings = cloneBindings(server.headerRefs ?? {}, server.envRefs ?? {});
      const names = [...new Set([...Object.values(bindings.envRefs), ...Object.values(bindings.headerRefs).map(ref => ref.name)])];
      servers.push({ serverName: server.serverName, transport: server.transport, destination: safeDestination(server), enabled: server.enabled !== false,
        ...bindings, credentials: await describe(names), hasLiteralCredentials: hasLiterals(server), bindingTargetChanged: Boolean(names.length && server.credentialTarget && server.credentialTarget !== credentialTarget(server)), revision: raw ? revision(raw) : '', editable });
    }
    return { version: 1, writable, credentialProviderAvailable: Boolean(provider()), servers };
  }
  async function update(input) {
    onlyKeys(input, ['serverName', 'revision', 'enabled', 'headerRefs', 'envRefs', 'confirmed', 'replaceExisting']);
    if (typeof input.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(input.serverName) || typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) || typeof input.enabled !== 'boolean' || typeof input.confirmed !== 'boolean' || input.replaceExisting !== undefined && typeof input.replaceExisting !== 'boolean') throw new AuthSettingsError('invalid-request');
    const service = editor();
    if (!entry || !service) throw new AuthSettingsError('config-read-only');
    const original = config.servers.find(server => server.serverName === input.serverName);
    if (!original) throw new AuthSettingsError('config-changed');
    const bindings = cloneBindings(input.headerRefs, input.envRefs);
    const candidate = { ...original, headers: {}, env: {}, enabled: input.enabled, ...bindings, credentialTarget: credentialTarget(original) };
    validateBindings(candidate);
    const names = referencedNames(candidate);
    if (input.enabled && names.length) {
      if (!input.confirmed) throw new AuthSettingsError('confirmation-required');
      const credentials = provider();
      if (!credentials) throw new AuthSettingsError('credential-provider-unavailable');
      for (const name of names) {
        let info;
        try { info = await credentials.describe(name); } catch { throw new AuthSettingsError('credential-missing'); }
        if (!info.configured) throw new AuthSettingsError('credential-missing');
      }
    }
    await service.edit(entry, current => {
      const list = rows(current), before = rawServer(current, input.serverName);
      if (revision(before) !== input.revision) throw new AuthSettingsError('config-changed');
      const next = structuredClone(before);
      for (const [target, field, insensitive] of [
        ...Object.keys(bindings.headerRefs).map(target => [target, 'headers', true]),
        ...Object.keys(bindings.envRefs).map(target => [target, 'env', false]),
      ]) {
        if (next[field] === undefined) continue;
        if (!next[field] || typeof next[field] !== 'object' || Array.isArray(next[field])) throw new AuthSettingsError('dynamic-config');
        if (Object.hasOwn(next[field], '__jsExpr')) {
          // A whole-map expression need not be rewritten to add a disjoint ref.
          // Inspect only its already-resolved key set; never persist its values.
          const effective = original[field];
          const knownMap = effective && typeof effective === 'object' && !Array.isArray(effective)
            && [Object.prototype, null].includes(Object.getPrototypeOf(effective)) && !Object.hasOwn(effective, '__jsExpr');
          if (Object.keys(next[field]).length !== 1 || typeof next[field].__jsExpr !== 'string' || !knownMap
            || Object.keys(effective).some(key => insensitive ? key.toLowerCase() === target.toLowerCase() : key === target)) {
            throw new AuthSettingsError('dynamic-config');
          }
          // Native ConfigEditor revalidates/reconciles the preserved expression;
          // a later overlapping result still fails closed in runtime validation.
          continue;
        }
        for (const key of Object.keys(next[field])) if (insensitive ? key.toLowerCase() === target.toLowerCase() : key === target) {
          if (!input.replaceExisting) throw new AuthSettingsError('literal-conflict');
          delete next[field][key];
        }
      }
      next.enabled = input.enabled;
      if (names.length) next.credentialTarget = candidate.credentialTarget; else delete next.credentialTarget;
      if (Object.keys(bindings.headerRefs).length) next.headerRefs = bindings.headerRefs; else delete next.headerRefs;
      if (Object.keys(bindings.envRefs).length) next.envRefs = bindings.envRefs; else delete next.envRefs;
      return { ...current, servers: list.map(row => row === before ? next : row) };
    });
    return { saved: true, serverName: input.serverName };
  }
  return { snapshot, update };
}
export async function readAuthBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AuthSettingsError('invalid-request');
  if (Number(request.headers.get('content-length')) > 32768) throw new AuthSettingsError('request-too-large');
  const reader = request.body?.getReader();
  if (!reader) throw new AuthSettingsError('invalid-request');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 32768) throw new AuthSettingsError('request-too-large'); chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AuthSettingsError('invalid-request'); }
  } finally { await reader.cancel().catch(() => {}); }
}
