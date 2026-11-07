/** Bounded metadata-only lexical retrieval. Never reads schemas, bodies or files. */
const MAX_DESCRIPTION = 600;
const MAX_SEARCH_TEXT = 8_000;
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'with', 'please', 'me',
  'и', 'или', 'в', 'во', 'на', 'по', 'с', 'со', 'к', 'для', 'из', 'о', 'об', 'как',
  'мне', 'нужно', 'нужен', 'нужна', 'нужны', 'пожалуйста', 'найди', 'покажи',
]);
const ALIAS_GROUPS = [
  ['search', 'find', 'discover', 'lookup', 'поиск', 'искать', 'найти', 'отыскать', 'обнаружить'],
  ['skill', 'skills', 'навык', 'навыки', 'умение', 'инструкция'],
  ['read', 'reading', 'читать', 'прочитать', 'прочитай', 'чтение'],
  ['write', 'create', 'создать', 'создай', 'создание', 'записать', 'запись'],
  ['edit', 'update', 'modify', 'изменить', 'редактировать', 'обновить', 'правка'],
  ['delete', 'remove', 'удалить', 'удаление', 'убрать'],
  ['file', 'files', 'файл', 'файлы'],
  ['directory', 'folder', 'папка', 'каталог', 'директория'],
  ['spreadsheet', 'table', 'tables', 'excel', 'xlsx', 'таблица', 'таблицы', 'табличный'],
  ['document', 'word', 'docx', 'документ', 'документы', 'текстовый'],
  ['presentation', 'slide', 'slides', 'pptx', 'презентация', 'слайд', 'слайды'],
  ['pdf', 'пдф'],
  ['calculate', 'recalculate', 'calculation', 'пересчитать', 'пересчет', 'расчет', 'вычислить'],
  ['formula', 'formulas', 'формула', 'формулы'],
  ['convert', 'conversion', 'конвертировать', 'преобразовать', 'конвертация'],
  ['render', 'preview', 'рендер', 'отрисовать', 'предпросмотр'],
  ['research', 'investigate', 'исследовать', 'исследование', 'изучить'],
  ['image', 'picture', 'photo', 'изображение', 'картинка', 'фото'],
  ['video', 'youtube', 'видео', 'ютуб'],
  ['browser', 'browse', 'браузер', 'веб'],
  ['web', 'internet', 'интернет', 'сайт'],
  ['github', 'гитхаб', 'гитхабе'],
  ['repository', 'repositories', 'repo', 'репозиторий', 'репозиториев', 'репозиторий'],
  ['issue', 'issues', 'ticket', 'тикет', 'задача', 'задачи'],
  ['pull', 'pullrequest', 'pr', 'пулреквест', 'пуллреквест'],
  ['code', 'coding', 'program', 'код', 'программирование', 'программа'],
  ['test', 'tests', 'testing', 'тест', 'тесты', 'тестирование'],
  ['terminal', 'shell', 'bash', 'терминал', 'оболочка'],
  ['command', 'команда', 'команды'],
  ['database', 'db', 'sql', 'база', 'бд'],
  ['email', 'mail', 'почта', 'письмо', 'письма'],
  ['calendar', 'event', 'календарь', 'событие'],
  ['memory', 'remember', 'память', 'запомнить'],
  ['session', 'sessions', 'сессия', 'сессии', 'разговор'],
  ['schedule', 'reminder', 'расписание', 'напоминание', 'напомнить'],
  ['tool', 'tools', 'инструмент', 'инструменты'],
];

function text(value, limit) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit)
    : '';
}
function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
}
function stem(token) {
  if (/^[а-я]{5,}$/u.test(token)) {
    return token.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|иях|иях|ах|ях|ов|ев|ей|ий|ый|ой|ая|яя|ое|ее|ые|ие|ую|юю|ом|ем|ам|ям|ы|и|а|я|у|ю|е)$/u, '');
  }
  if (/^[a-z]{5,}$/u.test(token)) return token.replace(/(?:ies|s)$/u, match => match === 'ies' ? 'y' : '');
  return token;
}
function tokens(value) {
  return (normalize(value.replace(/([\p{Ll}\d])([\p{Lu}])/gu, '$1 $2')).match(/[\p{L}\p{N}]+/gu) ?? [])
    .flatMap(token => token === stem(token) ? [token] : [token, stem(token)]);
}
const ALIASES = new Map();
for (const group of ALIAS_GROUPS) {
  const variants = new Set(group.flatMap(tokens));
  // Overlapping groups merge rather than depend on declaration order.
  for (const variant of [...variants]) for (const alias of ALIASES.get(variant) ?? []) variants.add(alias);
  for (const variant of variants) ALIASES.set(variant, variants);
}
function queryGroups(query) {
  const groups = [];
  const seen = new Set();
  for (const token of tokens(query)) {
    if (STOP_WORDS.has(token)) continue;
    const variants = ALIASES.get(token) ?? new Set([token]);
    const key = [...variants].sort().join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(variants);
  }
  return groups;
}
function termMap(value) {
  const map = new Map();
  for (const token of tokens(value)) map.set(token, Math.min(8, (map.get(token) ?? 0) + 1));
  return map;
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function card(entry) {
  // IDs are actionable identities: omit malformed/oversized ones, never rewrite them.
  const id = typeof entry.id === 'string' ? entry.id : '';
  if (!id || id.length > 512 || /[\u0000-\u001f\u007f]/u.test(id)) return null;
  const name = text(entry.name, 256) || id;
  return {
    id, name,
    kind: text(entry.kind, 64),
    description: text(entry.description, MAX_DESCRIPTION),
    provider: text(entry.provider, 160),
  };
}
function matchWeight(document, group) {
  let weight = 0;
  for (const [map, boost] of document.fields) {
    let frequency = 0;
    for (const token of group) frequency = Math.max(frequency, map.get(token) ?? 0);
    if (frequency) weight += boost * frequency / (frequency + 1.2);
  }
  return weight;
}

/**
 * Search only catalog metadata. Result cards never contain schemas, skill bodies,
 * paths, arbitrary nested values or tags. maxChars bounds the complete JSON result.
 * Hidden/executable scope and authorization are the caller's responsibility.
 */
export function searchCatalog(entries, query, { limit = 5, maxChars = 5_000, kind } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) throw new RangeError('limit must be an integer from 0 to 50');
  if (!Number.isSafeInteger(maxChars) || maxChars < 32 || maxChars > 100_000) throw new RangeError('maxChars must be an integer from 32 to 100000');
  if (!Array.isArray(entries) || typeof query !== 'string') return { results: [], truncated: false };
  const boundedQuery = text(query, 2_000);
  const groups = queryGroups(boundedQuery);
  if (!groups.length) return { results: [], truncated: false };
  const kinds = kind === undefined ? null : new Set(Array.isArray(kind) ? kind : [kind]);
  const documents = [];
  const shortenedDescriptions = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || (kinds && !kinds.has(entry.kind))) continue;
    const summary = card(entry);
    if (!summary) continue;
    if (text(entry.description, MAX_DESCRIPTION + 1).length > MAX_DESCRIPTION) shortenedDescriptions.add(summary.id);
    const tags = Array.isArray(entry.tags) ? entry.tags.slice(0, 64).map(tag => text(tag, 128)).join(' ') : '';
    documents.push({
      card: summary,
      fields: [
        [termMap(summary.name), 10], [termMap(summary.id), 8], [termMap(tags), 4],
        [termMap(text(entry.description, MAX_SEARCH_TEXT)), 2],
        [termMap(summary.provider), 1], [termMap(summary.kind), 1],
      ],
    });
  }
  const frequencies = groups.map(group => documents.filter(doc => matchWeight(doc, group) > 0).length);
  const exactQuery = normalize(boundedQuery);
  const ranked = [];
  for (const doc of documents) {
    let score = 0;
    let matched = 0;
    for (let i = 0; i < groups.length; i++) {
      const weight = matchWeight(doc, groups[i]);
      if (!weight) continue;
      matched++;
      score += weight * Math.log(1 + (documents.length + 0.5) / (frequencies[i] + 0.5));
    }
    if (!matched) continue;
    score *= 1 + matched / groups.length;
    if (normalize(doc.card.id) === exactQuery || normalize(doc.card.name) === exactQuery) score += 1_000;
    ranked.push({ ...doc.card, score: Math.round(score * 1_000) / 1_000 });
  }
  ranked.sort((a, b) => b.score - a.score || compare(a.name, b.name) || compare(a.id, b.id) || compare(a.kind, b.kind));
  const results = [];
  let truncated = ranked.length > limit;
  const fits = candidate => JSON.stringify({ results: [...results, candidate], truncated: false }).length <= maxChars;
  for (const result of ranked.slice(0, limit)) {
    const candidate = { ...result };
    if (!fits(candidate)) {
      truncated = true;
      // Keep an identifying card if its summary can be shortened to fit.
      candidate.description = '';
      if (!fits(candidate)) continue;
      let low = 0;
      let high = result.description.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        candidate.description = result.description.slice(0, middle);
        if (fits(candidate)) low = middle;
        else high = middle - 1;
      }
      candidate.description = result.description.slice(0, low);
    }
    if (shortenedDescriptions.has(result.id)) truncated = true;
    results.push(candidate);
  }
  return { results, truncated };
}
