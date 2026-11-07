import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readFile, writeFile, stat, chmod, symlink, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CatalogCache } from '../src/lib/catalog-cache.js';

const key = createHash('sha256').update('scope:provider:fixture').digest('hex');
const otherKey = createHash('sha256').update('different-scope').digest('hex');
async function fixture(t, options = {}) {
  const parent = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'dsh-catalog-cache-'));
  t.after(async () => {
    // Only the exact newly-created fixture directory may be recursively removed.
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('dsh-catalog-cache-'));
    await rm(root, { recursive: true, force: true });
  });
  const directory = path.join(root, 'catalog');
  return { root, directory, cache: new CatalogCache({ directory, ...options }) };
}

test('roundtrips metadata, versioned identity and private permissions', async t => {
  const { cache, directory } = await fixture(t, { now: () => 1_000 });
  const value = [{ id: 'mcp:fixture:read', name: 'read', description: 'Read metadata' }];
  await cache.write(key, value);
  assert.deepEqual(await cache.read(key, { maxAgeMs: 100, validate: item => Array.isArray(item) }), { value, savedAt: 1_000 });
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, `${key}.json`))).mode & 0o777, 0o600);
  const document = JSON.parse(await readFile(path.join(directory, `${key}.json`), 'utf8'));
  assert.equal(document.version, 1);
  assert.equal(document.key, key);
  assert.deepEqual(await readdir(directory), [`${key}.json`]);
});

test('TTL, future timestamps and validation failures are cache misses', async t => {
  let time = 1_000;
  const { cache } = await fixture(t, { now: () => time });
  await cache.write(key, { name: 'read' });
  assert.equal(await cache.read(key, { maxAgeMs: 0 }), null);
  time = 1_099;
  assert.ok(await cache.read(key, { maxAgeMs: 100 }));
  time = 1_100;
  assert.equal(await cache.read(key, { maxAgeMs: 100 }), null);
  time = 999;
  assert.equal(await cache.read(key), null);
  time = 1_000;
  assert.equal(await cache.read(key, { validate: () => false }), null);
  assert.equal(await cache.read(key, { validate: () => { throw new Error('invalid'); } }), null);
  assert.ok(await cache.read(key, { validate: async () => true }));
});

test('invalid and traversal keys reject before accessing storage', async t => {
  const { cache, root } = await fixture(t);
  for (const invalid of ['', '../secret', '/absolute', 'raw-token-value', key.toUpperCase(), `${key}.json`]) {
    await assert.rejects(cache.read(invalid), TypeError);
    await assert.rejects(cache.write(invalid, {}), TypeError);
    await assert.rejects(cache.invalidate(invalid), TypeError);
  }
  assert.deepEqual(await readdir(root), []);
});

test('corrupt JSON, envelope mismatches, extra fields and wrong values never serve', async t => {
  const { cache, directory } = await fixture(t, { now: () => 1_000 });
  await cache.write(key, {});
  const file = path.join(directory, `${key}.json`);
  for (const document of [
    '{bad json', 'null', '[]', '{}',
    JSON.stringify({ version: 2, key, savedAt: 1_000, value: {} }),
    JSON.stringify({ version: 1, key: otherKey, savedAt: 1_000, value: {} }),
    JSON.stringify({ version: 1, key, savedAt: -1, value: {} }),
    JSON.stringify({ version: 1, key, savedAt: 1_000, value: {}, extra: 'unknown' }),
  ]) {
    await writeFile(file, document, { mode: 0o600 });
    assert.equal(await cache.read(key), null);
  }
});

test('oversized read and write are bounded and leave prior metadata intact', async t => {
  const { cache, directory } = await fixture(t, { maxBytes: 512 });
  await cache.write(key, { name: 'small' });
  await assert.rejects(cache.write(key, { description: 'x'.repeat(1_000) }), RangeError);
  assert.deepEqual((await cache.read(key)).value, { name: 'small' });
  await writeFile(path.join(directory, `${key}.json`), 'x'.repeat(1_000));
  assert.equal(await cache.read(key), null);
  assert.deepEqual(await readdir(directory), [`${key}.json`]);
});

test('lossy JSON input and cyclic data fail without serializing side effects', async t => {
  const { cache } = await fixture(t);
  const cycle = {}; cycle.self = cycle;
  let accessed = false;
  const getter = { get secret() { accessed = true; return 'secret'; } };
  const hiddenSerializer = Object.defineProperty({}, 'toJSON', { value() { accessed = true; return { secret: 'leaked' }; } });
  for (const invalid of [undefined, NaN, Infinity, { value: undefined }, { value: 1n }, new Date(), cycle, getter, hiddenSerializer, [undefined], Array(2)]) await assert.rejects(cache.write(key, invalid), TypeError);
  assert.equal(accessed, false);
  const shared = { name: 'valid' };
  await cache.write(key, { a: shared, b: shared });
  assert.deepEqual((await cache.read(key)).value, { a: shared, b: shared });
});

test('symlinked files and roots are rejected and unknown paths survive invalidation', async t => {
  const { cache, root, directory } = await fixture(t);
  await mkdir(directory, { mode: 0o700 });
  const outside = path.join(root, 'outside.json');
  await writeFile(outside, 'untouched', { mode: 0o600 });
  await symlink(outside, path.join(directory, `${key}.json`));
  assert.equal(await cache.read(key), null);
  assert.equal(await cache.invalidate(key), false);
  assert.equal(await readFile(outside, 'utf8'), 'untouched');
  const link = path.join(root, 'linked-root');
  await symlink(directory, link);
  const linked = new CatalogCache({ directory: link });
  assert.equal(await linked.read(key), null);
  await assert.rejects(linked.write(otherKey, {}), /real directory/);
});

test('insecure entries are not read, and owned invalidation deletes only exact key', async t => {
  const { cache, directory } = await fixture(t);
  await cache.write(key, { name: 'first' });
  await cache.write(otherKey, { name: 'second' });
  await chmod(path.join(directory, `${key}.json`), 0o644);
  assert.equal(await cache.read(key), null);
  await chmod(path.join(directory, `${key}.json`), 0o600);
  assert.equal(await cache.invalidate(key), true);
  assert.equal(await cache.invalidate(key), false);
  assert.ok(await cache.read(otherKey));
});

test('concurrent atomic writes leave one complete envelope and no temporary files', async t => {
  const { cache, directory } = await fixture(t);
  await Promise.all(Array.from({ length: 10 }, (_, number) => cache.write(key, { number, description: 'fixture' })));
  const result = await cache.read(key);
  assert.ok(Number.isInteger(result.value.number));
  assert.equal(result.value.description, 'fixture');
  assert.deepEqual(await readdir(directory), [`${key}.json`]);
});

test('configuration and max-age bounds are validated', async t => {
  assert.throws(() => new CatalogCache({ directory: 'relative' }), TypeError);
  assert.throws(() => new CatalogCache({ directory: '/tmp', maxBytes: 1 }), RangeError);
  assert.throws(() => new CatalogCache({ directory: '/tmp', now: 1 }), TypeError);
  const { cache } = await fixture(t);
  await assert.rejects(cache.read(key, { maxAgeMs: -1 }), RangeError);
  await assert.rejects(cache.read(key, { validate: true }), TypeError);
});
