export class TasklogError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TasklogError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new TasklogError(code, message);
}

// Heuristics only: deliberately never include a rejected value in an error.
const secretPatterns = [
  /\bsk-(?:proj-|ant-)?[a-zA-Z0-9_-]{16,}\b/,
  /\b(?:gh[pousr]_|github_pat_)[a-zA-Z0-9_]{20,}\b/,
  /\bglpat-[a-zA-Z0-9_-]{16,}\b/,
  /\bnpm_[a-zA-Z0-9]{30,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{16,}\b/,
  /\bpypi-[a-zA-Z0-9_-]{24,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bxox[baprs]-[a-zA-Z0-9-]{12,}\b/,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
  /\bAIza[a-zA-Z0-9_-]{30,}\b/,
  /\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}/,
  /\bBearer\s+[a-zA-Z0-9._~+/-]{12,}/i,
  /\b(?:password|passwd|api[_-]?key|client[_-]?secret|secret|(?:access[_-]?|refresh[_-]?)?token|authorization)\s*[:=]\s*["']?[^\s"']{8,}/i,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
];

export function assertSafe(value) {
  if (typeof value === 'string' && secretPatterns.some((pattern) => pattern.test(value))) {
    fail('SECRET_DETECTED', 'Input resembles a credential. Remove it before recording.');
  }
  if (Array.isArray(value)) value.forEach(assertSafe);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertSafe);
}

export function textField(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 16000) {
    fail('INVALID_INPUT', `${name} must be non-empty text (at most 16000 characters).`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail('INVALID_INPUT', `${name} contains unsupported control characters.`);
  }
  assertSafe(value);
  return value;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function dueDate(value) {
  if (!validDate(value)) fail('INVALID_DATE', 'due must be a real date in YYYY-MM-DD format.');
  return value;
}

export function localDate(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(now.getDate()).padStart(2, '0')}`;
}

// Resolve only new input; replay continues to require absolute v1 dates.
export function resolveDue(value, now = new Date()) {
  if (validDate(value)) return value;
  const relative = typeof value === 'string' && /^\+(\d+)([dw])$/.exec(value);
  const days = value === 'today' ? 0 : value === 'tomorrow' ? 1
    : relative ? Number(relative[1]) * (relative[2] === 'w' ? 7 : 1) : NaN;
  if (!Number.isSafeInteger(days)) fail('INVALID_DATE', "Option '--due' needs YYYY-MM-DD, today, tomorrow, +Nd, or +Nw.");
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + days);
  const result = localDate(date);
  if (!validDate(result)) fail('INVALID_DATE', "Option '--due' resolves outside the supported calendar.");
  return result;
}

export function microUnits(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}

export function decimalAmount(micros) {
  const whole = micros / 1000000n;
  const fraction = String(micros % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

export const statuses = ['open', 'waiting', 'done', 'cancelled'];

export function taskStatus(value) {
  if (!statuses.includes(value)) fail('INVALID_STATUS', 'status must be open, waiting, done, or cancelled.');
  return value;
}

export function amountValue(value) {
  const raw = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(raw)) {
    fail('INVALID_AMOUNT', 'amount must be a positive decimal with at most six decimal places.');
  }
  const amount = Number(raw);
  if (amount <= 0 || !Number.isSafeInteger(Math.round(amount * 1e6))) {
    fail('INVALID_AMOUNT', 'amount must be positive and fit within safe decimal precision.');
  }
  return amount;
}
