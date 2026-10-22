import { Tasklog } from './store.js';
import { markdownBoard } from './markdown.js';
import { assertSafe, fail, TasklogError } from './validation.js';

const help = `tasklog 0.1.0 — append-only tasks and receipts

Usage:
  tasklog add --area TEXT --title TEXT --next TEXT --due YYYY-MM-DD [--ref TEXT] [--key TEXT]
  tasklog update ID [--status open|waiting|done|cancelled] [--next TEXT] [--due YYYY-MM-DD] [--note TEXT]
  tasklog show ID
  tasklog list [--today | --overdue] [--area TEXT]
  tasklog md
  tasklog cost add --tool TEXT --amount DECIMAL --unit TEXT --note TEXT
  tasklog export [--json]

Global flags: --json, --help, --version
Storage is relative to the current directory: .tasklog/
`;

function parse(args) {
  const flags = {};
  const positional = [];
  const booleans = new Set(['json', 'help', 'version', 'today', 'overdue']);
  const values = new Set(['area', 'title', 'next', 'due', 'ref', 'key', 'status', 'note', 'tool', 'amount', 'unit']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!booleans.has(name) && !values.has(name)) fail('USAGE', 'Unknown option. Run tasklog --help.');
      if (Object.hasOwn(flags, name)) fail('USAGE', 'Duplicate option.');
      if (booleans.has(name)) flags[name] = true;
      else {
        if (args[index + 1] === undefined || args[index + 1].startsWith('--')) fail('USAGE', `--${name} needs a value.`);
        flags[name] = args[++index];
      }
    } else positional.push(arg);
  }
  return { flags, positional };
}

function validate(flags, allowed, required = []) {
  if (Object.keys(flags).some((key) => ![...allowed, 'json', 'help', 'version'].includes(key))) {
    fail('USAGE', 'Option is not valid for this command. Run tasklog --help.');
  }
  for (const key of required) if (!Object.hasOwn(flags, key)) fail('USAGE', `Missing --${key}.`);
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

async function main(args, { cwd, write }) {
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
  const expected = ['update', 'show', 'cost'].includes(command) ? 2 : 1;
  if (positional.length !== expected) fail('USAGE', 'Unexpected or missing command argument. Run tasklog --help.');
  const store = new Tasklog({ cwd });
  let result;
  let readable;
  if (command === 'add') {
    validate(flags, ['area', 'title', 'next', 'due', 'ref', 'key'], ['area', 'title', 'next', 'due']);
    const task = await store.add(fields(flags));
    result = { task }; readable = taskText(task);
  } else if (command === 'update') {
    validate(flags, ['status', 'next', 'due', 'note']);
    const task = await store.update(id, fields(flags));
    result = { task }; readable = taskText(task);
  } else if (command === 'show') {
    validate(flags, []);
    const task = await store.show(id);
    result = { task }; readable = taskText(task);
  } else if (command === 'list') {
    validate(flags, ['today', 'overdue', 'area']);
    const tasks = await store.list(fields(flags));
    result = { tasks };
    readable = tasks.length ? tasks.map((task) => `${task.id} [${task.status}] ${task.due} ${task.area}: ${task.title}\n  Next: ${task.next}`).join('\n') : 'No tasks.';
  } else if (command === 'md') {
    validate(flags, []);
    readable = markdownBoard(await store.list());
    result = { markdown: readable };
  } else if (command === 'cost' && id === 'add') {
    validate(flags, ['tool', 'amount', 'unit', 'note'], ['tool', 'amount', 'unit', 'note']);
    const entry = await store.addCost(fields(flags));
    result = { entry }; readable = `${entry.id} ${entry.tool}: ${entry.amount} ${entry.unit}\n${entry.note}`;
  } else if (command === 'export') {
    validate(flags, []);
    result = await store.export();
  } else fail('USAGE', 'Unknown command. Run tasklog --help.');
  write(flags.json || command === 'export' ? JSON.stringify(result) : readable);
}

export async function runCLI(args, { cwd = process.cwd(), write = console.log, writeError = console.error } = {}) {
  try {
    await main(args, { cwd, write });
    return 0;
  } catch (error) {
    const known = error instanceof TasklogError;
    const code = known ? error.code : 'IO_ERROR';
    const message = known ? error.message : 'Cannot access the log. Check filesystem permissions and available disk space.';
    writeError(args.includes('--json') ? JSON.stringify({ error: { code, message } }) : `tasklog: ${message} (${code})`);
    return 1;
  }
}

