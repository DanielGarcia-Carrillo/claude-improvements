#!/usr/bin/env bash
# Stop: before Claude reports back, run ruff and ty in each Python project
# whose files changed. A failure blocks the stop (exit 2) and its output goes
# back to Claude. If it still fails on the stop after that, it reports without
# blocking again: the cause may be one Claude can't fix (offline, or the
# user's own work in progress). Tests stay in `just verify`; this is the fast
# part.
set -uo pipefail

payload=$(cat)
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout.
cd "$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")" || exit 0
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 0

# Each folder holding a pyproject.toml is a project: the repository root, or a
# subfolder when the project lives in a bigger repository. Both checks run in
# each, so one stop reports every problem.
output=""
while IFS= read -r manifest; do
  dir=$(dirname "$manifest")
  [ -z "$(git status --porcelain -- "$dir")" ] && continue
  label=$([ "$dir" = . ] || printf '%s: ' "$dir")
  lint=$(cd "$dir" && uv run --frozen ruff check --output-format concise 2>&1) || output+="$label$lint"$'\n'
  types=$(cd "$dir" && uv run --frozen ty check --output-format concise 2>&1) || output+="$label$types"$'\n'
done < <(git ls-files --cached --others --exclude-standard | grep -E '(^|/)pyproject\.toml$')
[ -z "$output" ] && exit 0

if [ "$(jq -r '.stop_hook_active // false' <<<"$payload")" = true ]; then
  printf '`ruff check` or `ty check` still fails:\n%s\n' "$(tail -n 40 <<<"$output")" >&2
  exit 1
fi
printf '`ruff check` or `ty check` failed. Fix these before finishing (`just fix` applies the safe fixes):\n%s\n' "$(tail -n 80 <<<"$output")" >&2
exit 2
