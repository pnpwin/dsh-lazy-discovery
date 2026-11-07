import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog } from '../src/lib/search.js';

const entries = [
  { id: 'skill:office-xlsx', name: 'office-xlsx', kind: 'skill', provider: 'builtin', description: 'Read, edit and recalculate Excel spreadsheet formulas.', tags: ['office', 'cells'], body: 'SECRET BODY', inputSchema: { secret: 'SCHEMA' } },
  { id: 'mcp:github:search', name: 'searchRepositories', kind: 'mcp', provider: 'github', description: 'Search GitHub repositories and code.', parameters: { token: 'SECRET' } },
  { id: 'skill:office-pptx', name: 'office-pptx', kind: 'skill', provider: 'builtin', description: 'Create presentations and render slides.' },
  { id: 'mcp:fs:read', name: 'readFile', kind: 'mcp', provider: 'filesystem', description: 'Read a text file.' },
];

test('Russian queries retrieve English catalog descriptions and camelCase names', () => {
  assert.equal(searchCatalog(entries, 'пересчитать формулы в таблице').results[0].id, 'skill:office-xlsx');
  assert.equal(searchCatalog(entries, 'поиск репозиториев гитхаб').results[0].id, 'mcp:github:search');
  assert.equal(searchCatalog(entries, 'создать презентацию').results[0].id, 'skill:office-pptx');
  assert.equal(searchCatalog(entries, 'прочитать файл').results[0].id, 'mcp:fs:read');
});

test('exact id/name boost wins and result fields are strictly metadata-only', () => {
  const result = searchCatalog(entries, 'office-xlsx').results[0];
  assert.equal(result.id, 'skill:office-xlsx');
  assert.deepEqual(Object.keys(result).sort(), ['description', 'id', 'kind', 'name', 'provider', 'score']);
  assert.ok(Number.isFinite(result.score));
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!JSON.stringify(result).includes('SCHEMA'));
});

test('does not use bodies, arbitrary nested schemas or non-string metadata as search input', () => {
  assert.deepEqual(searchCatalog(entries, 'SECRET'), { results: [], truncated: false });
  assert.deepEqual(searchCatalog([{ id: 'x', name: 'x', description: { nested: 'needle' }, body: 'needle' }], 'needle'), { results: [], truncated: false });
});

test('no-match, empty, punctuation and stopword queries return empty results', () => {
  for (const query of ['quantumzebra', '', '  !!! ', 'мне для и', null]) assert.deepEqual(searchCatalog(entries, query), { results: [], truncated: false });
});

test('kind filters are exact and results are deterministically ordered independently of input order', () => {
  const catalog = [
    { id: 'b', name: 'Beta', kind: 'mcp', description: 'database' },
    { id: 'a', name: 'Alpha', kind: 'skill', description: 'database' },
  ];
  assert.deepEqual(searchCatalog(catalog, 'database'), searchCatalog([...catalog].reverse(), 'database'));
  assert.deepEqual(searchCatalog(catalog, 'database', { kind: 'skill' }).results.map(item => item.id), ['a']);
  assert.equal(searchCatalog(catalog, 'database', { kind: ['skill', 'mcp'] }).results.length, 2);
});

test('whole JSON output obeys maxChars, including quotes, escapes and multibyte text', () => {
  const catalog = Array.from({ length: 10 }, (_, i) => ({ id: `id-${i}`, name: `table-${i}`, kind: 'skill', description: 'table "Таблица" 🧮 '.repeat(200), provider: 'test' }));
  for (const maxChars of [32, 100, 180, 500, 1_000]) {
    const result = searchCatalog(catalog, 'таблица', { limit: 10, maxChars });
    assert.ok(JSON.stringify(result).length <= maxChars, `${maxChars}: ${JSON.stringify(result).length}`);
    assert.equal(result.truncated, true);
  }
});

test('limit truncation, zero limit and bounded descriptions', () => {
  const catalog = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}`, name: `tool-${i}`, description: 'search '.repeat(200) }));
  const result = searchCatalog(catalog, 'search', { limit: 2 });
  assert.equal(result.results.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.results.every(item => item.description.length <= 600));
  assert.deepEqual(searchCatalog(catalog, 'search', { limit: 0 }), { results: [], truncated: true });
});

test('normalizes Unicode width and ё, preserves valid summaries, and searches tags', () => {
  assert.equal(searchCatalog([{ id: 'a', name: 'Ｆｉｌｅ', description: 'Счёт', tags: ['needle'] }], 'file').results[0].id, 'a');
  assert.equal(searchCatalog([{ id: 'a', name: 'a', description: 'Счёт' }], 'счет').results[0].id, 'a');
  assert.equal(searchCatalog([{ id: 'a', name: 'a', tags: ['needle'] }], 'needle').results[0].id, 'a');
});

test('invalid input and bounds fail safely', () => {
  assert.deepEqual(searchCatalog(null, 'anything'), { results: [], truncated: false });
  assert.deepEqual(searchCatalog([null, {}, { id: 1 }, { id: 'hello'.repeat(110), name: 'hello' }, { id: 'bad\u0000id', name: 'hello' }, { id: 'ok', name: 'hello' }], 'hello').results.map(item => item.id), ['ok']);
  for (const options of [{ limit: -1 }, { limit: 51 }, { limit: 1.5 }, { maxChars: 31 }, { maxChars: Infinity }]) assert.throws(() => searchCatalog(entries, 'file', options), RangeError);
});
