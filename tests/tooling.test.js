import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { withLock } from '../src/lock.js';
import { workspace, root, cli } from '../support/helpers.js';

const exec = promisify(execFile);
const skip = process.env.TASKLOG_NO_SUBPROCESS === '1' ? 'TASKLOG_NO_SUBPROCESS skips subprocess checks.' : false;

test('8 CLI workers append 200 valid events with unique IDs within 20 seconds', { skip, timeout: 20000 }, async (t) => {
  const cwd = await workspace(t);
  const started = Date.now();
  const workers = await Promise.all(Array.from({ length: 8 }, () => exec(process.execPath,
    [join(root, 'support', 'stress-worker.js')], { cwd, timeout: 18000 })));
  for (const result of workers) assert.equal(result.stderr, '');
  const raw = await readFile(join(cwd, '.tasklog', 'tasks.jsonl'), 'utf8');
  assert.ok(raw.endsWith('\n'));
  const events = raw.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.length, 200);
  assert.ok(events.every((event) => event.v === 1 && event.type === 'create'));
  assert.equal(new Set(events.map((event) => event.id)).size, 200);
  const exported = await cli(cwd, ['export']);
  assert.equal(exported.code, 0, exported.stderr);
  assert.doesNotMatch(exported.stderr, /CORRUPT_LOG/);
  assert.equal(JSON.parse(exported.stdout).tasks.length, 200);
  assert.ok(Date.now() - started < 20000);
});

test('a dead local PID is reclaimed while an old foreign-host lock is retained', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  const deadPID = 2147483647;
  assert.throws(() => process.kill(deadPID, 0), { code: 'ESRCH' });
  await writeFile(path, JSON.stringify({ pid: deadPID, host: hostname(), ownerId: 'synthetic-owner' }));
  assert.equal(await withLock(path, () => 'reclaimed', { timeoutMs: 1000 }), 'reclaimed');
  const foreign = JSON.stringify({ pid: deadPID, host: `${hostname()}-foreign`, ownerId: 'synthetic-owner' });
  await writeFile(path, foreign);
  await utimes(path, new Date(0), new Date(0));
  await assert.rejects(withLock(path, () => assert.fail('Foreign lock entered'), { timeoutMs: 80, staleMs: 0 }), { code: 'LOCK_TIMEOUT' });
  assert.equal(await readFile(path, 'utf8'), foreign);
});

test('lint rejects undocumented --help commands in a temporary copy', { skip }, async (t) => {
  const cwd = await workspace(t);
  for (const path of ['scripts', 'src', 'README.md', 'README.tr.md', 'package.json']) {
    await cp(join(root, path), join(cwd, path), { recursive: true });
  }
  const file = join(cwd, 'src', 'cli.js');
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace('  tasklog export [--json]', '  tasklog inspect\n  tasklog export [--json]'));
  await assert.rejects(exec(process.execPath, ['scripts/lint.mjs'], { cwd }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Command table is missing 'inspect' from --help/);
    return true;
  });
  await writeFile(file, source);
  await writeFile(join(cwd, 'src', 'broken.js'), 'const = ;\n');
  await assert.rejects(exec(process.execPath, ['scripts/lint.mjs'], { cwd }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /JavaScript syntax check failed/);
    return true;
  });
});
