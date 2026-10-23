#!/usr/bin/env bash
# Stop: before Claude reports back, run clippy with warnings denied if the
# working tree has changes. A failure blocks the stop (exit 2) and its output
# goes back to Claude. If it still fails on the stop after that, it reports
# without blocking again: the cause may be one Claude can't fix (offline, or
# the user's own work in progress). Tests stay in `just verify`; this is the
# fast part.
set -uo pipefail

payload=$(cat)
cd "$CLAUDE_PROJECT_DIR"
[ -z "$(git status --porcelain)" ] && exit 0

if ! output=$(CARGO_BUILD_WARNINGS=deny cargo clippy --workspace --all-targets --all-features --message-format short 2>&1); then
  if [ "$(jq -r '.stop_hook_active // false' <<<"$payload")" = true ]; then
    printf '`cargo clippy` still fails:\n%s\n' "$(tail -n 40 <<<"$output")" >&2
    exit 1
  fi
  printf '`cargo clippy` failed. Fix these before finishing:\n%s\n' "$(tail -n 80 <<<"$output")" >&2
  exit 2
fi
