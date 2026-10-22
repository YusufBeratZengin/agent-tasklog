import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Tasklog, filterTasks } from '../src/store.js';
import { replay } from '../src/replay.js';
import { markdownBoard } from '../src/markdown.js';
import { validDate, localDate, assertSafe, resolveDue } from '../src/validation.js';
import { workspace, input } from '../support/helpers.js';

const now = () => new Date('2026-10-22T09:30:00.000Z');

test('replays create, update, checkpoints, close, and reopen across sessions', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd, now });
  const task = await store.add({ ...input, ref: 'issue-17' });
  assert.match(task.id, /^t-[a-f0-9]{8}$/);
  await store.update(task.id, { status: 'waiting', next: 'Review fixture', note: 'Parser implemented' });
  await store.update(task.id, { status: 'done', note: 'Checks passed' });
  const reopened = await new Tasklog({ cwd, now }).update(task.id, { status: 'open', due: '2026-10-23' });
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.next, 'Review fixture');
  assert.equal(reopened.due, '2026-10-23');
  assert.deepEqual(reopened.notes.map((note) => note.text), ['Parser implemented', 'Checks passed']);
  assert.equal(reopened.ref, 'issue-17');
  const raw = await readFile(join(cwd, '.tasklog', 'tasks.jsonl'), 'utf8');
  assert.deepEqual(raw.trim().split('\n').map((line) => JSON.parse(line).type), ['create', 'update', 'note', 'close', 'note', 'update']);
  assert.deepEqual(await store.show(task.id), reopened);
  assert.equal(reopened.createdAt, now().toISOString());
});

test('idempotency survives task changes and rejects conflicting creation fields', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd, now });
  const original = { ...input, key: 'parser-resume' };
  const first = await store.add(original);
  await store.update(first.id, { next: 'Ship the patch', status: 'done' });
  const retry = await new Tasklog({ cwd, now }).add(original);
  assert.equal(retry.id, first.id);
  assert.equal(retry.next, 'Ship the patch');
  assert.equal(retry.status, 'done');
  assert.equal((await store.export()).events.length, 2);
  await assert.rejects(store.add({ ...original, title: 'Different work' }), { code: 'KEY_CONFLICT' });
  const unkeyed = await store.add(input);
  assert.notEqual(unkeyed.id, first.id);
});

test('concurrent store clients preserve all appends and one shared creation key', async (t) => {
  const cwd = await workspace(t);
  const clients = Array.from({ length: 12 }, () => new Tasklog({ cwd, now }));
  const shared = await Promise.all(clients.map((client) => client.add({ ...input, key: 'shared' })));
  assert.equal(new Set(shared.map((task) => task.id)).size, 1);
  const id = shared[0].id;
  await Promise.all(clients.map((client, index) => client.update(id, { note: `Step ${index}` })));
  await Promise.all(clients.map((client, index) => client.add({ ...input, key: `separate-${index}` })));
  const exported = await clients[0].export();
  assert.equal(exported.tasks.length, 13);
  assert.equal(exported.events.length, 25);
  assert.equal(new Set(exported.tasks.find((task) => task.id === id).notes.map((note) => note.text)).size, 12);
});

test('calendar validation rejects rollover and accepts leap days', () => {
  for (const date of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-00-02', '2026-1-02', '2026-04-31', 'tomorrow']) {
    assert.equal(validDate(date), false, date);
  }
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2026-12-31'), true);
  assert.equal(localDate(new Date(2026, 9, 22, 0, 1)), '2026-10-22');
});

test('today and overdue use local dates, exclude closed tasks, and combine with area', () => {
  const tasks = [
    { id: 'a', due: '2026-10-21', status: 'waiting', area: 'runtime' },
    { id: 'b', due: '2026-10-22', status: 'open', area: 'runtime' },
    { id: 'c', due: '2026-10-22', status: 'done', area: 'runtime' },
    { id: 'd', due: '2026-10-20', status: 'cancelled', area: 'runtime' },
    { id: 'e', due: '2026-10-22', status: 'waiting', area: 'docs' },
    { id: 'f', due: '2026-10-23', status: 'open', area: 'runtime' },
  ];
  const instant = new Date(2026, 9, 22, 0, 1);
  assert.deepEqual(filterTasks(tasks, { today: true }, instant).map((item) => item.id), ['b', 'e']);
  assert.deepEqual(filterTasks(tasks, { overdue: true }, instant).map((item) => item.id), ['a']);
  assert.deepEqual(filterTasks(tasks, { area: 'runtime', today: true }, instant).map((item) => item.id), ['b']);
  assert.equal(filterTasks(tasks, {}, instant).length, 6);
  assert.throws(() => filterTasks(tasks, { today: true, overdue: true }, instant), { code: 'INVALID_INPUT' });
});

test('markdown preserves board structure and escapes injected markup and line breaks', () => {
  const board = markdownBoard([{ id: 't-12345678', status: 'waiting', area: 'a|b', title: '<script>*x*</script>',
    due: '2026-10-22', next: 'first\nsecond', ref: '[link](x)', notes: [{ text: 'older' }, { text: '`new`' }] }]);
  assert.doesNotMatch(board, /## Open\n/);
  assert.match(board, /## Waiting\n/);
  assert.doesNotMatch(board, /## Done\n/);
  assert.doesNotMatch(board, /## Cancelled\n/);
  assert.match(board, /a&#124;b/);
  assert.match(board, /&lt;script&gt;&#42;x&#42;&lt;\/script&gt;/);
  assert.match(board, /first<br>second/);
  assert.match(board, /&#96;new&#96;/);
  assert.doesNotMatch(board, /older|<script>|\[link\]/);
  assert.ok(board.endsWith('\n'));
});

test('Markdown omits empty sections and marks a completely empty board', () => {
  assert.equal(markdownBoard([]), '# Task board\n\n_None_\n');
  const tasks = ['open', 'waiting', 'done', 'cancelled'].map((status) => ({
    id: 't-12345678', status, area: 'example', title: 'Example', due: input.due, next: 'Check', notes: [],
  }));
  for (const status of ['Open', 'Waiting', 'Done', 'Cancelled']) assert.match(markdownBoard(tasks), new RegExp(`## ${status}\\n`));
  assert.doesNotMatch(markdownBoard(tasks, ['open', 'waiting']), /## Done|## Cancelled/);
});

test('relative due dates use the injected local calendar across month, year and DST boundaries', async (t) => {
  for (const [instant, value, expected] of [
    [new Date(2026, 11, 31, 23, 59), 'today', '2026-12-31'],
    [new Date(2026, 11, 31, 23, 59), 'tomorrow', '2027-01-01'],
    [new Date(2024, 1, 28, 12), '+3d', '2024-03-02'],
    [new Date(2026, 9, 22, 0, 1), '+1w', '2026-10-29'],
    [new Date(2026, 2, 7, 12), '+1d', '2026-03-08'],
    [new Date(2026, 9, 31, 12), '+1d', '2026-11-01'],
  ]) assert.equal(resolveDue(value, instant), expected);
  for (const value of ['yesterday', '+1m', '+-1d', '+1.5d', '+999999999999999999d']) {
    assert.throws(() => resolveDue(value), { code: 'INVALID_DATE' });
  }
  const store = new Tasklog({ cwd: await workspace(t), now: () => new Date(2026, 11, 31, 23, 59) });
  const task = await store.add({ ...input, due: 'tomorrow' });
  await store.update(task.id, { due: '+1w' });
  assert.equal((await store.export()).events[0].data.due, '2027-01-01');
  assert.equal((await store.show(task.id)).due, '2027-01-07');
});

test('relative dates cross actual DST transitions using calendar days rather than elapsed hours', () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(resolveDue('tomorrow', new Date('2026-03-08T04:30:00Z')), '2026-03-08');
    assert.equal(resolveDue('+1d', new Date('2026-11-01T04:30:00Z')), '2026-11-02');
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('cost totals remain exact when aggregate micro-units exceed Number safe integer range', async (t) => {
  const store = new Tasklog({ cwd: await workspace(t), now });
  for (const amount of ['9000000000', '9000000000', '0.000001']) {
    await store.addCost({ tool: 'runner', unit: 'credits', amount, note: 'Synthetic precision check' });
  }
  assert.deepEqual(await store.totalCosts(), [{ tool: 'runner', unit: 'credits', amount: '18000000000.000001' }]);
});

test('invalid updates and absent IDs never append events', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  const task = await store.add(input);
  for (const patch of [{}, { status: 'later' }, { due: '2026-02-30' }, { next: '' }, { note: ' ' }]) {
    await assert.rejects(store.update(task.id, patch));
  }
  await assert.rejects(store.update('t-00000000', { note: 'checkpoint' }), { code: 'NOT_FOUND' });
  await assert.rejects(store.show('t-00000000'), { code: 'NOT_FOUND' });
  assert.equal((await store.export()).events.length, 1);
});

test('corrupt or torn logs are reported without modification', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  await store.add(input);
  const path = join(cwd, '.tasklog', 'tasks.jsonl');
  const good = await readFile(path, 'utf8');
  for (const suffix of ['{"v":', '\n', '{bad}\n', '{}\n']) {
    const broken = good + suffix;
    await writeFile(path, broken);
    await assert.rejects(store.list(), { code: 'CORRUPT_LOG' });
    await assert.rejects(store.add(input), { code: 'CORRUPT_LOG' });
    assert.equal(await readFile(path, 'utf8'), broken);
  }
  await writeFile(path, good);
  assert.equal((await store.list()).length, 1);
});

test('replay rejects unknown events, duplicate IDs and keys, and dangling changes', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  await store.add({ ...input, key: 'one-key' });
  const [event] = (await store.export()).events;
  for (const extra of [event, { ...event, id: 't-12345678' }, { ...event, type: 'mystery' },
    { ...event, type: 'note', id: 't-12345678', data: { note: 'Lost' } },
    { ...event, type: 'close', data: { status: 'open' } }, { ...event, v: 2 }]) {
    assert.throws(() => replay([event, extra]), { code: 'CORRUPT_LOG' });
  }
});

test('cost ledger records decimal amounts and units separately from tasks', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd, now });
  const cost = await store.addCost({ tool: 'local-runner', amount: '0.125', unit: 'credits', note: 'Synthetic receipt' });
  assert.match(cost.id, /^c-[a-f0-9]{8}$/);
  assert.equal(cost.amount, 0.125);
  const exported = await new Tasklog({ cwd }).export();
  assert.deepEqual(exported.costs, [cost]);
  assert.deepEqual(exported.tasks, []);
  assert.equal(exported.costEvents[0].type, 'cost');
  for (const amount of ['-1', '0', 'NaN', '1e2', '0.0000001', '9007199254.740992', '1.2 USD']) {
    await assert.rejects(store.addCost({ tool: 'runner', amount, unit: 'USD', note: 'Invalid test amount' }), { code: 'INVALID_AMOUNT' });
  }
  assert.equal((await store.export()).costs.length, 1);
  const path = join(cwd, '.tasklog', 'costs.jsonl');
  await appendFile(path, '{}\n');
  await assert.rejects(store.export(), { code: 'CORRUPT_LOG' });
});

test('common credential patterns are rejected in every task and cost text field', async (t) => {
  const cwd = await workspace(t);
  const store = new Tasklog({ cwd });
  const synthetic = [
    'sk-' + 'x'.repeat(24), 'sk-proj-' + 'x'.repeat(24), 'ghp_' + 'x'.repeat(36),
    'github_pat_' + 'x'.repeat(30), 'AKIA' + 'A'.repeat(16), 'xoxb-' + '1'.repeat(20),
    'glpat-' + 'x'.repeat(20), 'npm_' + 'x'.repeat(36), 'sk_live_' + 'x'.repeat(24),
    'pypi-' + 'x'.repeat(30), 'token=' + 'x'.repeat(16), 'client_secret=' + 'x'.repeat(16),
    '-----BEGIN ' + 'PRIVATE KEY-----', 'AIza' + 'x'.repeat(35),
    'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12),
    'Bearer ' + 'x'.repeat(24), 'password=' + 'x'.repeat(12), 'https://' + 'user:pass@' + 'example.invalid',
  ];
  for (const secret of synthetic) {
    assert.throws(() => assertSafe(secret), { code: 'SECRET_DETECTED' });
    for (const field of ['area', 'title', 'next', 'ref', 'key']) {
      await assert.rejects(store.add({ ...input, [field]: secret }), { code: 'SECRET_DETECTED' });
    }
    for (const field of ['tool', 'unit', 'note']) {
      await assert.rejects(store.addCost({ tool: 'runner', amount: '1', unit: 'credits', note: 'checkpoint', [field]: secret }), { code: 'SECRET_DETECTED' });
    }
  }
  const task = await store.add(input);
  await assert.rejects(store.update(task.id, { note: synthetic[0] }), { code: 'SECRET_DETECTED' });
  assert.equal((await store.export()).events.length, 1);
});
