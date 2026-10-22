import { assertSafe, dueDate, fail, taskStatus, textField, amountValue } from './validation.js';

function keys(object, allowed, required = allowed) {
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || Object.keys(object).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(object, key))) {
    fail('CORRUPT_LOG', 'Invalid event fields.');
  }
}

export function taskFields(input) {
  keys(input, ['area', 'title', 'next', 'due', 'ref', 'key'], ['area', 'title', 'next', 'due']);
  const result = {};
  for (const name of ['area', 'title', 'next']) result[name] = textField(input[name], name);
  result.due = dueDate(input.due);
  for (const name of ['ref', 'key']) {
    if (input[name] !== undefined) result[name] = textField(input[name], name);
  }
  return result;
}

export function changes(input) {
  keys(input, ['status', 'next', 'due'], []);
  if (!Object.keys(input).length) fail('INVALID_INPUT', 'No task changes supplied.');
  const result = {};
  if (input.status !== undefined) result.status = taskStatus(input.status);
  if (input.next !== undefined) result.next = textField(input.next, 'next');
  if (input.due !== undefined) result.due = dueDate(input.due);
  return result;
}

export function costFields(input) {
  keys(input, ['tool', 'amount', 'unit', 'note']);
  return {
    tool: textField(input.tool, 'tool'),
    amount: amountValue(input.amount),
    unit: textField(input.unit, 'unit'),
    note: textField(input.note, 'note'),
  };
}

export function replay(events) {
  const tasks = new Map();
  const idempotencyKeys = new Set();
  for (const event of events) {
    try {
      keys(event, ['v', 'type', 'id', 'at', 'data']);
      assertSafe(event);
      if (event.v !== 1 || !/^t-[0-9a-f]{8}$/.test(event.id)
        || !validTimestamp(event.at)) fail('CORRUPT_LOG', 'Invalid event envelope.');
      if (event.type === 'create') {
        if (tasks.has(event.id)) fail('CORRUPT_LOG', 'Duplicate task ID.');
        const fields = taskFields(event.data);
        if (fields.key !== undefined) {
          if (idempotencyKeys.has(fields.key)) fail('CORRUPT_LOG', 'Duplicate idempotency key.');
          idempotencyKeys.add(fields.key);
        }
        tasks.set(event.id, { id: event.id, ...fields, status: 'open', createdAt: event.at, updatedAt: event.at, notes: [] });
        continue;
      }
      const task = tasks.get(event.id);
      if (!task) fail('CORRUPT_LOG', 'Event references an unknown task.');
      if (event.type === 'update' || event.type === 'close') {
        const patch = changes(event.data);
        const terminal = ['done', 'cancelled'].includes(patch.status);
        if ((event.type === 'close') !== terminal) fail('CORRUPT_LOG', 'Invalid close event.');
        Object.assign(task, patch);
      } else if (event.type === 'note') {
        keys(event.data, ['note']);
        task.notes.push({ at: event.at, text: textField(event.data.note, 'note') });
      } else {
        fail('CORRUPT_LOG', 'Unknown event type.');
      }
      task.updatedAt = event.at;
    } catch {
      fail('CORRUPT_LOG', 'Invalid task event. Restore the log from a known-good copy; no records were skipped.');
    }
  }
  return [...tasks.values()];
}

function validTimestamp(at) {
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) && new Date(at).toISOString() === at;
}

export function replayCosts(events) {
  const ids = new Set();
  return events.map((event) => {
    try {
      keys(event, ['v', 'type', 'id', 'at', 'data']);
      assertSafe(event);
      if (event.v !== 1 || event.type !== 'cost' || !/^c-[0-9a-f]{8}$/.test(event.id)
        || ids.has(event.id) || !validTimestamp(event.at)) fail('CORRUPT_LOG', 'Invalid cost event.');
      ids.add(event.id);
      return { id: event.id, at: event.at, ...costFields(event.data) };
    } catch {
      fail('CORRUPT_LOG', 'Invalid cost event. Restore the log from a known-good copy; no records were skipped.');
    }
  });
}
