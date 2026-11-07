import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Source symlinks are not allowed');
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(file);
  }
  return files;
}
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && /\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(entry.name)) throw new Error(`Root implementation file is forbidden: ${entry.name}`);
}
for (const file of pkg.files) await stat(path.join(root, file));
for (const key of ['.', './host']) {
  const file = pkg.exports[key];
  if (!file?.startsWith('./src/') || !(await stat(path.join(root, file))).isFile()) throw new Error(`Invalid Host export: ${key}`);
}
for (const file of ['README.md', 'README.ru.md', 'LICENSE', 'UPSTREAM.md', pkg.dsh.bundle.patch]) await stat(path.join(root, file));
for (const locale of ['en', 'ru']) JSON.parse(await readFile(path.join(root, 'locale', `${locale}.json`), 'utf8'));
const icon = await readFile(path.join(root, 'icon.png'));
if (!icon.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Expected a packaged PNG icon');
const patch = await readFile(path.join(root, pkg.dsh.bundle.patch), 'utf8');
if (!patch.includes(`name: '${pkg.name}/host'`) || /\/Users\/|[A-Z]:\\Users\\/.test(patch)) throw new Error('Bundle patch must use its published package and a portable cache directory');
const files = await sourceFiles(path.join(root, 'src'));
for (const file of files) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(checked.stderr || `Syntax check failed: ${file}`);
}
console.log(`Build verified ${pkg.name}@${pkg.version}: ${files.length} source modules, Host exports, locales, icon and distribution metadata. No generated root code is required.`);
