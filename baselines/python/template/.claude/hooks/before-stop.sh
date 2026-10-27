#!/usr/bin/env bash
# Stop: before Claude reports back, run ruff and ty if the working tree has
# changes. A failure blocks the stop (exit 2) and its output goes back to
# Claude. If it still fails on the stop after that, it reports without
# blocking again: the cause may be one Claude can't fix (offline, or the
# user's own work in progress). Tests stay in `just verify`; this is the fast
# part.
set -uo pipefail

payload=$(cat)
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout.
cd "$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")" || exit 0
[ -z "$(git status --porcelain)" ] && exit 0

# Both run, so one stop reports every problem.
lint=$(uv run --frozen ruff check --output-format concise 2>&1) && lint_ok=1 || lint_ok=0
types=$(uv run --frozen ty check --output-format concise 2>&1) && types_ok=1 || types_ok=0
[ "$lint_ok$types_ok" = 11 ] && exit 0

output=$( { [ "$lint_ok" = 1 ] || printf '%s\n' "$lint"; [ "$types_ok" = 1 ] || printf '%s\n' "$types"; } )
if [ "$(jq -r '.stop_hook_active // false' <<<"$payload")" = true ]; then
  printf '`ruff check` or `ty check` still fails:\n%s\n' "$(tail -n 40 <<<"$output")" >&2
  exit 1
fi
printf '`ruff check` or `ty check` failed. Fix these before finishing (`just fix` applies the safe fixes):\n%s\n' "$(tail -n 80 <<<"$output")" >&2
exit 2
