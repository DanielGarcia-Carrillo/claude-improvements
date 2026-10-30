#!/usr/bin/env bash
# Stop: before Claude reports back, check spelling in the checkout and run ruff
# and ty in each Python project whose files changed. A failure blocks the stop
# (exit 2) and its output goes back to Claude. If it still fails on the stop
# after that, it reports without blocking again: the cause may be one Claude
# can't fix (offline, or the user's own work in progress). Tests stay in
# `just verify`; this is the fast part.
# Spelling runs from the checkout root, even when the payload cwd is nested.
set -uo pipefail

payload=$(cat)
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout.
cd "$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")" || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root" || exit 1
[ -z "$(git status --porcelain)" ] && exit 0

# All run, so one stop reports every problem.
output=""
spelling=$(mise exec -- typos 2>&1) || output+="$spelling"$'\n'
# Each folder holding pyproject.toml and uv.lock is a project: the repository
# root, or a subfolder when the project lives in a bigger repository. A
# pyproject.toml without a lock (a test fixture, a workspace member) belongs
# to the project above it.
while IFS= read -r -d '' lock; do
  dir=$(dirname "$lock")
  # Listed but deleted, or moved, and not yet committed.
  [ -f "$lock" ] && [ -f "$dir/pyproject.toml" ] || continue
  [ -z "$(git status --porcelain -- "$dir")" ] && continue
  label=$([ "$dir" = . ] || printf '%s: ' "$dir")
  lint=$(cd "$dir" && uv run --frozen ruff check --output-format concise 2>&1) || output+="$label$lint"$'\n'
  types=$(cd "$dir" && uv run --frozen ty check --output-format concise 2>&1) || output+="$label$types"$'\n'
done < <(git ls-files -z --cached --others --exclude-standard -- ':(glob)**/uv.lock')
[ -z "$output" ] && exit 0

if [ "$(jq -r '.stop_hook_active // false' <<<"$payload")" = true ]; then
  printf '`typos`, `ruff check` or `ty check` still fails:\n%s\n' "$(tail -n 40 <<<"$output")" >&2
  exit 1
fi
printf '`typos`, `ruff check` or `ty check` failed. Fix these before finishing (`just fix` applies the safe fixes):\n%s\n' "$(tail -n 80 <<<"$output")" >&2
exit 2
