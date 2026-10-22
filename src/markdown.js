import { statuses } from './validation.js';

function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\\/g, '&#92;').replace(/\|/g, '&#124;').replace(/`/g, '&#96;')
    .replace(/\*/g, '&#42;').replace(/_/g, '&#95;').replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

export function markdownBoard(tasks, selected = statuses) {
  const lines = ['# Task board', ''];
  for (const status of selected) {
    const matching = tasks.filter((item) => item.status === status);
    if (!matching.length) continue;
    lines.push(`## ${status[0].toUpperCase()}${status.slice(1)}`, '',
      '| ID | Area | Title | Due | Next action | Reference | Latest checkpoint |',
      '| --- | --- | --- | --- | --- | --- | --- |');
    for (const task of matching) {
      lines.push(`| ${[task.id, task.area, task.title, task.due, task.next, task.ref ?? '', task.notes.at(-1)?.text ?? ''].map(escape).join(' | ')} |`);
    }
    lines.push('');
  }
  if (lines.length === 2) lines.push('_None_', '');
  return lines.join('\n');
}
