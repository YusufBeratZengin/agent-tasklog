import { resolve } from 'node:path';
import { Tasklog } from './store.js';
import { markdownBoard } from './markdown.js';
import { atomicWrite } from './output.js';
import { assertSafe, fail, TasklogError, statuses, taskStatus } from './validation.js';

const help = `tasklog 0.1.0 — append-only tasks and receipts

Usage:
  tasklog add --area TEXT --title TEXT --next TEXT --due DATE [--ref TEXT] [--key TEXT]
  tasklog update ID [--status open|waiting|done|cancelled] [--next TEXT] [--due DATE] [--note TEXT]
  tasklog show ID
  tasklog list [--today | --overdue] [--area TEXT] [--status open|waiting|done|cancelled|all | --all]
  tasklog md [--status open,waiting] [--out TASKS.md]
  tasklog resume [--json]
  tasklog cost add --tool TEXT --amount DECIMAL --unit TEXT --note TEXT
  tasklog cost list [--tool TEXT] [--unit TEXT] [--since YYYY-MM-DD]
  tasklog cost total [--unit TEXT]
  tasklog export [--json]

Global flags: --json, --help, --version
Options accept --option value or --option=value. DATE: YYYY-MM-DD, today, tomorrow, +Nd, +Nw.
list defaults to open and waiting tasks; export includes every status.
Storage is relative to the current directory: .tasklog/
`;

function distance(left, right) {
  let row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (left[i] === right[j] ? 0 : 1)));
    }
    row = next;
  }
  return row[right.length];
}

function parse(args) {
  const flags = {};
  const positional = [];
  const booleans = new Set(['json', 'help', 'version', 'today', 'overdue', 'all']);
  const values = new Set(['area', 'title', 'next', 'due', 'ref', 'key', 'status', 'note', 'tool', 'amount', 'unit', 'since', 'out']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const name = arg.slice(2, equals === -1 ? undefined : equals);
      const optionLabel = `--${name}`;
      if (!booleans.has(name) && !values.has(name)) {
        const closest = [...booleans, ...values].sort((a, b) => distance(name, a) - distance(name, b))[0];
        const hint = distance(name, closest) <= 2 ? ` Did you mean '--${closest}'?` : ' Run tasklog --help.';
        fail('USAGE', `Unknown option '${optionLabel}'.${hint}`);
      }
      if (Object.hasOwn(flags, name)) fail('USAGE', `Duplicate option '${optionLabel}'.`);
      if (booleans.has(name)) {
        if (equals !== -1) fail('USAGE', `Option '${arg}' does not accept a value.`);
        flags[name] = true;
      } else {
        const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
        if (value === undefined || value === '' || (equals === -1 && value.startsWith('--'))) {
          fail('USAGE', `Option '${optionLabel}' needs a value`);
        }
        flags[name] = value;
        if (equals === -1) index++;
      }
    } else if (arg.startsWith('-')) fail('USAGE', `Unknown option '${arg}'. Run tasklog --help.`);
    else positional.push(arg);
  }
  return { flags, positional };
}

function validate(flags, allowed, required = []) {
  for (const key of Object.keys(flags)) {
    if (![...allowed, 'json', 'help', 'version'].includes(key)) {
      fail('USAGE', `Option '--${key}' is not valid for this command. Run tasklog --help.`);
    }
  }
  for (const key of required) if (!Object.hasOwn(flags, key)) fail('USAGE', `Missing option '--${key}'.`);
}

function fields(flags) {
  return Object.fromEntries(Object.entries(flags).filter(([key]) => !['json', 'help', 'version'].includes(key)));
}

function taskText(task) {
  const lines = [`${task.id} [${task.status}] ${task.title}`, `Area: ${task.area}`, `Due: ${task.due}`, `Next: ${task.next}`];
  if (task.ref) lines.push(`Ref: ${task.ref}`);
  for (const note of task.notes) lines.push(`Checkpoint (${note.at}): ${note.text}`);
  return lines.join('\n');
}

async function main(args, { cwd, write, now }) {
  assertSafe(args);
  const { flags, positional } = parse(args);
  if (flags.help || args.length === 0) {
    write(flags.json ? JSON.stringify({ help }) : help.trimEnd());
    return;
  }
  if (flags.version) {
    write(flags.json ? JSON.stringify({ version: '0.1.0' }) : '0.1.0');
    return;
  }
  const [command, id] = positional;
  const commands = ['add', 'update', 'show', 'list', 'md', 'resume', 'cost', 'export'];
  if (!commands.includes(command)) fail('USAGE', `Unknown command '${command ?? '(missing)'}'. Run tasklog --help.`);
  const expected = ['update', 'show', 'cost'].includes(command) ? 2 : 1;
  if (positional.length > expected) fail('USAGE', `Unexpected argument '${positional[expected]}'. Run tasklog --help.`);
  if (positional.length < expected) fail('USAGE', `Command '${command}' needs ${command === 'cost' ? 'a subcommand' : 'an ID'}.`);
  const store = new Tasklog({ cwd, now });
  let result;
  let readable;
  if (command === 'add') {
    validate(flags, ['area', 'title', 'next', 'due', 'ref', 'key'], ['area', 'title', 'next', 'due']);
    const task = await store.add(fields(flags));
    result = { task }; readable = taskText(task);
  } else if (command === 'update') {
    validate(flags, ['status', 'next', 'due', 'note']);
    if (!Object.keys(fields(flags)).length) fail('USAGE', `Command 'update' needs '--status', '--next', '--due', or '--note'.`);
    const task = await store.update(id, fields(flags));
    result = { task }; readable = taskText(task);
  } else if (command === 'show') {
    validate(flags, []);
    const task = await store.show(id);
    result = { task }; readable = taskText(task);
  } else if (command === 'list') {
    validate(flags, ['today', 'overdue', 'area', 'status', 'all']);
    if (flags.all && flags.status !== undefined) fail('USAGE', "Option '--all' cannot be combined with '--status'.");
    if (flags.status !== undefined && flags.status !== 'all') taskStatus(flags.status);
    const { all, ...filters } = fields(flags);
    if (all) filters.status = 'all';
    const tasks = await store.list(filters);
    result = { tasks };
    readable = tasks.length ? tasks.map((task) => `${task.id} [${task.status}] ${task.due} ${task.area}: ${task.title}\n  Next: ${task.next}`).join('\n') : 'No tasks.';
  } else if (command === 'md') {
    validate(flags, ['status', 'out']);
    const selected = flags.status === undefined ? statuses : flags.status.split(',').map(taskStatus);
    readable = markdownBoard(await store.list({ status: 'all' }), [...new Set(selected)]);
    if (flags.out !== undefined) await atomicWrite(resolve(cwd, flags.out), readable);
    result = { markdown: readable };
  } else if (command === 'resume') {
    validate(flags, []);
    const task = await store.resume();
    result = { task }; readable = task ? taskText(task) : 'No active task.';
  } else if (command === 'cost' && id === 'add') {
    validate(flags, ['tool', 'amount', 'unit', 'note'], ['tool', 'amount', 'unit', 'note']);
    const entry = await store.addCost(fields(flags));
    result = { entry }; readable = `${entry.id} ${entry.tool}: ${entry.amount} ${entry.unit}\n${entry.note}`;
  } else if (command === 'cost' && id === 'list') {
    validate(flags, ['tool', 'unit', 'since']);
    const entries = await store.listCosts(fields(flags));
    result = { entries };
    readable = entries.length ? entries.map((entry) => `${entry.id} ${entry.at} ${entry.tool}: ${entry.amount} ${entry.unit}\n  ${entry.note}`).join('\n') : 'No costs.';
  } else if (command === 'cost' && id === 'total') {
    validate(flags, ['unit']);
    const totals = await store.totalCosts(fields(flags));
    result = { totals };
    readable = totals.length ? totals.map((entry) => `${entry.tool}: ${entry.amount} ${entry.unit}`).join('\n') : 'No costs.';
  } else if (command === 'export') {
    validate(flags, []);
    result = await store.export();
  } else fail('USAGE', `Unknown subcommand '${id}' for 'cost'. Run tasklog --help.`);
  write(flags.json || command === 'export' ? JSON.stringify(result) : readable);
}

function testClock() {
  if (process.env.TASKLOG_NOW === undefined) return new Date();
  const date = new Date(process.env.TASKLOG_NOW);
  if (!Number.isFinite(date.getTime())) fail('INVALID_DATE', 'TASKLOG_NOW must be a valid test timestamp.');
  return date;
}

export async function runCLI(args, { cwd = process.cwd(), write = console.log, writeError = console.error, now = testClock } = {}) {
  try {
    await main(args, { cwd, write, now });
    return 0;
  } catch (error) {
    const known = error instanceof TasklogError;
    const code = known ? error.code : 'IO_ERROR';
    const message = known ? error.message : 'Cannot access the log. Check filesystem permissions and available disk space.';
    writeError(args.includes('--json') ? JSON.stringify({ error: { code, message } }) : `tasklog: ${message} (${code})`);
    return 1;
  }
}
