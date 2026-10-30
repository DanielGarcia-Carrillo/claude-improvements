#!/usr/bin/env bash
# PostToolUse on Edit|Write: format an edited Python file in place. Lint fixes
# wait for the Stop hook: ruff would delete an import Claude added one edit
# before the code that uses it.
# Every edited file is also checked for American English.
set -euo pipefail

payload=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$payload")
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout. Format against the checkout Claude is working in.
cwd=$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || printf '%s' "$cwd")
# macOS may send /var paths while git reports /private/var. Compare the
# physical file path with git's root so the edited file is not skipped.
if [ -f "$file" ]; then
  file="$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")"
fi
# On Windows the path arrives with backslashes, even under Git Bash. A file
# that doesn't parse exits 2, which hands ruff's message on stderr to Claude.
case "${file//\\//}" in
  "${root//\\//}"/*.py | "${root//\\//}"/*.pyi) uv run --project "$root" --frozen ruff format "$file" >/dev/null ;;
esac

case "${file//\\//}" in
  "${root//\\//}"/*)
    cd "$root"
    mise exec -- typos --force-exclude -- "$file" >&2 || exit 2
    ;;
esac
