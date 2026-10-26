# Synthetic tasklog example

Run these commands from this directory after installing the local checkout:

```sh
tasklog resume --json
tasklog list --all
tasklog cost list --unit credits
tasklog cost total --json
tasklog md --status open,waiting
tasklog export --json
```

The snapshot contains two synthetic tasks and two receipts (0.1 + 0.2 credits).
The total is the decimal string `"0.3"`. The v1 JSONL files are safe to replay;
copy them to a temporary project before trying commands that append events.
Only this synthetic `.tasklog` directory is tracked; do not commit real logs.

## Files and examples

- [AGENTS.snippet.md](AGENTS.snippet.md): Standalone prompt snippet in English for `AGENTS.md` or `CLAUDE.md`.
- [AGENTS.snippet.tr.md](AGENTS.snippet.tr.md): Standalone prompt snippet in Turkish for `AGENTS.md` or `CLAUDE.md`.
- [agent-workflow.mjs](agent-workflow.mjs): Cross-platform Node.js ESM script demonstrating a full agent lifecycle (resume check, idempotent add, checkpoint updates, spend receipts, Markdown board export, close, and audit export).
- [agent-workflow.sh](agent-workflow.sh): POSIX shell script demonstrating the same lifecycle for terminal workflows.
