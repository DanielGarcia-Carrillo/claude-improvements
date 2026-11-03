#!/usr/bin/env bash
# Check regular shell files and workflows, including hidden template folders.
# --fix formats shell files first. Explicit paths restrict work to that set;
# otherwise include tracked and untracked files, respecting Git's ignores.
set -euo pipefail

mode=check
if [[ "${1:-}" = --fix ]]; then
  mode=fix
  shift
fi
if [[ "${1:-}" = -- ]]; then
  shift
fi

root=$(git rev-parse --show-toplevel)
cd "$root"
scripts=()
workflows=()
script_count=0
workflow_count=0

classify() {
  local file="$1" first=""
  # A staged deletion or a link outside the checkout is not an input.
  [[ -f "$file" && ! -L "$file" ]] || return 0
  file=${file#./}
  case "$file" in
    *.sh | *.bash | *.ksh | *.bats)
      scripts[script_count]="./$file"
      ((script_count += 1))
      ;;
    .github/workflows/*.yml | .github/workflows/*.yaml | */.github/workflows/*.yml | */.github/workflows/*.yaml)
      workflows[workflow_count]="./$file"
      ((workflow_count += 1))
      ;;
    *)
      # Extensionless executables often hold repository maintenance commands.
      if [[ "${file##*/}" != *.* ]]; then
        # Bound the read so an extensionless binary cannot fill shell memory.
        IFS= read -r -n 256 first <"$file" || :
        if [[ "$first" =~ ^\#!.*[/[:space:]](bash|sh|dash|ksh)([[:space:]]|$) ]]; then
          scripts[script_count]="./$file"
          ((script_count += 1))
        fi
      fi
      ;;
  esac
}

if [[ "$#" -gt 0 ]]; then
  for file in "$@"; do classify "$file"; done
else
  # Materialize the listing so a Git failure cannot be hidden by process
  # substitution. NUL delimiters preserve spaces and newlines in filenames.
  paths=$(mktemp)
  trap 'rm -f "$paths"' EXIT
  git ls-files -z --cached --others --exclude-standard >"$paths"
  while IFS= read -r -d '' file; do classify "$file"; done <"$paths"
fi

require_tool() {
  if ! command -v "$1" >/dev/null; then
    printf 'Missing %s. Run mise install and use mise exec -- for the shell checks.\n' "$1" >&2
    exit 1
  fi
}

if [[ "$script_count" -gt 0 || "$workflow_count" -gt 0 ]]; then
  # actionlint silently omits inline-shell checks if ShellCheck is absent.
  require_tool shellcheck
fi
if [[ "$script_count" -gt 0 ]]; then
  require_tool shfmt
  if [[ "$mode" = fix ]]; then
    shfmt -w -i 2 -ci "${scripts[@]}"
  else
    shfmt -d -i 2 -ci "${scripts[@]}"
  fi
  shellcheck "${scripts[@]}"
fi
if [[ "$workflow_count" -gt 0 ]]; then
  require_tool actionlint
  actionlint -shellcheck=shellcheck "${workflows[@]}"
fi
printf 'Shell quality passed: %s shell files, %s workflows.\n' "$script_count" "$workflow_count"
