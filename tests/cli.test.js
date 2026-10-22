import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, processCLI, workspace, root, input } from '../support/helpers.js';
import { Tasklog } from '../src/store.js';

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

test('value options accept separate and equals syntax', async (t) => {
  for (const equals of [false, true]) {
    const cwd = await workspace(t);
    const option = (key, value) => equals ? [`--${key}=${value}`] : [`--${key}`, value];
    const added = await cli(cwd, ['add', ...option('area', 'parser'), ...option('title', 'A=B task'),
      ...option('next', 'Run checks'), ...option('due', 'tomorrow'), ...option('ref', 'issue=17'), ...option('key', 'syntax'), '--json'],
    { now: () => new Date(2026, 9, 22, 23) });
    assert.equal(added.code, 0, added.stderr);
    const { task } = JSON.parse(added.stdout);
    assert.equal(task.title, 'A=B task');
    assert.equal(task.due, '2026-10-23');
    const updated = await cli(cwd, ['update', task.id, ...option('status', 'waiting'), ...option('note', 'Checkpoint'), '--json']);
    assert.equal(updated.code, 0, updated.stderr);
    assert.equal(JSON.parse(updated.stdout).task.status, 'waiting');
    assert.equal(JSON.parse((await cli(cwd, ['list', ...option('area', 'parser'), '--json'])).stdout).tasks.length, 1);
  }
});

test('usage errors identify the offending command, argument or option', async (t) => {
  const cwd = await workspace(t);
  const cases = [
    [['list', '--nxt', 'step'], "Unknown option '--nxt'. Did you mean '--next'?"],
    [['list', '--nxt=step'], "Unknown option '--nxt'. Did you mean '--next'?"],
    [['list', '--unrecognized'], "Unknown option '--unrecognized'. Run tasklog --help."],
    [['add', '--due'], "Option '--due' needs a value"],
    [['add', '--due='], "Option '--due' needs a value"],
    [['add', '--due', '--json'], "Option '--due' needs a value"],
    [['list', '--area', 'a', '--area=b'], "Duplicate option '--area'."],
    [['list', '--due=tomorrow'], "Option '--due' is not valid for this command. Run tasklog --help."],
    [['list', '--all=true'], "Option '--all=true' does not accept a value."],
    [['list', '-x'], "Unknown option '-x'. Run tasklog --help."],
    [['show'], "Command 'show' needs an ID."],
    [['list', 'extra'], "Unexpected argument 'extra'. Run tasklog --help."],
    [['mystery'], "Unknown command 'mystery'. Run tasklog --help."],
    [['cost', 'remove'], "Unknown subcommand 'remove' for 'cost'. Run tasklog --help."],
    [['add'], "Missing option '--area'."],
    [['list', '--all', '--status=done'], "Option '--all' cannot be combined with '--status'."],
  ];
  for (const [invalid, message] of cases) {
    const result = await cli(cwd, [...invalid, '--json']);
    assert.equal(result.code, 1, invalid.join(' '));
    assert.deepEqual(JSON.parse(result.stderr), { error: { code: 'USAGE', message } });
  }
  assert.deepEqual(await readdir(cwd), []);
});

test('list defaults to active tasks, supports explicit statuses, and export retains all tasks', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  for (const status of ['open', 'waiting', 'done', 'cancelled']) {
    const task = await store.add({ ...input, title: status });
    if (status !== 'open') await store.update(task.id, { status });
  }
  for (const [filters, expected] of [
    [[], ['open', 'waiting']], [['--all'], ['open', 'waiting', 'done', 'cancelled']],
    [['--status=all'], ['open', 'waiting', 'done', 'cancelled']], [['--status', 'done'], ['done']],
    [['--status=waiting'], ['waiting']], [['--status=cancelled'], ['cancelled']], [['--status=open'], ['open']],
  ]) {
    const result = await cli(cwd, ['list', ...filters, '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).tasks.map((task) => task.status).sort(), expected.sort());
  }
  assert.equal(JSON.parse((await cli(cwd, ['export'])).stdout).tasks.length, 4);
  assert.equal((await cli(cwd, ['list', '--status=open,waiting'])).code, 1);
});

test('cost list filters and totals use exact six-decimal arithmetic per tool and unit', async (t) => {
  const cwd = await workspace(t);
  for (const [tool, amount, unit, at] of [
    ['runner', '0.1', 'USD', '2026-10-20T12:00:00Z'], ['runner', '0.2', 'USD', '2026-10-22T00:00:00Z'],
    ['runner', '0.000001', 'credits', '2026-10-22T12:00:00Z'], ['other', '1.123456', 'USD', '2026-10-23T12:00:00Z'],
    ['runner', '0.000002', 'credits', '2026-10-23T12:00:00Z'],
  ]) {
    const result = await cli(cwd, ['cost', 'add', `--tool=${tool}`, `--amount=${amount}`, `--unit=${unit}`, '--note=Synthetic receipt'], { now: () => new Date(at) });
    assert.equal(result.code, 0, result.stderr);
  }
  for (const [filters, count] of [[[], 5], [['--tool=runner'], 4], [['--unit=USD'], 3],
    [['--since=2026-10-22', '--unit=USD', '--tool=runner'], 1], [['--since=2026-10-24'], 0]]) {
    const result = await cli(cwd, ['cost', 'list', ...filters, '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).entries.length, count);
  }
  const totals = JSON.parse((await cli(cwd, ['cost', 'total', '--json'])).stdout).totals;
  assert.deepEqual(totals, [
    { tool: 'other', unit: 'USD', amount: '1.123456' },
    { tool: 'runner', unit: 'credits', amount: '0.000003' }, { tool: 'runner', unit: 'USD', amount: '0.3' },
  ]);
  assert.deepEqual(JSON.parse((await cli(cwd, ['cost', 'total', '--unit=credits', '--json'])).stdout).totals, [totals[1]]);
  assert.match((await cli(cwd, ['cost', 'total', '--unit=USD'])).stdout, /runner: 0.3 USD/);
  assert.equal(JSON.parse((await cli(cwd, ['cost', 'list', '--since=2026-02-30', '--json'])).stderr).error.code, 'INVALID_DATE');
  const empty = await workspace(t);
  assert.equal((await cli(empty, ['cost', 'list'])).stdout.trim(), 'No costs.');
  assert.equal((await cli(empty, ['cost', 'total'])).stdout.trim(), 'No costs.');
});

test('md filters statuses and atomically replaces --out without leaving temp files', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  const active = await store.add(input);
  const closed = await store.add({ ...input, title: 'Closed work' });
  await store.update(closed.id, { status: 'done' });
  await writeFile(join(cwd, 'TASKS.md'), 'previous contents');
  const result = await cli(cwd, ['md', '--status=open,waiting', '--out=TASKS.md', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const board = JSON.parse(result.stdout).markdown;
  assert.match(board, new RegExp(active.id));
  assert.doesNotMatch(board, /Closed work|## Waiting|## Done|previous contents/);
  assert.equal(await readFile(join(cwd, 'TASKS.md'), 'utf8'), board);
  assert.deepEqual((await readdir(cwd)).sort(), ['.tasklog', 'TASKS.md']);
  assert.match((await cli(cwd, ['md'])).stdout, /## Done/);
  const failed = await cli(cwd, ['md', '--out=.tasklog']);
  assert.equal(failed.code, 1);
  assert.deepEqual((await readdir(cwd)).sort(), ['.tasklog', 'TASKS.md']);
});

test('resume chooses updatedAt among active tasks and includes only the last three checkpoints', async (t) => {
  const cwd = await workspace(t);
  assert.deepEqual(JSON.parse((await cli(cwd, ['resume', '--json'])).stdout), { task: null });
  assert.equal((await cli(cwd, ['resume'])).stdout.trim(), 'No active task.');
  let tick = 0;
  const store = new Tasklog({ cwd, now: () => new Date(Date.UTC(2026, 9, 22, 12, 0, tick++)) });
  const older = await store.add(input);
  const newer = await store.add({ ...input, title: 'Created later' });
  for (let i = 1; i <= 5; i++) await store.update(older.id, { note: `Step ${i}` });
  await store.update(older.id, { status: 'waiting', next: 'Review results' });
  await store.update(newer.id, { status: 'done' });
  const cancelled = await store.add({ ...input, title: 'Cancelled later' });
  await store.update(cancelled.id, { status: 'cancelled' });
  const result = await cli(cwd, ['resume', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const { task } = JSON.parse(result.stdout);
  assert.equal(task.id, older.id);
  assert.equal(task.next, 'Review results');
  assert.equal(task.due, input.due);
  assert.deepEqual(task.notes.map((note) => note.text), ['Step 3', 'Step 4', 'Step 5']);
  const text = (await cli(cwd, ['resume'])).stdout;
  assert.match(text, /Next: Review results/);
  assert.equal((text.match(/Checkpoint/g) ?? []).length, 3);
  assert.equal((await store.show(older.id)).notes.length, 5);
});

test('TASKLOG_NOW injects the CLI test clock without changing v1 date storage', async (t) => {
  const cwd = await workspace(t);
  const previous = process.env.TASKLOG_NOW;
  t.after(() => { if (previous === undefined) delete process.env.TASKLOG_NOW; else process.env.TASKLOG_NOW = previous; });
  process.env.TASKLOG_NOW = '2026-12-31T23:30:00';
  const result = await cli(cwd, [...args.slice(0, -1), '+1w', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).task.due, '2027-01-07');
  process.env.TASKLOG_NOW = 'invalid';
  assert.equal(JSON.parse((await cli(cwd, [...args, '--json'])).stderr).error.code, 'INVALID_DATE');
});

test('synthetic example snapshot replays through export', async (t) => {
  const cwd = await workspace(t);
  await cp(join(root, 'examples', '.tasklog'), join(cwd, '.tasklog'), { recursive: true });
  const result = await cli(cwd, ['export']);
  assert.equal(result.code, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.tasks.length, 2);
  assert.equal(snapshot.costs.length, 2);
  assert.equal(snapshot.tasks.find((task) => task.status === 'waiting').notes.length, 1);
});
