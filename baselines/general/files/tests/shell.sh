#!/usr/bin/env bash
# Behavioral tests run scripts against disposable checkouts and fake checkers.
set -euo pipefail
source_root=$(cd "$(dirname "$0")/.." && pwd -P)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
# Reuse the quality scanner's Bash inventory: a Node script with a shebang
# must not enter the Bash denominator merely because it is executable.
code_root=$(git -C "$source_root" rev-parse --show-toplevel)
bash "$source_root/scripts/check-shell.sh" --list >"$scratch/subjects"
subjects=""
while IFS= read -r -d '' subject; do
  subjects+="${subjects:+,}$code_root/${subject#./}"
done <"$scratch/subjects"
mkdir -p "$scratch/bin" "$scratch/repo"
export TOOL_LOG="$scratch/tools.log" TOOL_FAIL=""
for tool in shfmt shellcheck actionlint mise uv cargo rustfmt; do
  cat >"$scratch/bin/$tool" <<'STUB'
#!/usr/bin/env bash
set -eu
printf '%s:%s\n' "${0##*/}" "$*" >> "$TOOL_LOG"
if [[ "${0##*/}" = "$TOOL_FAIL" ]]; then echo 'checker failed' >&2; exit 1; fi
STUB
  chmod +x "$scratch/bin/$tool"
done
export PATH="$scratch/bin:$PATH"
cd "$scratch/repo"
git init -q
git config user.email tests@example.invalid
git config user.name Tests
invocation=0
check() {
  local expected="$1" status=0
  shift
  local command=("$@") directories="$source_root/scripts"
  if [[ "${SHELL_COVERAGE:-0}" = 1 ]]; then
    ((invocation += 1))
    [[ ! -d "$source_root/.claude/hooks" ]] || directories+=",$source_root/.claude/hooks"
    command=(kcov --clean --bash-parse-files-in-dir="$directories" --include-path="$subjects"
      --exclude-pattern=/scripts/shell-coverage.sh "$source_root/coverage/shell/run-$invocation" "${@:2}")
  fi
  "${command[@]}" >"$scratch/output" 2>&1 || status=$?
  if [[ "$status" != "$expected" ]]; then
    cat "$scratch/output" >&2
    printf 'Expected exit %s, got %s: %s\n' "$expected" "$status" "$*" >&2
    exit 1
  fi
}
contains() {
  if ! grep -F -- "$1" "$2" >/dev/null; then
    printf 'Expected %s in %s\n' "$1" "$2" >&2
    cat "$2" >&2
    exit 1
  fi
}
checker="$source_root/scripts/check-shell.sh"
check 0 bash "$checker"
contains '0 shell files, 0 workflows' "$scratch/output"
mkdir -p .hidden .github/workflows
printf '#!/bin/sh\ntrue\n' >'a file.sh'
printf '#!/usr/bin/env bash\ntrue\n' >.hidden/tool
printf '#!/bin/sh\ntrue\n' >.hidden/other
printf 'name: CI\n' >.github/workflows/check.yml
printf 'not a script\n' >notes
printf 'ignored.sh\n' >.gitignore
printf 'true\n' >ignored.sh
ln -s 'a file.sh' link.sh
git add .
check 0 bash "$checker"
contains '3 shell files, 1 workflows' "$scratch/output"
check 0 bash "$checker" --list
# kcov's stdout forwarding truncates NUL-delimited output; inspect the actual
# inventory directly as well as collecting the mode's exit behavior above.
bash "$checker" --list >"$scratch/inventory"
contains './a file.sh' "$scratch/inventory"
check 0 bash "$checker" --fix -- 'a file.sh'
contains 'shfmt:-w' "$TOOL_LOG"
check 0 bash "$checker" -- notes link.sh deleted.sh
contains '0 shell files, 0 workflows' "$scratch/output"
for tool in shfmt shellcheck actionlint; do
  export TOOL_FAIL="$tool"
  check 1 bash "$checker"
done
export TOOL_FAIL=""
# Every hook runs against this checkout even if CLAUDE_PROJECT_DIR points
# elsewhere. Keep the file paths real so path containment is exercised.
export CLAUDE_PROJECT_DIR="$scratch"
if [[ -d "$source_root/.claude/hooks" ]] && [[ -f "$source_root/.claude/hooks/after-edit.sh" ]]; then
  for kind in py rs txt; do printf 'example\n' >"file.$kind"; done
  printf '[project]\n' >pyproject.toml
  touch uv.lock
  git add .
  git commit -qm initial
  payload() {
    printf '{"cwd":"%s","tool_input":{"file_path":"%s"},"stop_hook_active":%s}' "$scratch/repo" "$1" "$2"
  }
  edit="$source_root/.claude/hooks/after-edit.sh"
  stop="$source_root/.claude/hooks/before-stop.sh"
  for file in "$scratch/repo/file.py" "$scratch/repo/file.rs" "$scratch/repo/file.txt" "$scratch/repo/missing.py" "$scratch/outside.py"; do
    payload "$file" false >"$scratch/payload"
    check 0 bash "$edit" <"$scratch/payload"
  done
  payload "$scratch/repo/file.txt" false >"$scratch/payload"
  check 0 bash "$stop" <"$scratch/payload"
  printf 'change\n' >>file.txt
  check 0 bash "$stop" <"$scratch/payload"
  export TOOL_FAIL=mise
  check 2 bash "$edit" <"$scratch/payload"
  check 2 bash "$stop" <"$scratch/payload"
  payload "$scratch/repo/file.txt" true >"$scratch/payload"
  check 1 bash "$stop" <"$scratch/payload"
  export TOOL_FAIL=""
  # Nested Python projects and lockless fixture directories.
  mkdir -p nested/fixture
  printf '[project]\n' >nested/pyproject.toml
  touch nested/uv.lock
  printf '[project]\n' >nested/fixture/pyproject.toml
  printf 'example\n' >nested/fixture/file.py
  payload "$scratch/repo/nested/fixture/file.py" false >"$scratch/payload"
  check 0 bash "$edit" <"$scratch/payload"
  check 0 bash "$stop" <"$scratch/payload"
fi
printf 'Shell behavior tests passed.\n'
