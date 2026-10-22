# Changelog

## 0.1.0 — 2026-10-22

- Add an ESM `tasklog` CLI for Node.js 20 and later, without dependencies.
- Store append-only task events and spend receipts in project-local JSONL files.
- Replay task state, checkpoint history, and idempotent creation keys on read.
- Support status changes, local-date filters, Markdown boards, and JSON export.
- Coordinate readers and writers with ownership-aware locking and stale-lock detection.
- Refuse common credential patterns and reject corrupt histories without silent repair.
- Include English and Turkish documentation, agent instruction snippets, and Windows/Ubuntu CI for Node.js 20 and 24.
