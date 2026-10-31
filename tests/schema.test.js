import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RECORD_SCHEMA,
  RECORD_SCHEMA_VERSION,
  isValidTimestamp,
  normalizeTimestamp,
  validateRecord,
  assertRecord,
  toRecord,
  migrateRecords,
} from '../src/schema.js';
import { Tasklog } from '../src/store.js';
import { workspace, cli, input } from '../support/helpers.js';

test('RECORD_SCHEMA defines required common fields and version', () => {
  assert.equal(RECORD_SCHEMA_VERSION, 2);
  assert.equal(RECORD_SCHEMA.title, 'TasklogRecord');
  assert.ok(RECORD_SCHEMA.properties.startedAt);
  assert.ok(RECORD_SCHEMA.properties.finishedAt);
  assert.ok(RECORD_SCHEMA.properties.exitCode);
  assert.ok(RECORD_SCHEMA.properties.durationMs);
  assert.deepEqual(RECORD_SCHEMA.required, ['id', 'status', 'startedAt']);
});

test('timestamp helpers validate and normalize UTC timestamps', () => {
  assert.equal(isValidTimestamp('2026-10-22T09:30:00.000Z'), true);
  assert.equal(isValidTimestamp('2026-10-22T09:30:00Z'), false);
  assert.equal(isValidTimestamp('not-a-date'), false);
  assert.equal(isValidTimestamp(null), false);

  assert.equal(normalizeTimestamp('2026-10-22T09:30:00.000Z'), '2026-10-22T09:30:00.000Z');
  assert.equal(normalizeTimestamp('2026-10-22T09:30:00Z'), '2026-10-22T09:30:00.000Z');
  assert.equal(normalizeTimestamp('not-a-date'), null);
  assert.equal(normalizeTimestamp(123), null);
});

test('validateRecord and assertRecord enforce record integrity', () => {
  const validOpen = {
    id: 't-12345678',
    title: 'Test task',
    area: 'core',
    status: 'open',
    startedAt: '2026-10-22T09:00:00.000Z',
    finishedAt: null,
    exitCode: null,
    durationMs: null,
  };
  assert.equal(validateRecord(validOpen).valid, true);
  assert.doesNotThrow(() => assertRecord(validOpen));

  const validDone = {
    id: 't-12345678',
    title: 'Done task',
    area: 'core',
    status: 'done',
    startedAt: '2026-10-22T09:00:00.000Z',
    finishedAt: '2026-10-22T09:10:00.000Z',
    exitCode: 0,
    durationMs: 600000,
  };
  assert.equal(validateRecord(validDone).valid, true);
  assert.doesNotThrow(() => assertRecord(validDone));

  for (const bad of [
    null,
    'not an object',
    [],
    { ...validOpen, id: null },
    { ...validOpen, id: 123 },
    { ...validOpen, id: 'bad-id' },
    { ...validOpen, status: 'unknown' },
    { ...validOpen, startedAt: 'invalid' },
    { ...validDone, finishedAt: 'invalid' },
    { ...validDone, exitCode: '0' },
    { ...validDone, durationMs: -10 },
    { ...validDone, finishedAt: '2026-10-22T08:00:00.000Z' },
  ]) {
    assert.equal(validateRecord(bad).valid, false);
    assert.throws(() => assertRecord(bad), { code: 'INVALID_RECORD' });
  }

  assert.throws(() => assertRecord({
    ...validOpen,
    title: 'ghp_' + 'z'.repeat(36),
  }), { code: 'SECRET_DETECTED' });
});

test('toRecord converts legacy tasks and snake_case variants', () => {
  const legacyOpen = {
    id: 't-abcdef01',
    title: 'Legacy task',
    area: 'parser',
    status: 'waiting',
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:05:00.000Z',
    notes: [{ at: '2026-10-22T09:05:00.000Z', text: 'Step 1' }],
  };
  const recordOpen = toRecord(legacyOpen);
  assert.equal(recordOpen.id, 't-abcdef01');
  assert.equal(recordOpen.startedAt, '2026-10-22T09:00:00.000Z');
  assert.equal(recordOpen.finishedAt, null);
  assert.equal(recordOpen.exitCode, null);
  assert.equal(recordOpen.durationMs, null);
  assert.equal(recordOpen.notes.length, 1);

  const legacyDone = {
    id: 't-abcdef02',
    title: 'Finished task',
    status: 'done',
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:30:00.000Z',
  };
  const recordDone = toRecord(legacyDone);
  assert.equal(recordDone.startedAt, '2026-10-22T09:00:00.000Z');
  assert.equal(recordDone.finishedAt, '2026-10-22T09:30:00.000Z');
  assert.equal(recordDone.exitCode, 0);
  assert.equal(recordDone.durationMs, 1800000);

  const legacyCancelled = {
    id: 't-abcdef03',
    status: 'cancelled',
    createdAt: '2026-10-22T09:00:00.000Z',
    updatedAt: '2026-10-22T09:15:00.000Z',
  };
  const recordCancelled = toRecord(legacyCancelled);
  assert.equal(recordCancelled.exitCode, 1);
  assert.equal(recordCancelled.durationMs, 900000);

  const snakeCase = {
    id: 't-abcdef04',
    title: 'Snake case input',
    status: 'cancelled',
    started_at: '2026-10-22T10:00:00Z',
    ended_at: '2026-10-22T10:05:00Z',
    exit_code: 130,
    duration_ms: 300000,
  };
  const recordSnake = toRecord(snakeCase);
  assert.equal(recordSnake.startedAt, '2026-10-22T10:00:00.000Z');
  assert.equal(recordSnake.finishedAt, '2026-10-22T10:05:00.000Z');
  assert.equal(recordSnake.exitCode, 130);
  assert.equal(recordSnake.durationMs, 300000);
});

test('migrateRecords handles JSON arrays, export snapshots, and JSONL event streams', () => {
  assert.deepEqual(migrateRecords(''), { migrated: 0, records: [] });
  assert.deepEqual(migrateRecords(null), { migrated: 0, records: [] });
  assert.deepEqual(migrateRecords([]), { migrated: 0, records: [] });

  const tasksArray = [
    { id: 't-11111111', title: 'Task 1', status: 'done', createdAt: '2026-10-22T09:00:00.000Z', updatedAt: '2026-10-22T09:10:00.000Z' },
    { id: 't-22222222', title: 'Task 2', status: 'open', createdAt: '2026-10-22T09:00:00.000Z', updatedAt: '2026-10-22T09:00:00.000Z' },
  ];
  const migratedFromArray = migrateRecords(tasksArray);
  assert.equal(migratedFromArray.migrated, 2);
  assert.equal(migratedFromArray.records[0].exitCode, 0);
  assert.equal(migratedFromArray.records[1].exitCode, null);

  const snapshot = {
    version: 1,
    tasks: tasksArray,
  };
  const migratedFromSnapshot = migrateRecords(JSON.stringify(snapshot));
  assert.equal(migratedFromSnapshot.migrated, 2);

  const jsonlEvents = [
    JSON.stringify({ v: 1, type: 'create', id: 't-33333333', at: '2026-10-22T09:00:00.000Z', data: { area: 'a', title: 'Stream', next: 'n', due: '2026-10-23' } }),
    JSON.stringify({ v: 1, type: 'close', id: 't-33333333', at: '2026-10-22T09:20:00.000Z', data: { status: 'done' } }),
  ].join('\n');
  const migratedFromEvents = migrateRecords(jsonlEvents);
  assert.equal(migratedFromEvents.migrated, 1);
  assert.equal(migratedFromEvents.records[0].id, 't-33333333');
  assert.equal(migratedFromEvents.records[0].startedAt, '2026-10-22T09:00:00.000Z');
  assert.equal(migratedFromEvents.records[0].finishedAt, '2026-10-22T09:20:00.000Z');
  assert.equal(migratedFromEvents.records[0].exitCode, 0);
  assert.equal(migratedFromEvents.records[0].durationMs, 1200000);

  const jsonlRecords = [
    JSON.stringify({ id: 't-44444444', title: 'Direct JSONL 1', status: 'open', startedAt: '2026-10-22T10:00:00.000Z' }),
    JSON.stringify({ id: 't-55555555', title: 'Direct JSONL 2', status: 'done', startedAt: '2026-10-22T10:00:00.000Z', finishedAt: '2026-10-22T10:10:00.000Z', exitCode: 0, durationMs: 600000 }),
  ].join('\n');
  const migratedFromRecords = migrateRecords(jsonlRecords);
  assert.equal(migratedFromRecords.migrated, 2);
  assert.equal(migratedFromRecords.records[0].id, 't-44444444');
  assert.equal(migratedFromRecords.records[1].id, 't-55555555');

  assert.throws(() => migrateRecords('{"id":"t-11111111"}\n{bad json}'), { code: 'CORRUPT_LOG' });
});

test('CLI migrate and convert migrate local store and arbitrary files', async (t) => {
  const cwd = await workspace(t);

  const emptyResult = await cli(cwd, ['migrate']);
  assert.equal(emptyResult.code, 0);
  assert.equal(emptyResult.stdout.trim(), 'No records to migrate.');

  const add1 = await cli(cwd, ['add', '--area', 'core', '--title', 'Task 1', '--next', 'Next 1', '--due', '2026-10-25', '--json']);
  const id1 = JSON.parse(add1.stdout).task.id;
  await cli(cwd, ['update', id1, '--status', 'done', '--code', '0', '--json']);

  const add2 = await cli(cwd, ['add', '--area', 'docs', '--title', 'Task 2', '--next', 'Next 2', '--due', '2026-10-26', '--json']);
  const id2 = JSON.parse(add2.stdout).task.id;

  const dryRun = await cli(cwd, ['migrate', '--dry-run', '--json']);
  assert.equal(dryRun.code, 0);
  const dryParsed = JSON.parse(dryRun.stdout);
  assert.equal(dryParsed.migrated, 2);
  assert.equal(dryParsed.dryRun, true);

  const dryText = await cli(cwd, ['migrate', '--dry-run']);
  assert.match(dryText.stdout, /Dry run: 2 records would be migrated/);

  const live = await cli(cwd, ['migrate', '--json']);
  assert.equal(live.code, 0);
  const liveParsed = JSON.parse(live.stdout);
  assert.equal(liveParsed.migrated, 2);
  assert.equal(liveParsed.dryRun, false);

  const savedRecords = (await readFile(join(cwd, '.tasklog', 'records.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(savedRecords.length, 2);

  const convertAlias = await cli(cwd, ['convert']);
  assert.match(convertAlias.stdout, /Migrated 2 records to common schema/);

  const legacyFile = join(cwd, 'legacy-tasks.json');
  await writeFile(legacyFile, JSON.stringify([
    { id: 't-99999999', title: 'File migration', status: 'done', createdAt: '2026-10-22T08:00:00.000Z', updatedAt: '2026-10-22T08:05:00.000Z' },
  ]));

  const outFile = join(cwd, 'migrated-tasks.jsonl');
  const fileMigrate = await cli(cwd, ['migrate', '--file', 'legacy-tasks.json', '--out', 'migrated-tasks.jsonl', '--json']);
  assert.equal(fileMigrate.code, 0);
  assert.equal(JSON.parse(fileMigrate.stdout).migrated, 1);

  const outLines = (await readFile(outFile, 'utf8')).trim().split('\n');
  assert.equal(outLines.length, 1);
  const parsedRecord = JSON.parse(outLines[0]);
  assert.equal(parsedRecord.id, 't-99999999');
  assert.equal(parsedRecord.exitCode, 0);
  assert.equal(parsedRecord.durationMs, 300000);

  const inPlaceFile = join(cwd, 'in-place.json');
  await writeFile(inPlaceFile, JSON.stringify([
    { id: 't-88888888', title: 'In-place', status: 'open', createdAt: '2026-10-22T09:00:00.000Z' },
  ]));
  const inPlace = await cli(cwd, ['migrate', '--file', 'in-place.json']);
  assert.match(inPlace.stdout, /Migrated 1 record to common schema/);
  const inPlaceContent = JSON.parse(await readFile(inPlaceFile, 'utf8'));
  assert.equal(inPlaceContent[0].id, 't-88888888');
  assert.equal(inPlaceContent[0].startedAt, '2026-10-22T09:00:00.000Z');

  const missing = await cli(cwd, ['migrate', '--file', 'nonexistent.json', '--json']);
  assert.equal(missing.code, 1);
  assert.equal(JSON.parse(missing.stderr).error.code, 'NOT_FOUND');
});
