#!/usr/bin/env bash
# PostToolUse on Edit|Write: format an edited Rust file in place. Clippy needs
# the whole crate, so it runs in the Stop hook instead.
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
# On Windows the path arrives with backslashes, even under Git Bash.
case "${file//\\//}" in
  "${root//\\//}"/*.rs) rustfmt --config-path "$root/rustfmt.toml" "$file" ;;
esac

case "${file//\\//}" in
  "${root//\\//}"/*)
    cd "$root"
    typos --force-exclude -- "$file" >&2 || exit 2
    ;;
esac
