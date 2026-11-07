import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function compareContext(rows, contextWindow) {
  if (!Array.isArray(rows) || rows.length !== 4 || !Number.isSafeInteger(contextWindow) || contextWindow <= 0) throw new Error('Expected four observations and a positive integer context window');
  const observations = new Map();
  for (const row of rows) {
    if (typeof row.lazyMcp !== 'boolean' || typeof row.lazySkills !== 'boolean' || !Number.isSafeInteger(row.inputTokens) || row.inputTokens <= 0 || row.inputTokens > contextWindow) throw new Error('Invalid context observation');
    const key = `${Number(row.lazyMcp)}${Number(row.lazySkills)}`;
    if (observations.has(key)) throw new Error('Duplicate context variant');
    observations.set(key, row);
  }
  const base = observations.get('00').inputTokens;
  const ordered = ['00', '10', '01', '11'].map(key => {
    const row = observations.get(key); const saved = base - row.inputTokens;
    return { ...row, savedTokens: saved, savedPercent: saved / base * 100, contextPercent: row.inputTokens / contextWindow * 100 };
  });
  return { contextWindow, rows: ordered, effects: {
    mcpWithEagerSkills: ordered[0].inputTokens - ordered[1].inputTokens,
    mcpWithLazySkills: ordered[2].inputTokens - ordered[3].inputTokens,
    skillsWithEagerMcp: ordered[0].inputTokens - ordered[2].inputTokens,
    skillsWithLazyMcp: ordered[1].inputTokens - ordered[3].inputTokens,
    combined: ordered[0].inputTokens - ordered[3].inputTokens
  } };
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? new URL('../test/fixtures/context-benchmark.json', import.meta.url);
  const data = JSON.parse(await readFile(file, 'utf8'));
  const result = compareContext(data.observations, data.contextWindow);
  console.log('Saved provider input-token observations, not a new live benchmark or a billing estimate.');
  console.log(JSON.stringify({ provider: data.provider, model: data.model, ...result }, null, 2));
}
