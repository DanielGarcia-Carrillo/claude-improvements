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
# On Windows the path arrives with backslashes, even under Git Bash.
file=${file//\\//}
root=${root//\\//}
case "$file" in
  "$root"/*.py | "$root"/*.pyi) ;;
  *) exit 0 ;;
esac
# The project is the nearest folder above the file that holds pyproject.toml
# and uv.lock, so one in a subfolder of the repository works like one at its
# root. A pyproject.toml without a lock (a test fixture, a workspace member)
# belongs to the project above it.
project=$(dirname "$file")
while [ ! -f "$project/pyproject.toml" ] || [ ! -f "$project/uv.lock" ]; do
  [ "$project" = "$root" ] && exit 0
  project=$(dirname "$project")
done
# A file that doesn't parse exits 2, which hands ruff's message to Claude.
uv run --project "$project" --frozen ruff format "$file" >/dev/null
