import { createHash, createHmac, randomBytes } from 'node:crypto';

const REF = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const RESERVED_HEADERS = new Set(['host', 'mcp-session-id', 'mcp-protocol-version', 'mcp-method', 'mcp-name',
  'content-type', 'content-length', 'connection', 'transfer-encoding', 'accept', 'origin', 'proxy-authorization']);

/** Non-secret destination acknowledgement; no headers, env or resolved values. */
export function credentialTarget(server) {
  const destination = server.transport === 'streamable-http'
    ? { transport: server.transport, url: server.url }
    : { transport: server.transport, command: server.command, args: server.args ?? [], cwd: server.cwd ?? '' };
  return createHash('sha256').update(JSON.stringify(destination)).digest('hex');
}
export class CredentialBindingError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
function invalid() { throw new CredentialBindingError('INVALID_CREDENTIAL_BINDINGS', 'Invalid MCP credential bindings'); }
function mapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value;
}
function refName(name) {
  if (typeof name !== 'string' || !REF.test(name) || name.startsWith('DSH_') || FORBIDDEN.has(name)) invalid();
  return name;
}
export function referencedNames(server) {
  validateBindings(server, { checkTarget: false });
  return [...new Set([...Object.values(server.envRefs ?? {}), ...Object.values(server.headerRefs ?? {}).map(ref => ref.name)])];
}
export function usesCredentials(server) {
  return Object.keys(server?.envRefs ?? {}).length > 0 || Object.keys(server?.headerRefs ?? {}).length > 0;
}
export function validateBindings(server, { checkTarget = true } = {}) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) invalid();
  if (server.enabled !== undefined && typeof server.enabled !== 'boolean') invalid();
  const env = mapping(server.envRefs ?? {}), headers = mapping(server.headerRefs ?? {});
  if (Object.keys(env).length && server.transport !== 'stdio' || Object.keys(headers).length && server.transport !== 'streamable-http') invalid();
  const names = new Set(), destinations = new Set();
  for (const [target, name] of Object.entries(env)) {
    refName(target); names.add(refName(name));
    if (Object.hasOwn(server.env ?? {}, target)) invalid();
  }
  for (const [header, ref] of Object.entries(headers)) {
    const folded = header.toLowerCase();
    if (!HEADER.test(header) || RESERVED_HEADERS.has(folded) || FORBIDDEN.has(header) || destinations.has(folded)) invalid();
    destinations.add(folded);
    mapping(ref);
    if (Object.keys(ref).some(key => !['name', 'prefix'].includes(key))) invalid();
    names.add(refName(ref.name));
    if (ref.prefix !== undefined && (typeof ref.prefix !== 'string' || ref.prefix.length > 256 || /[\r\n\0]/.test(ref.prefix))) invalid();
    if (Object.keys(server.headers ?? {}).some(key => key.toLowerCase() === folded)) invalid();
  }
  if (names.size > 32 || Object.keys(env).length + Object.keys(headers).length > 32) invalid();
  if (server.credentialTarget !== undefined && (typeof server.credentialTarget !== 'string' || !/^[a-f0-9]{64}$/.test(server.credentialTarget))) invalid();
  if (checkTarget && names.size && server.credentialTarget !== undefined && server.credentialTarget !== credentialTarget(server)) {
    throw new CredentialBindingError('CREDENTIAL_TARGET_CHANGED', 'MCP credential destination changed; confirm bindings again');
  }
  return server;
}

/** The key and identities are process-local, never cache keys or status fields. */
export function createCredentialResolver(getProvider = () => undefined) {
  const key = randomBytes(32);
  return async server => {
    validateBindings(server);
    if (server.enabled === false) throw new CredentialBindingError('SERVER_DISABLED', 'MCP server is disabled');
    const config = structuredClone(server);
    delete config.headerRefs; delete config.envRefs;
    const secrets = [];
    if (usesCredentials(server)) {
      let provider;
      try { provider = getProvider(); } catch { /* unavailable provider fails closed */ }
      if (!provider || typeof provider.resolve !== 'function') throw new CredentialBindingError('CREDENTIALS_UNAVAILABLE', 'MCP credentials provider is unavailable');
      const values = Object.create(null);
      for (const name of referencedNames(server)) {
        let resolved;
        try { resolved = await provider.resolve(name); }
        catch { throw new CredentialBindingError('CREDENTIALS_UNAVAILABLE', 'MCP credentials provider is unavailable'); }
        const value = resolved?.value;
        if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value) > 32768) throw new CredentialBindingError('CREDENTIAL_NOT_CONFIGURED', 'A required MCP credential is not configured');
        values[name] = value; secrets.push(value);
      }
      if (Object.keys(server.envRefs ?? {}).length) {
        config.env = { ...(config.env ?? {}) };
        for (const [target, name] of Object.entries(server.envRefs)) config.env[target] = values[name];
      }
      if (Object.keys(server.headerRefs ?? {}).length) {
        config.headers = { ...(config.headers ?? {}) };
        for (const [header, ref] of Object.entries(server.headerRefs)) {
          const value = `${ref.prefix ?? ''}${values[ref.name]}`;
          if (/[\r\n\0]/.test(value)) throw new CredentialBindingError('INVALID_CREDENTIAL_VALUE', 'MCP credential cannot be used as a header');
          config.headers[header] = value;
        }
      }
    }
    return { config, identity: createHmac('sha256', key).update(JSON.stringify(config)).digest('hex'), secrets: [...new Set(secrets)] };
  };
}

/** Reject, rather than silently mutate, credentials reflected into authoritative schemas. */
export function containsCredential(value, secrets) {
  if (!secrets?.length) return false;
  const pending = [value], seen = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && secrets.some(secret => item.includes(secret))) return true;
    if (item && typeof item === 'object' && !seen.has(item)) {
      seen.add(item);
      for (const [key, nested] of Object.entries(item)) { pending.push(key, nested); }
    }
  }
  return false;
}
