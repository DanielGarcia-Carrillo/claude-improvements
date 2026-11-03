#!/usr/bin/env bash
# Stop: before Claude reports back, run clippy with warnings denied if the
# working tree has changes. A failure blocks the stop (exit 2) and its output
# goes back to Claude. If it still fails on the stop after that, it reports
# without blocking again: the cause may be one Claude can't fix (offline, or
# the user's own work in progress). Tests stay in `just verify`; this is the
# fast part.
# Spelling runs from the checkout root, even when the payload cwd is nested.
set -uo pipefail

: "${CLAUDE_PROJECT_DIR:?CLAUDE_PROJECT_DIR must name the project checkout}"
payload=$(cat) || exit 1
retry=$(jq -r '.stop_hook_active // false' <<<"$payload") || exit 1

# An inspection failure must not look like a clean checkout. The first stop
# blocks; a retry reports the failure without keeping Claude in a loop.
fail() {
  printf '%s\n' "$1" >&2
  if [[ "$retry" = true ]]; then exit 1; fi
  exit 2
}

# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout.
cwd=$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload") || fail 'Cannot read the hook checkout.'
cd "$cwd" || fail 'Cannot enter the hook checkout.'
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root" || fail 'Cannot enter the repository root.'
status=$(git status --porcelain) || fail 'git status failed; the checkout has not been validated.'
[[ -z "$status" ]] && exit 0

if ! output=$(mise exec -- typos 2>&1 && CARGO_BUILD_WARNINGS=deny cargo clippy --workspace --all-targets --all-features --message-format short 2>&1); then
  if [[ "$retry" = true ]]; then
    summary=$(tail -n 40 <<<"$output") || fail 'Cannot summarize the hook failure.'
    # The backticks are literal Markdown in the diagnostic.
    # shellcheck disable=SC2016
    printf '`typos` or `cargo clippy` still fails:\n%s\n' "$summary" >&2
    exit 1
  fi
  summary=$(tail -n 80 <<<"$output") || fail 'Cannot summarize the hook failure.'
  # The backticks are literal Markdown in the diagnostic.
  # shellcheck disable=SC2016
  printf '`typos` or `cargo clippy` failed. Fix these before finishing:\n%s\n' "$summary" >&2
  exit 2
fi
