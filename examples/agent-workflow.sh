#!/usr/bin/env sh
# Complete AI coding agent workflow example using agent-tasklog.
# Demonstrates resuming, adding tasks with idempotency keys, checkpoints,
# spend receipts, markdown board generation, and task closure.

set -e

# Resolve repository root
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
TASKLOG="node $REPO_ROOT/bin/tasklog.js"

# Create isolated working directory
WORK_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'tasklog-sh')"
trap 'rm -rf "$WORK_DIR"' EXIT
cd "$WORK_DIR"

echo "Working directory: $WORK_DIR"

# 1. Start of session: check for an active task
echo "1. Checking active task at session start..."
$TASKLOG resume --json

# 2. Create a new task with a stable idempotency key
echo "2. Creating a task with an idempotency key..."
ADD_OUTPUT="$($TASKLOG add --area parser --title "Add JSON stream parser" --next "Draft token scanner" --due tomorrow --key stream-parser --json)"
TASK_ID="$(node -e "console.log(JSON.parse(process.argv[1]).task.id)" "$ADD_OUTPUT")"
echo "Created task ID: $TASK_ID"

# 3. Save a checkpoint and updated next action
echo "3. Recording interim checkpoint..."
$TASKLOG update "$TASK_ID" --note "Token scanner completed; tests green" --next "Implement backpressure buffering" --json

# 4. Record spend receipt for tool invocation
echo "4. Logging tool spend receipt..."
$TASKLOG cost add --tool runner --amount 0.05 --unit credits --note "Run 12 unit tests" --json

# 5. Generate Markdown task board
echo "5. Generating Markdown task board..."
$TASKLOG md --out TASKS.md

# 6. Mark task as done
echo "6. Completing task..."
$TASKLOG update "$TASK_ID" --status done --note "Stream parser complete and verified" --json

# 7. Check spend totals
echo "7. Final spend totals:"
$TASKLOG cost total --json

# 8. Export full audit log
echo "8. Exporting complete event history:"
$TASKLOG export --json

echo "Workflow finished successfully."
