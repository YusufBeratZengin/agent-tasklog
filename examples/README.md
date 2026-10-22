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

[AGENTS.snippet.md](AGENTS.snippet.md) contains the agent session instructions.
