# Changelog

All notable changes are documented here using [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Turkish agent prompt snippet fixture (`examples/AGENTS.snippet.tr.md`) matching the Turkish README.
- Cross-platform Node.js ESM agent workflow example (`examples/agent-workflow.mjs`) demonstrating full task and receipt lifecycle.
- POSIX shell agent workflow example (`examples/agent-workflow.sh`).
- Documentation issue template (`.github/ISSUE_TEMPLATE/documentation.yml`).
- Test coverage for Turkish prompt snippet verification, agent workflow execution, control character validation, and corrupt event envelope edge cases.

## [0.1.0] - 2026-10-23

### Added

- Dependency-free ESM CLI for Node.js 20 and later, storing append-only tasks and receipts in project-local JSONL.
- Replayable checkpoints, task statuses, local-date filters, Markdown boards and JSON export.
- Ownership-aware locking, stale-lock recovery, credential refusal and explicit corrupt-history errors.
- Package author, public publish configuration with provenance, and eight discovery keywords.
- Tag-triggered release workflow using npm trusted publishing, version matching, and release instructions.
- Both value-option syntaxes, named usage errors, and edit-distance option suggestions.
- Cost listing with tool/unit/date filters and exact totals per tool/unit using integer micro-units.
- Markdown status selection and atomic file output with temporary-file cleanup.
- Resume command selecting the latest active task with its next action, due date and last three checkpoints.
- Local-calendar relative due dates and the test-only TASKLOG_NOW clock override.
- JavaScript syntax and README/help command checks, including a negative lint regression test.
- Reproducible terminal SVG captured from real CLI output, an accessible transcript, and CI/license/Node/npm badges in both READMEs.
- Verified installation-free quick start, three project differentiators, configuration reference and FAQ in English and Turkish.
- Built-in Node.js coverage reporting in the test command and CI, plus demo freshness checks before release.
- Weekly JavaScript CodeQL analysis and weekly npm/GitHub Actions dependency updates.
- Eight-process, 200-event stress proof and dead-PID/foreign-host lock regression tests.
- Issue forms, PR template, Contributor Covenant 2.1, Dependabot and replay-tested synthetic examples.

### Changed

- **Behavior change:** list defaults to open and waiting tasks. Use --all or --status all for the previous view; export retains every status.
- Markdown boards skip empty status sections and show _None_ when no task matches.
- CI covers Node 20, 22 and 24 on Windows and Ubuntu, including package dry runs.

[Unreleased]: https://github.com/YusufBeratZengin/agent-tasklog/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YusufBeratZengin/agent-tasklog/releases/tag/v0.1.0
