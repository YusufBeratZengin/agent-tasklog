# Changelog

All notable changes are documented here using [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Package author, public publish configuration with provenance, and eight discovery keywords.
- Tag-triggered release workflow using npm trusted publishing, version matching, and release instructions.
- Both value-option syntaxes, named usage errors, and edit-distance option suggestions.
- Cost listing with tool/unit/date filters and exact totals per tool/unit using integer micro-units.
- Markdown status selection and atomic file output with temporary-file cleanup.
- Resume command selecting the latest active task with its next action, due date and last three checkpoints.
- Local-calendar relative due dates and the test-only TASKLOG_NOW clock override.
- JavaScript syntax and README/help command checks, including a negative lint regression test.
- Real CLI transcript, CI/license badges, agent session timeline and synchronized Turkish documentation.
- Eight-process, 200-event stress proof and dead-PID/foreign-host lock regression tests.
- Issue forms, PR template, Contributor Covenant 2.1, Dependabot and replay-tested synthetic examples.

### Changed

- **Behavior change:** list defaults to open and waiting tasks. Use --all or --status all for the previous view; export retains every status.
- Markdown boards skip empty status sections and show _None_ when no task matches.
- CI covers Node 20, 22 and 24 on Windows and Ubuntu, including package dry runs.

## 0.1.0 — 2026-10-22

- Add an ESM `tasklog` CLI for Node.js 20 and later, without dependencies.
- Store append-only task events and spend receipts in project-local JSONL files.
- Replay task state, checkpoint history, and idempotent creation keys on read.
- Support status changes, local-date filters, Markdown boards, and JSON export.
- Coordinate readers and writers with ownership-aware locking and stale-lock detection.
- Refuse common credential patterns and reject corrupt histories without silent repair.
- Include English and Turkish documentation, agent instruction snippets, and Windows/Ubuntu CI for Node.js 20 and 24.
