#!/usr/bin/env bash
# Stop: before Claude reports back, run clippy with warnings denied if the
# working tree has changes. A failure blocks the stop (exit 2) and its output
# goes back to Claude. Tests stay in `just verify`; this is the fast part.
set -uo pipefail

cat >/dev/null # The event payload; nothing in it changes what we check.
cd "$CLAUDE_PROJECT_DIR"
[ -z "$(git status --porcelain)" ] && exit 0

if ! output=$(CARGO_BUILD_WARNINGS=deny cargo clippy --workspace --all-targets --all-features --message-format short 2>&1); then
  printf '`cargo clippy` failed. Fix these before finishing:\n%s\n' "$(tail -n 80 <<<"$output")" >&2
  exit 2
fi
