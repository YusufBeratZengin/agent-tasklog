import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, processCLI, workspace } from '../support/helpers.js';

const args = ['add', '--area', 'runtime', '--title', 'Parser work', '--next', 'Run checks', '--due', '2026-10-22'];

test('CLI supports all commands with parseable JSON and checkpoint resumption', async (t) => {
  const cwd = await workspace(t);
  const added = await cli(cwd, ['--json', ...args, '--key', 'parser']);
  assert.equal(added.code, 0, added.stderr);
  const { task } = JSON.parse(added.stdout);
  const duplicate = await cli(cwd, [...args, '--key', 'parser', '--json']);
  assert.equal(JSON.parse(duplicate.stdout).task.id, task.id);
  const updated = await cli(cwd, ['update', task.id, '--status', 'waiting', '--note', 'Syntax complete', '--next', 'Review fixtures', '--json']);
  assert.equal(updated.code, 0, updated.stderr);
  const shown = await cli(cwd, ['show', task.id, '--json']);
  assert.equal(JSON.parse(shown.stdout).task.notes[0].text, 'Syntax complete');
  assert.equal(JSON.parse(shown.stdout).task.next, 'Review fixtures');
  const listed = await cli(cwd, ['list', '--area', 'runtime', '--json']);
  assert.equal(JSON.parse(listed.stdout).tasks.length, 1);
  const empty = await cli(cwd, ['list', '--area', 'missing']);
  assert.equal(empty.stdout.trim(), 'No tasks.');
  const md = await cli(cwd, ['md', '--json']);
  assert.match(JSON.parse(md.stdout).markdown, /Syntax complete/);
  const plainMd = await cli(cwd, ['md']);
  assert.match(plainMd.stdout, /^# Task board/);
  const cost = await cli(cwd, ['cost', 'add', '--tool', 'runner', '--amount', '0.25', '--unit', 'credits', '--note', 'Synthetic receipt', '--json']);
  assert.equal(cost.code, 0, cost.stderr);
  assert.equal(JSON.parse(cost.stdout).entry.amount, 0.25);
  const exported = await cli(cwd, ['export', '--json']);
  assert.equal(exported.code, 0, exported.stderr);
  const snapshot = JSON.parse(exported.stdout);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.costs.length, 1);
  assert.equal(snapshot.tasks[0].status, 'waiting');
  assert.deepEqual(JSON.parse((await cli(cwd, ['export'])).stdout), snapshot);
  const shownText = await cli(cwd, ['show', task.id]);
  assert.match(shownText.stdout, /Checkpoint .*Syntax complete/);
});

test('CLI usage errors are nonzero, machine-readable, and do not create logs', async (t) => {
  const cwd = await workspace(t);
  for (const invalid of [
    ['unknown'], ['add'], ['show'], ['show', 'id', 'extra'], [...args, '--bogus', 'x'],
    [...args, '--title', 'Again'], ['list', '--title', 'Wrong option'],
    ['list', '--area'], ['cost', 'remove'], ['update', 'id'],
    ['list', '--today', '--overdue'],
  ]) {
    const result = await cli(cwd, [...invalid, '--json']);
    assert.equal(result.code, 1, invalid.join(' '));
    assert.equal(result.stdout, '');
    assert.ok(JSON.parse(result.stderr).error.code);
  }
  assert.deepEqual(await readdir(cwd), []);
});

test('CLI rejects synthetic credentials without echoing or persisting them', async (t) => {
  const cwd = await workspace(t);
  const value = 'ghp_' + 'z'.repeat(36);
  const result = await cli(cwd, [...args, '--note', value, '--json']);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stderr).error.code, 'SECRET_DETECTED');
  assert.ok(!result.stderr.includes(value));
  assert.deepEqual(await readdir(cwd), []);
});

test('CLI rejects invalid dates and returns NOT_FOUND for missing tasks', async (t) => {
  const cwd = await workspace(t);
  const invalid = await cli(cwd, [...args.slice(0, -1), '2026-02-30', '--json']);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'INVALID_DATE');
  const missing = await cli(cwd, ['show', 't-00000000', '--json']);
  assert.equal(JSON.parse(missing.stderr).error.code, 'NOT_FOUND');
});

test('help and version are available without storage writes', async (t) => {
  const cwd = await workspace(t);
  assert.match((await cli(cwd, ['--help'])).stdout, /tasklog update ID/);
  assert.equal(JSON.parse((await cli(cwd, ['--version', '--json'])).stdout).version, '0.1.0');
  assert.deepEqual(await readdir(cwd), []);
});

test('concurrent CLI processes serialize appends and idempotent adds', {
  skip: process.env.TASKLOG_NO_SUBPROCESS === '1' ? 'Sandbox forbids child processes (EPERM).' : false,
}, async (t) => {
  const cwd = await workspace(t);
  const adds = await Promise.all(Array.from({ length: 10 }, (_, index) => processCLI(cwd, [...args, '--key', `job-${index}`, '--json'])));
  for (const result of adds) assert.equal(result.code, 0, result.stderr);
  const retries = await Promise.all(Array.from({ length: 10 }, () => processCLI(cwd, [...args, '--key', 'shared', '--json'])));
  for (const result of retries) assert.equal(result.code, 0, result.stderr);
  assert.equal(new Set(retries.map((result) => JSON.parse(result.stdout).task.id)).size, 1);
  const firstId = JSON.parse(adds[0].stdout).task.id;
  const checkpoints = await Promise.all(Array.from({ length: 10 }, (_, index) => processCLI(cwd, ['update', firstId, '--note', `Checkpoint ${index}`, '--json'])));
  for (const result of checkpoints) assert.equal(result.code, 0, result.stderr);
  const snapshot = JSON.parse((await cli(cwd, ['export'])).stdout);
  assert.equal(snapshot.tasks.length, 11);
  assert.equal(snapshot.events.length, 21);
  assert.equal(snapshot.tasks.find((task) => task.id === firstId).notes.length, 10);
  const lines = (await readFile(join(cwd, '.tasklog', 'tasks.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 21);
  assert.ok(lines.every((line) => JSON.parse(line).v === 1));
});
