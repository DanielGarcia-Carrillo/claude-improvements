#!/usr/bin/env bash
# Stop: before Claude reports back, run clippy with warnings denied if the
# working tree has changes. A failure blocks the stop (exit 2) and its output
# goes back to Claude. If it still fails on the stop after that, it reports
# without blocking again: the cause may be one Claude can't fix (offline, or
# the user's own work in progress). Tests stay in `just verify`; this is the
# fast part.
# Spelling runs from the checkout root, even when the payload cwd is nested.
set -uo pipefail

payload=$(cat)
# The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays
# on the main checkout.
cd "$(jq -r --arg dir "$CLAUDE_PROJECT_DIR" '.cwd // $dir' <<<"$payload")" || exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root" || exit 1
[ -z "$(git status --porcelain)" ] && exit 0

if ! output=$(typos 2>&1 && CARGO_BUILD_WARNINGS=deny cargo clippy --workspace --all-targets --all-features --message-format short 2>&1); then
  if [ "$(jq -r '.stop_hook_active // false' <<<"$payload")" = true ]; then
    printf '`typos` or `cargo clippy` still fails:\n%s\n' "$(tail -n 40 <<<"$output")" >&2
    exit 1
  fi
  printf '`typos` or `cargo clippy` failed. Fix these before finishing:\n%s\n' "$(tail -n 80 <<<"$output")" >&2
  exit 2
fi
