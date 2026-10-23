#!/usr/bin/env bash
# PostToolUse on Edit|Write: format an edited Rust file in place. Clippy needs
# the whole crate, so it runs in the Stop hook instead.
set -euo pipefail

file=$(jq -r '.tool_input.file_path // empty')
# On Windows the path arrives with backslashes, even under Git Bash.
case "${file//\\//}" in
  "${CLAUDE_PROJECT_DIR//\\//}"/*.rs) rustfmt --config-path "$CLAUDE_PROJECT_DIR/rustfmt.toml" "$file" ;;
esac
