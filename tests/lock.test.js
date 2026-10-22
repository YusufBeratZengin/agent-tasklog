import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, utimes, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { withLock } from '../src/lock.js';
import { workspace } from '../support/helpers.js';

test('competing critical sections never overlap and failures release locks', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  let active = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 12 }, () => withLock(path, async () => {
    active++;
    assert.equal(active, 1);
    await delay(5);
    completed++;
    active--;
  })));
  assert.equal(completed, 12);
  await assert.rejects(withLock(path, async () => { throw new Error('action failed'); }), /action failed/);
  assert.deepEqual(await readdir(cwd), []);
  assert.equal(await withLock(path, () => 42), 42);
});

test('a dead local process lock is reclaimed without waiting for the age threshold', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  const pid = 2147483647;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await writeFile(path, JSON.stringify({ pid, host: hostname(), ownerId: 'crashed-owner' }));
  assert.equal(await withLock(path, () => 'recovered', { timeoutMs: 1000 }), 'recovered');
  assert.deepEqual(await readdir(cwd), []);
});

test('a malformed stale lock is reclaimed but a fresh one is protected', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  await writeFile(path, '');
  await assert.rejects(withLock(path, () => assert.fail('must not enter'), { timeoutMs: 40 }), { code: 'LOCK_TIMEOUT' });
  const old = new Date(Date.now() - 120000);
  await utimes(path, old, old);
  assert.equal(await withLock(path, () => 'recovered', { timeoutMs: 500 }), 'recovered');
});

test('contenders reclaim one abandoned lock without overlapping critical sections', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  await writeFile(path, '');
  const old = new Date(Date.now() - 120000);
  await utimes(path, old, old);
  let active = 0;
  let complete = 0;
  await Promise.all(Array.from({ length: 20 }, () => withLock(path, async () => {
    assert.equal(++active, 1);
    await delay(2);
    complete++;
    active--;
  })));
  assert.equal(complete, 20);
  assert.deepEqual(await readdir(cwd), []);
});

test('live owner is never evicted due to age, and foreign-host ownership fails closed', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  const old = new Date(Date.now() - 120000);
  for (const host of [hostname(), `${hostname()}-another-host`]) {
    const owner = JSON.stringify({ pid: process.pid, host, ownerId: 'keep-owner' });
    await writeFile(path, owner);
    await utimes(path, old, old);
    await assert.rejects(withLock(path, () => assert.fail('must not enter'), { timeoutMs: 40 }), { code: 'LOCK_TIMEOUT' });
    assert.equal(await readFile(path, 'utf8'), owner);
  }
});

test('release never deletes another owner and orphaned reclaim gates fail closed', async (t) => {
  const cwd = await workspace(t);
  const path = join(cwd, 'write.lock');
  await withLock(path, () => writeFile(path, JSON.stringify({ ownerId: 'replacement-owner' })));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).ownerId, 'replacement-owner');
  await writeFile(`${path}.reclaim`, '');
  await assert.rejects(withLock(path, () => assert.fail('must not enter'), { timeoutMs: 40 }), { code: 'LOCK_TIMEOUT' });
  assert.equal(JSON.parse(await readFile(path, 'utf8')).ownerId, 'replacement-owner');
});
