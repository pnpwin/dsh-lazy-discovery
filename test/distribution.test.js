import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { compareContext } from '../src/benchmark.mjs';

const root = new URL('../', import.meta.url);
test('distribution exports runtime code from src without relocating test or locale', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.exports['.'], './src/index.js');
  assert.equal(pkg.exports['./host'], './src/index.js');
  for (const file of ['src/index.js', 'src/proxy.mjs', 'test/fixture-server.mjs', 'locale/en.json', 'locale/ru.json', 'README.md', 'README.ru.md', 'LICENSE', 'UPSTREAM.md']) assert.ok((await stat(new URL(file, root))).isFile());
  assert.ok(!(await readdir(root)).some(name => /\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(name)));
  assert.ok(!Object.keys(pkg.dependencies).some(name => name.startsWith('@deepseek-ai/')));
  assert.equal(pkg.scripts.prepare, undefined);
});
test('saved provider benchmark recomputes exact four-way effects, not byte heuristics', async () => {
  const data = JSON.parse(await readFile(new URL('test/fixtures/context-benchmark.json', root), 'utf8'));
  const result = compareContext(data.observations, data.contextWindow);
  assert.deepEqual(result.rows.map(x => x.inputTokens), [14469,10350,13540,9407]);
  assert.deepEqual(result.effects, { mcpWithEagerSkills: 4119, mcpWithLazySkills: 4133, skillsWithEagerMcp: 929, skillsWithLazyMcp: 943, combined: 5062 });
  assert.ok(Math.abs(result.rows[3].savedPercent - 34.985140645518) < 1e-10);
  assert.equal(data.controls.fullSkillBodiesLoaded, false);
});
test('benchmark rejects incomplete, duplicate and invalid measurements', () => {
  const rows = [false,true].flatMap(lazyMcp => [false,true].map(lazySkills => ({ lazyMcp,lazySkills,inputTokens:10 })));
  assert.throws(() => compareContext(rows.slice(1), 100));
  assert.throws(() => compareContext([...rows.slice(0,3),rows[0]], 100));
  assert.throws(() => compareContext(rows, 9));
  assert.throws(() => compareContext([{...rows[0],lazyMcp:'false'},...rows.slice(1)], 100));
});
