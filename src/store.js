import { mkdir, readFile, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { withLock } from './lock.js';
import { replay, replayCosts, taskFields, changes, costFields } from './replay.js';
import { fail, textField, localDate, resolveDue, taskStatus, validDate, microUnits, decimalAmount } from './validation.js';

async function readEvents(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (!raw) return [];
  if (!raw.endsWith('\n')) fail('CORRUPT_LOG', 'Log has an incomplete final line. Restore it before continuing.');
  return raw.slice(0, -1).split('\n').map((line, index) => {
    try { return JSON.parse(line); } catch {
      fail('CORRUPT_LOG', `Invalid JSON at line ${index + 1}. No records were skipped.`);
    }
  });
}

async function append(path, events) {
  const handle = await open(path, 'a', 0o600);
  try {
    await handle.writeFile(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
    await handle.sync();
  } finally { await handle.close(); }
}

function newId(prefix, existing) {
  let id;
  do { id = `${prefix}-${randomBytes(4).toString('hex')}`; } while (existing.some((item) => item.id === id));
  return id;
}

export function filterTasks(tasks, { today = false, overdue = false, area, status = 'all' } = {}, now = new Date()) {
  if (today && overdue) fail('INVALID_INPUT', '--today and --overdue cannot be combined.');
  const selected = status === 'all' ? undefined : status.split(',').map(taskStatus);
  const date = localDate(now);
  return tasks.filter((task) => (area === undefined || task.area === area)
    && (!selected || selected.includes(task.status))
    && (!(today || overdue) || ['open', 'waiting'].includes(task.status))
    && (!today || task.due === date)
    && (!overdue || task.due < date))
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}

export class Tasklog {
  constructor({ cwd = process.cwd(), now = () => new Date(), lockOptions } = {}) {
    this.directory = resolve(cwd, '.tasklog');
    this.now = now;
    this.lockOptions = lockOptions;
  }

  async transaction(action) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return withLock(join(this.directory, 'write.lock'), async () => {
      const events = await readEvents(join(this.directory, 'tasks.jsonl'));
      const costEvents = await readEvents(join(this.directory, 'costs.jsonl'));
      return action({ events, costEvents, tasks: replay(events), costs: replayCosts(costEvents) });
    }, this.lockOptions);
  }

  async add(input) {
    const data = taskFields({ ...input, due: resolveDue(input.due, this.now()) });
    return this.transaction(async ({ events, tasks }) => {
      if (data.key !== undefined) {
        const previous = events.find((event) => event.type === 'create' && event.data.key === data.key);
        if (previous) {
          const same = Object.keys(data).length === Object.keys(previous.data).length
            && Object.entries(data).every(([key, value]) => previous.data[key] === value);
          if (!same) fail('KEY_CONFLICT', 'This key already belongs to a task created with different fields.');
          return tasks.find((task) => task.id === previous.id);
        }
      }
      const event = { v: 1, type: 'create', id: newId('t', tasks), at: this.now().toISOString(), data };
      await append(join(this.directory, 'tasks.jsonl'), [event]);
      return replay([...events, event]).at(-1);
    });
  }

  async update(id, input) {
    const { note, ...fields } = input;
    if (fields.due !== undefined) fields.due = resolveDue(fields.due, this.now());
    const patch = Object.keys(fields).length ? changes(fields) : undefined;
    if (note !== undefined) textField(note, 'note');
    if (!patch && note === undefined) fail('INVALID_INPUT', 'Supply --status, --next, --due, or --note.');
    return this.transaction(async ({ events, tasks }) => {
      if (!tasks.some((task) => task.id === id)) fail('NOT_FOUND', 'Task not found.');
      const at = this.now().toISOString();
      const added = [];
      if (patch) added.push({ v: 1, type: ['done', 'cancelled'].includes(patch.status) ? 'close' : 'update', id, at, data: patch });
      if (note !== undefined) added.push({ v: 1, type: 'note', id, at, data: { note } });
      await append(join(this.directory, 'tasks.jsonl'), added);
      return replay([...events, ...added]).find((task) => task.id === id);
    });
  }

  async show(id) {
    return this.transaction(({ tasks }) => {
      const task = tasks.find((item) => item.id === id);
      if (!task) fail('NOT_FOUND', 'Task not found.');
      return task;
    });
  }

  async list(filters = {}) {
    if (filters.today && filters.overdue) fail('INVALID_INPUT', '--today and --overdue cannot be combined.');
    return this.transaction(({ tasks }) => filterTasks(tasks, { status: 'open,waiting', ...filters }, this.now()));
  }

  async resume() {
    return this.transaction(({ tasks }) => {
      const task = tasks.filter((item) => ['open', 'waiting'].includes(item.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
      return task ? { ...task, notes: task.notes.slice(-3) } : null;
    });
  }

  async listCosts({ tool, unit, since } = {}) {
    if (since !== undefined && !validDate(since)) fail('INVALID_DATE', "Option '--since' needs a real YYYY-MM-DD date.");
    return this.transaction(({ costs }) => costs.filter((entry) => (tool === undefined || entry.tool === tool)
      && (unit === undefined || entry.unit === unit)
      && (since === undefined || entry.at.slice(0, 10) >= since)));
  }

  async totalCosts({ unit } = {}) {
    const costs = await this.listCosts({ unit });
    const groups = new Map();
    for (const entry of costs) {
      const key = JSON.stringify([entry.tool, entry.unit]);
      const group = groups.get(key) ?? { tool: entry.tool, unit: entry.unit, micros: 0n };
      // v1 stores numeric amounts. Normalize them back to six decimal places.
      group.micros += microUnits(entry.amount.toFixed(6));
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.tool.localeCompare(b.tool) || a.unit.localeCompare(b.unit))
      .map(({ tool, unit: label, micros }) => ({ tool, unit: label, amount: decimalAmount(micros) }));
  }

  async addCost(input) {
    const data = costFields(input);
    return this.transaction(async ({ costs }) => {
      const event = { v: 1, type: 'cost', id: newId('c', costs), at: this.now().toISOString(), data };
      await append(join(this.directory, 'costs.jsonl'), [event]);
      return replayCosts([event])[0];
    });
  }

  async export() {
    return this.transaction(({ events, costEvents, tasks, costs }) => ({
      version: 1, tasks: filterTasks(tasks), costs, events, costEvents,
    }));
  }
}
