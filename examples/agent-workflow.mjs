#!/usr/bin/env node

/**
 * Example demonstrating a complete AI coding agent lifecycle using agent-tasklog.
 *
 * This script runs against an isolated temporary directory (or an optional path
 * passed as the first argument) and performs every stage of an agent session:
 * 1. Resume check at session start
 * 2. Idempotent task creation
 * 3. Interim checkpoint recording
 * 4. Tool spend receipts
 * 5. Markdown board generation
 * 6. Task completion
 * 7. Receipt aggregation and JSON export
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const projectRoot = new URL('../', import.meta.url);
const { fileURLToPath } = await import('node:url');
const cliPath = join(fileURLToPath(projectRoot), 'bin', 'tasklog.js');

const customTarget = process.argv[2];
const isManagedTemp = !customTarget;
const targetDir = customTarget || mkdtempSync(join(tmpdir(), 'tasklog-demo-'));

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: targetDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`tasklog ${args.join(' ')} failed (code ${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

console.log(`Working directory: ${targetDir}\n`);

try {
  // Step 1: Session start - check for any unfinished work
  console.log('1. Checking for existing active task...');
  const resumeRaw = run(['resume', '--json']);
  const initialResume = JSON.parse(resumeRaw);
  console.log(initialResume.task ? `Active task: ${initialResume.task.id}` : 'No active task found; ready for new work.');
  console.log();

  // Step 2: Create a task with a stable idempotency key
  console.log('2. Creating a new task with an idempotency key...');
  const addOutput = run([
    'add',
    '--area', 'parser',
    '--title', 'Add JSON stream parser',
    '--next', 'Implement token scanner',
    '--due', 'tomorrow',
    '--key', 'stream-parser-init',
    '--json',
  ]);
  const created = JSON.parse(addOutput).task;
  console.log(`Created: ${created.id} [${created.status}] ${created.title} (due: ${created.due})`);
  console.log();

  // Step 3: Record an interim checkpoint and updated next action
  console.log('3. Recording progress checkpoint...');
  const checkpointOutput = run([
    'update', created.id,
    '--note', 'Token scanner completed; 12 unit tests pass',
    '--next', 'Implement stream buffering and backpressure',
    '--json',
  ]);
  const updated = JSON.parse(checkpointOutput).task;
  console.log(`Updated next action: ${updated.next}`);
  console.log(`Latest checkpoint: ${updated.notes[updated.notes.length - 1].text}`);
  console.log();

  // Step 4: Record a spend receipt for tool invocation
  console.log('4. Logging spend receipt...');
  const costOutput = run([
    'cost', 'add',
    '--tool', 'test-runner',
    '--amount', '0.05',
    '--unit', 'credits',
    '--note', 'Ran test suite in isolated container',
    '--json',
  ]);
  const receipt = JSON.parse(costOutput).entry;
  console.log(`Receipt ${receipt.id}: ${receipt.amount} ${receipt.unit} (${receipt.tool})`);
  console.log();

  // Step 5: Export a Markdown board
  console.log('5. Generating Markdown task board...');
  const boardOut = join(targetDir, 'TASKS.md');
  run(['md', '--out', 'TASKS.md']);
  console.log(`Wrote board to TASKS.md (exists: ${existsSync(boardOut)})`);
  console.log();

  // Step 6: Mark task as verified and complete
  console.log('6. Completing the task...');
  const doneOutput = run([
    'update', created.id,
    '--status', 'done',
    '--note', 'Stream parser implementation verified against 24 fixtures',
    '--json',
  ]);
  const finished = JSON.parse(doneOutput).task;
  console.log(`Task status: ${finished.status}`);
  console.log();

  // Step 7: Check aggregated spend totals
  console.log('7. Aggregated spend totals:');
  const totalsOutput = run(['cost', 'total', '--json']);
  const totals = JSON.parse(totalsOutput).totals;
  for (const item of totals) {
    console.log(`- ${item.tool}: ${item.amount} ${item.unit}`);
  }
  console.log();

  // Step 8: Full audit log export
  console.log('8. Complete audit snapshot:');
  const exportOutput = run(['export', '--json']);
  const snapshot = JSON.parse(exportOutput);
  console.log(`Tasks: ${snapshot.tasks.length}, Events: ${snapshot.events.length}, Costs: ${snapshot.costs.length}`);
  console.log('\nAgent workflow completed successfully.');
} finally {
  if (isManagedTemp) {
    rmSync(targetDir, { recursive: true, force: true });
  }
}
