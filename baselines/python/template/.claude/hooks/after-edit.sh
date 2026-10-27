#!/usr/bin/env bash
# PostToolUse on Edit|Write: format an edited Python file in place. Lint fixes
# wait for the Stop hook: ruff would delete an import Claude added one edit
# before the code that uses it.
set -euo pipefail

payload=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$payload")
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout. Format against the checkout Claude is working in.
cwd=$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
# On Windows the path arrives with backslashes, even under Git Bash. A file
# that doesn't parse exits 2, which hands ruff's message on stderr to Claude.
case "${file//\\//}" in
  "${root//\\//}"/*.py | "${root//\\//}"/*.pyi) uv run --project "$root" --frozen ruff format "$file" >/dev/null ;;
esac
