import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const VERSION = 1;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const KEY = /^[a-f0-9]{64}$/;

function assertKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new TypeError('cache key must be a lowercase SHA-256 hex digest, not raw configuration');
}
function jsonValue(value) {
  const pending = [{ value, depth: 0 }];
  const ancestors = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current.leave) { ancestors.delete(current.value); continue; }
    const item = current.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number' && Number.isFinite(item)) continue;
    if (typeof item !== 'object' || current.depth > 128 || ancestors.has(item)) return false;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
    // JSON.stringify consults toJSON even when non-enumerable; never invoke it.
    for (let prototype = item; prototype !== null; prototype = Object.getPrototypeOf(prototype)) {
      if (Object.getOwnPropertyDescriptor(prototype, 'toJSON') !== undefined) return false;
    }
    ancestors.add(item);
    pending.push({ value: item, leave: true });
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (!property || !Object.hasOwn(property, 'value')) return false;
        pending.push({ value: property.value, depth: current.depth + 1 });
      }
    } else {
      for (const key of Reflect.ownKeys(item)) {
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property.enumerable) continue;
        if (typeof key !== 'string' || !Object.hasOwn(property, 'value')) return false;
        pending.push({ value: property.value, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

/**
 * Private, bounded JSON catalog storage. The caller supplies a SHA-256 identity
 * including provider/configuration/auth scope, and MUST write metadata only: the
 * cache cannot infer which arbitrary values are credentials. Cached metadata is
 * never authority to register, execute or reveal a tool in the current scope.
 */
export class CatalogCache {
  #realDirectory;
  constructor({ directory, maxBytes = DEFAULT_MAX_BYTES, now = Date.now } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('cache directory must be an absolute dedicated directory');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 128 || maxBytes > 64 * 1024 * 1024) throw new RangeError('maxBytes must be an integer from 128 to 67108864');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.directory = path.resolve(directory);
    this.maxBytes = maxBytes;
    this.now = now;
  }
  async #root(create = false) {
    if (create) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('cache root must be a real directory');
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error('cache root must belong to the current user');
    const canonical = await realpath(this.directory);
    if (this.#realDirectory !== undefined && this.#realDirectory !== canonical) throw new Error('cache root identity changed');
    this.#realDirectory = canonical;
    if (create) await chmod(canonical, 0o700);
    return canonical;
  }
  #target(root, key) {
    const target = path.resolve(root, `${key}.json`);
    if (path.dirname(target) !== root || path.basename(target) !== `${key}.json`) throw new Error('cache target escaped root');
    return target;
  }
  #assertTemporary(root, key, temporary) {
    if (path.dirname(path.resolve(temporary)) !== root || !path.basename(temporary).startsWith(`.${key}.`) || !path.basename(temporary).endsWith('.tmp')) throw new Error('invalid cache temporary path');
  }
  #time() {
    const time = this.now();
    if (!Number.isSafeInteger(time) || time < 0) throw new TypeError('now must return a nonnegative integer timestamp');
    return time;
  }
  async read(key, { maxAgeMs = Infinity, validate } = {}) {
    assertKey(key);
    if ((maxAgeMs !== Infinity && !Number.isFinite(maxAgeMs)) || maxAgeMs < 0) throw new RangeError('maxAgeMs must be nonnegative');
    if (validate !== undefined && typeof validate !== 'function') throw new TypeError('validate must be a predicate');
    let handle;
    try {
      const root = await this.#root();
      const target = this.#target(root, key);
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const info = await handle.stat();
      if (!info.isFile() || info.size > this.maxBytes || (info.mode & 0o077) !== 0) return null;
      if (typeof process.getuid === 'function' && info.uid !== process.getuid()) return null;
      // Read no more than maxBytes + 1 even if a concurrent writer grows the file.
      const buffer = Buffer.alloc(Math.min(info.size + 1, this.maxBytes + 1));
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      if (length > this.maxBytes || length > info.size) return null;
      if (await this.#root() !== root) return null;
      const envelope = JSON.parse(buffer.subarray(0, length).toString('utf8'));
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
        || envelope.version !== VERSION || envelope.key !== key
        || !Number.isSafeInteger(envelope.savedAt) || envelope.savedAt < 0
        || !Object.hasOwn(envelope, 'value') || !jsonValue(envelope.value)
        || Object.keys(envelope).some(field => !['version', 'key', 'savedAt', 'value'].includes(field))) return null;
      const time = this.#time();
      if (envelope.savedAt > time || time - envelope.savedAt >= maxAgeMs) return null;
      if (validate !== undefined && await validate(envelope.value) !== true) return null;
      return { value: envelope.value, savedAt: envelope.savedAt };
    } catch {
      // Missing, corrupt, oversized, stale, untrusted and inaccessible files are misses.
      return null;
    } finally {
      await handle?.close();
    }
  }
  async write(key, value) {
    assertKey(key);
    if (!jsonValue(value)) throw new TypeError('cache value must be lossless JSON metadata');
    const serialized = JSON.stringify({ version: VERSION, key, savedAt: this.#time(), value });
    if (Buffer.byteLength(serialized, 'utf8') > this.maxBytes) throw new RangeError('cache document exceeds maxBytes');
    const root = await this.#root(true);
    const target = this.#target(root, key);
    const temporary = path.resolve(root, `.${key}.${randomUUID()}.tmp`);
    this.#assertTemporary(root, key, temporary);
    let handle;
    let created = false;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      created = true;
      await handle.writeFile(serialized, 'utf8');
      await handle.chmod(0o600);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (await this.#root() !== root) throw new Error('cache root identity changed');
      // Both absolute rename endpoints are verified children of this exact root.
      this.#assertTemporary(root, key, temporary);
      if (this.#target(root, key) !== target) throw new Error('invalid cache target');
      await rename(temporary, target);
      created = false;
    } finally {
      await handle?.close();
      if (created) {
        this.#assertTemporary(root, key, temporary);
        await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }
  /** Remove only this validated hash-key entry; never enumerate/delete a directory. */
  async invalidate(key) {
    assertKey(key);
    try {
      const root = await this.#root();
      const target = this.#target(root, key);
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) return false;
      if (await this.#root() !== root || this.#target(root, key) !== target) return false;
      await unlink(target);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}
