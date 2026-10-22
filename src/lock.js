import { open, readFile, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from './validation.js';

const host = hostname();

// Windows can return EPERM for a file that is already pending deletion while
// another contender closes a read handle. Treat that as bounded contention.
function sharingRace(error) {
  return process.platform === 'win32' && error.code === 'EPERM';
}

async function unlinkOwned(path) {
  const deadline = Date.now() + 500;
  while (true) {
    try { await unlink(path); return; } catch (error) {
      if (error.code === 'ENOENT') return;
      if (!sharingRace(error) || Date.now() >= deadline) throw error;
      await delay(5);
    }
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function removeIfOwned(path, ownerId) {
  const deadline = Date.now() + 500;
  while (true) {
    try {
      const owner = JSON.parse(await readFile(path, 'utf8'));
      if (owner.ownerId === ownerId) await unlinkOwned(path);
      return;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return;
      if (!sharingRace(error) || Date.now() >= deadline) throw error;
      await delay(5);
    }
  }
}

async function reap(path, staleMs) {
  // Only one contender can inspect/remove a stale lock at a time. Acquirers
  // check this gate again after creating the main lock, before entering it.
  const gate = `${path}.reclaim`;
  let handle;
  try {
    handle = await open(gate, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST' || sharingRace(error)) return;
    throw error;
  }
  try {
    let raw;
    let info;
    try {
      raw = await readFile(path, 'utf8');
      info = await stat(path);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    let owner;
    try { owner = JSON.parse(raw); } catch { /* A crashed initial write can be empty. */ }
    const localOwner = owner?.host === host && Number.isSafeInteger(owner?.pid) && owner.pid > 0;
    if (localOwner && alive(owner.pid)) return;
    // Foreign-host locks are never automatically removed: PID liveness cannot
    // be established. Shared/network filesystems are outside this lock model.
    if (owner?.host && owner.host !== host) return;
    if (!localOwner && Date.now() - info.mtimeMs < staleMs) return;
    if (await readFile(path, 'utf8') === raw) await unlinkOwned(path);
  } catch (error) {
    if (error.code !== 'ENOENT' && !sharingRace(error)) throw error;
  } finally {
    await handle.close();
    await unlinkOwned(gate);
  }
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    if (sharingRace(error)) return true;
    throw error;
  }
}

async function owns(path, ownerId) {
  try { return JSON.parse(await readFile(path, 'utf8')).ownerId === ownerId; } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError || sharingRace(error)) return false;
    throw error;
  }
}

export async function withLock(path, action, { timeoutMs = 5000, staleMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const ownerId = randomUUID();
  while (true) {
    let handle;
    if (!await exists(`${path}.reclaim`)) {
      try { handle = await open(path, 'wx', 0o600); } catch (error) {
        if (error.code !== 'EEXIST' && !sharingRace(error)) throw error;
      }
    }
    if (handle) {
      try {
        await handle.writeFile(JSON.stringify({ ownerId, pid: process.pid, host }));
      } catch (error) {
        await handle.close();
        await unlinkOwned(path);
        throw error;
      }
      await handle.close();
      if (await exists(`${path}.reclaim`) || !await owns(path, ownerId)) {
        await removeIfOwned(path, ownerId);
      } else {
        try { return await action(); } finally { await removeIfOwned(path, ownerId); }
      }
    } else if (!await exists(`${path}.reclaim`)) {
      await reap(path, staleMs);
    }
    if (Date.now() >= deadline) {
      fail('LOCK_TIMEOUT', 'Log is locked. Retry later; inspect .tasklog/write.lock and write.lock.reclaim if this persists.');
    }
    await delay(10 + Math.floor(Math.random() * 20));
  }
}
