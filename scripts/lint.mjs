import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertSafe } from '../src/validation.js';

const project = new URL('../', import.meta.url);
const { fileURLToPath } = await import('node:url');
const directory = fileURLToPath(project);
const ignored = new Set(['.git', '.tasklog', 'node_modules', 'is', 'coverage']);
let failures = 0;
let count = 0;

function report(file, message) {
  console.error(`${file}: ${message}`);
  failures++;
}

async function inspect(file, source) {
  count++;
  if (/\r/.test(source)) report(file, 'Use LF line endings.');
  if (!source.endsWith('\n')) report(file, 'Missing final newline.');
  if (/[^\S\n]+$/m.test(source)) report(file, 'Trailing whitespace.');
  try { assertSafe(source); } catch { report(file, 'Possible credential detected; rejected content is not printed.'); }
  if (file.endsWith('.json')) {
    try { JSON.parse(source); } catch { report(file, 'Invalid JSON.'); }
  }
}

async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue;
    const full = join(path, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.isFile()) await inspect(relative(directory, full), await readFile(full, 'utf8'));
  }
}

if (process.argv.includes('--staged')) {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: directory, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot read staged paths.');
  for (const file of result.stdout.split('\0').filter(Boolean)) {
    if (/(?:^|\/)\.env|\.(?:pem|key|p12|pfx)$|(?:^|\/)id_(?:rsa|ed25519)/i.test(file)) {
      report(file, 'Credential file must not be committed.');
      continue;
    }
    const staged = spawnSync('git', ['show', `:${file}`], { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (staged.status !== 0) report(file, 'Cannot inspect staged content.');
    else await inspect(file, staged.stdout);
  }
} else await walk(directory);

if (failures) process.exitCode = 1;
else console.log(`Lint passed: ${count} files (JSON, whitespace, credential patterns).`);
