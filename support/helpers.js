import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runCLI } from '../src/cli.js';

const exec = promisify(execFile);
export const root = fileURLToPath(new URL('../', import.meta.url));
export const cliPath = join(root, 'bin', 'tasklog.js');

export async function workspace(t) {
  const base = resolve(root, 'is');
  await mkdir(base, { recursive: true });
  const path = await mkdtemp(join(base, 'test-'));
  t.after(async () => {
    if (!resolve(path).startsWith(`${base}${sep}`)) throw new Error('Unsafe test cleanup path.');
    await rm(path, { recursive: true, force: true });
  });
  return path;
}

export async function processCLI(cwd, args, options = {}) {
  try {
    const result = await exec(process.execPath, [cliPath, ...args], { cwd, ...options });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

export async function cli(cwd, args, options = {}) {
  let stdout = '';
  let stderr = '';
  const code = await runCLI(args, { cwd,
    ...options,
    write: (value) => { stdout += `${value}\n`; },
    writeError: (value) => { stderr += `${value}\n`; },
  });
  return { stdout, stderr, code };
}

export const input = { area: 'runtime', title: 'Resume parser work', next: 'Check edge cases', due: '2026-10-22' };
