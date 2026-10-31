import { assertSafe, fail, statuses, textField, dueDate } from './validation.js';
import { replay } from './replay.js';

export const RECORD_SCHEMA_VERSION = 2;

export const RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/YusufBeratZengin/agent-tasklog/schemas/record.json',
  title: 'TasklogRecord',
  description: 'Common record schema for tasks and execution runs including start, finish, exit code, and duration.',
  type: 'object',
  required: ['id', 'status', 'startedAt'],
  properties: {
    id: {
      type: 'string',
      pattern: '^t-[0-9a-f]{8}$',
      description: 'Unique task or record identifier',
    },
    title: {
      type: 'string',
      description: 'Task or record title/goal',
    },
    area: {
      type: 'string',
      description: 'Component, module, or area of work',
    },
    status: {
      type: 'string',
      enum: ['open', 'waiting', 'done', 'cancelled'],
      description: 'Current status of the task or record',
    },
    startedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Start timestamp in ISO-8601 UTC format (başlatma)',
    },
    finishedAt: {
      type: ['string', 'null'],
      format: 'date-time',
      description: 'Finish timestamp in ISO-8601 UTC format, or null if active (bitiş)',
    },
    exitCode: {
      type: ['integer', 'null'],
      description: 'Exit code: 0 for success, non-zero for failure/cancellation, or null if active (çıkış kodu)',
    },
    durationMs: {
      type: ['integer', 'null'],
      minimum: 0,
      description: 'Total duration in milliseconds between start and finish, or null if active (süre)',
    },
    due: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Due date in YYYY-MM-DD format',
    },
    next: {
      type: 'string',
      description: 'Next concrete action',
    },
    ref: {
      type: 'string',
      description: 'Optional external reference',
    },
    key: {
      type: 'string',
      description: 'Optional idempotency key',
    },
    notes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['at', 'text'],
        properties: {
          at: { type: 'string', format: 'date-time' },
          text: { type: 'string' },
        },
      },
      description: 'List of timestamped checkpoint notes',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Initial creation timestamp in ISO-8601 UTC format',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Last update timestamp in ISO-8601 UTC format',
    },
  },
};

export function isValidTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString() === value;
}

export function normalizeTimestamp(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

export function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['Record must be a JSON object.'] };
  }
  if (!record.id || typeof record.id !== 'string') {
    errors.push("Missing or invalid 'id'.");
  } else if (!/^t-[0-9a-f]{8}$/.test(record.id)) {
    errors.push(`Record 'id' must match pattern ^t-[0-9a-f]{8}$, got '${record.id}'.`);
  }
  if (!statuses.includes(record.status)) {
    errors.push(`Invalid 'status': '${record.status}'. Expected open, waiting, done, or cancelled.`);
  }
  if (!isValidTimestamp(record.startedAt)) {
    errors.push(`Invalid 'startedAt': '${record.startedAt}'. Must be ISO-8601 UTC timestamp.`);
  }
  if (record.finishedAt !== null && record.finishedAt !== undefined && !isValidTimestamp(record.finishedAt)) {
    errors.push(`Invalid 'finishedAt': '${record.finishedAt}'. Must be ISO-8601 UTC timestamp or null.`);
  }
  if (record.exitCode !== null && record.exitCode !== undefined && !Number.isInteger(record.exitCode)) {
    errors.push(`Invalid 'exitCode': '${record.exitCode}'. Must be an integer or null.`);
  }
  if (record.durationMs !== null && record.durationMs !== undefined) {
    if (!Number.isInteger(record.durationMs) || record.durationMs < 0) {
      errors.push(`Invalid 'durationMs': '${record.durationMs}'. Must be a non-negative integer or null.`);
    }
  }
  if (record.startedAt && record.finishedAt) {
    const startMs = Date.parse(record.startedAt);
    const finishMs = Date.parse(record.finishedAt);
    if (finishMs < startMs) {
      errors.push(`'finishedAt' (${record.finishedAt}) cannot precede 'startedAt' (${record.startedAt}).`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertRecord(record) {
  const { valid, errors } = validateRecord(record);
  if (!valid) fail('INVALID_RECORD', errors.join(' '));
  assertSafe(record);
}

export function toRecord(input) {
  if (!input || typeof input !== 'object') fail('INVALID_INPUT', 'Record must be an object.');
  const raw = { ...input };

  const id = raw.id ?? (raw.key ? `t-${raw.key.slice(0, 8)}` : undefined);
  if (!id || typeof id !== 'string') fail('INVALID_INPUT', "Missing record 'id'.");

  const status = raw.status ?? 'open';
  if (!statuses.includes(status)) fail('INVALID_STATUS', `Invalid status '${status}'.`);

  const rawStarted = raw.startedAt ?? raw.started_at ?? raw.started ?? raw.start
    ?? raw.createdAt ?? raw.at ?? new Date().toISOString();
  const startedAt = normalizeTimestamp(rawStarted);
  if (!startedAt) fail('INVALID_DATE', `Invalid start timestamp '${rawStarted}'.`);

  let rawFinished = raw.finishedAt ?? raw.finished_at ?? raw.finished ?? raw.ended_at ?? raw.ended ?? null;
  if (rawFinished === undefined) rawFinished = null;
  if (rawFinished === null && ['done', 'cancelled'].includes(status)) {
    rawFinished = raw.updatedAt ?? raw.at ?? startedAt;
  }
  let finishedAt = null;
  if (rawFinished !== null) {
    finishedAt = normalizeTimestamp(rawFinished);
    if (!finishedAt) fail('INVALID_DATE', `Invalid finish timestamp '${rawFinished}'.`);
  }

  let exitCode = raw.exitCode ?? raw.exit_code ?? raw.code ?? raw.status_code ?? null;
  if (exitCode !== null && exitCode !== undefined) {
    const codeNum = Number(exitCode);
    if (!Number.isInteger(codeNum)) fail('INVALID_INPUT', `Exit code must be an integer, got '${exitCode}'.`);
    exitCode = codeNum;
  } else if (status === 'done') {
    exitCode = 0;
  } else if (status === 'cancelled') {
    exitCode = 1;
  } else {
    exitCode = null;
  }

  let durationMs = raw.durationMs ?? raw.duration_ms ?? raw.duration ?? raw.elapsed ?? raw.elapsed_ms ?? null;
  if (durationMs !== null && durationMs !== undefined) {
    const durNum = Number(durationMs);
    if (!Number.isInteger(durNum) || durNum < 0) fail('INVALID_INPUT', `Duration must be non-negative integer ms, got '${durationMs}'.`);
    durationMs = durNum;
  } else if (startedAt && finishedAt) {
    durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  } else {
    durationMs = null;
  }

  const record = {
    id,
    title: raw.title ? textField(raw.title, 'title') : 'Untitled task',
    area: raw.area ? textField(raw.area, 'area') : 'general',
    status,
    startedAt,
    finishedAt,
    exitCode,
    durationMs,
    ...(raw.due ? { due: dueDate(raw.due) } : {}),
    ...(raw.next ? { next: textField(raw.next, 'next') } : {}),
    ...(raw.ref ? { ref: textField(raw.ref, 'ref') } : {}),
    ...(raw.key ? { key: textField(raw.key, 'key') } : {}),
    notes: Array.isArray(raw.notes) ? raw.notes.map((n) => ({
      at: normalizeTimestamp(n.at) ?? startedAt,
      text: textField(typeof n === 'string' ? n : n.text, 'note'),
    })) : [],
    createdAt: normalizeTimestamp(raw.createdAt) ?? startedAt,
    updatedAt: normalizeTimestamp(raw.updatedAt) ?? (finishedAt ?? startedAt),
  };

  assertRecord(record);
  return record;
}

export function migrateRecords(source) {
  if (source === undefined || source === null) return { migrated: 0, records: [] };

  if (Array.isArray(source)) {
    const records = source.map((item) => toRecord(item));
    return { migrated: records.length, records };
  }

  if (typeof source === 'object') {
    if (Array.isArray(source.records)) return migrateRecords(source.records);
    if (Array.isArray(source.tasks)) return migrateRecords(source.tasks);
    if (Array.isArray(source.events)) return migrateRecords(replay(source.events));
    return { migrated: 1, records: [toRecord(source)] };
  }

  if (typeof source !== 'string') fail('INVALID_INPUT', 'Input must be a string, array, or object.');
  const text = source.trim();
  if (!text) return { migrated: 0, records: [] };

  try {
    const parsed = JSON.parse(text);
    return migrateRecords(parsed);
  } catch {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return { migrated: 0, records: [] };
    const items = lines.map((line, idx) => {
      try { return JSON.parse(line); } catch {
        fail('CORRUPT_LOG', `Invalid JSON at line ${idx + 1}.`);
      }
    });

    if (items.length && items[0].v === 1 && typeof items[0].type === 'string') {
      const tasks = replay(items);
      const records = tasks.map((task) => toRecord(task));
      return { migrated: records.length, records };
    }

    const records = items.map((item) => toRecord(item));
    return { migrated: records.length, records };
  }
}
