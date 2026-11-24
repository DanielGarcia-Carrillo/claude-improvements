#!/usr/bin/env bash
# Check regular shell files, workflows and composite actions, including hidden
# template folders. --fix formats shell files first. Explicit paths restrict
# work to that set; otherwise include tracked and untracked files, respecting
# Git's ignores.
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
# Created on first use, so a missing tool is reported before mktemp runs.
work=
trap '[[ -z "$work" ]] || rm -rf "$work"' EXIT
make_work() {
  [[ -n "$work" ]] || work=$(mktemp -d)
}
scripts=()
workflows=()
actions=()
script_count=0
workflow_count=0
action_count=0

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
    action.yml | action.yaml | */action.yml | */action.yaml)
      actions[action_count]="./$file"
      ((action_count += 1))
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
  make_work
  git ls-files -z --cached --others --exclude-standard >"$work/paths"
  while IFS= read -r -d '' file; do classify "$file"; done <"$work/paths"
fi

require_tool() {
  if ! command -v "$1" >/dev/null; then
    printf 'Missing %s. Run mise install and use mise exec -- for the shell checks.\n' "$1" >&2
    exit 1
  fi
}

if [[ "$script_count" -gt 0 || "$workflow_count" -gt 0 || "$action_count" -gt 0 ]]; then
  # actionlint silently omits inline-shell checks if ShellCheck is absent.
  require_tool shellcheck
fi
if [[ "$workflow_count" -gt 0 || "$action_count" -gt 0 ]]; then
  require_tool actionlint
  # actionlint invokes ShellCheck with --norc, so forward the configured
  # optional checks explicitly. Its GitHub-specific exclusions still apply.
  optional_checks=$(sed -n 's/^enable=//p' "$root/.shellcheckrc" | paste -sd, -)
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
if [[ "$workflow_count" -gt 0 || "$action_count" -gt 0 ]]; then
  export SHELLCHECK_OPTS="${SHELLCHECK_OPTS:-} --enable=$optional_checks"
fi
if [[ "$workflow_count" -gt 0 ]]; then
  actionlint -shellcheck=shellcheck "${workflows[@]}"
fi

# actionlint reads only workflows, so each composite action's runs.steps is
# copied into a generated workflow, with the action's inputs declared as
# workflow_call inputs. actionlint then checks it as it does any workflow:
# ShellCheck with each step's shell and ${{ }} expressions replaced, plus the
# expressions themselves. The copy keeps the steps' lines in order, so the
# report maps back to the action's own lines and steps. Prints nothing for a
# JavaScript or Docker action, and fails if the steps cannot be found.
# shellcheck disable=SC2016 # Awk programs, not shell expansions.
wrap_action='
function indent(s) { match(s, /^ */); return RLENGTH }
function content(s) { return s !~ /^[ \t]*(#.*)?$/ }
function value(s) {
  sub(/^[^:]*:[ \t]*/, "", s); sub(/[ \t]+#.*$/, "", s); sub(/[ \t]+$/, "", s)
  gsub(/^["\047]|["\047]$/, "", s)
  return s
}
function fail(message) { printf "%s: %s\n", file, message > "/dev/stderr"; exit 2 }
{ text[NR] = $0 }
END {
  for (n = 1; n <= NR + 1; n++) {
    if (n <= NR && (!content(text[n]) || indent(text[n]) > 0)) continue
    if (key == "runs") { runs = top; runs_end = n }
    if (key == "inputs") { inputs = top; inputs_end = n }
    key = text[n]; sub(/:.*/, "", key); top = n
  }
  if (!runs) exit 0
  for (n = runs + 1; n < runs_end; n++) {
    if (!content(text[n])) continue
    if (!child) child = indent(text[n])
    if (indent(text[n]) != child) continue
    if (text[n] ~ /^ *using:/) using = value(text[n])
    if (text[n] ~ /^ *steps:/) steps = n
  }
  if (using != "composite") exit 0
  if (!steps) fail("cannot find runs.steps in this composite action")
  if (value(text[steps]) != "") fail("write runs.steps as a block list so its run scripts can be checked")
  for (n = steps + 1; n < runs_end && !content(text[n]); n++);
  item = indent(text[n])
  if (n >= runs_end || item < child || text[n] !~ /^ *-( |$)/) fail("cannot find the steps under runs.steps")
  for (; n < runs_end; n++)
    if (content(text[n]) && (indent(text[n]) < item || (indent(text[n]) == item && text[n] !~ /^ *-( |$)/))) break
  last = n - 1
  header = 2
  print "on:"
  print "  workflow_call:"
  for (n = inputs + 1; inputs && n < inputs_end; n++) {
    if (!content(text[n])) continue
    if (!input) {
      input = indent(text[n])
      print "    inputs:"
      header++
    }
    if (indent(text[n]) != input) continue
    name = substr(text[n], input + 1)
    if (name ~ /^"/) match(name, /^"[^"]*"/)
    else if (name ~ /^\047/) match(name, /^\047[^\047]*\047/)
    else match(name, /^[^:]*/)
    printf "      %s:\n        type: string\n", substr(name, 1, RLENGTH)
    header += 2
  }
  print "jobs:"
  print "  composite:"
  print "    runs-on: ubuntu-latest"
  print "    steps:"
  header += 4
  shift = item < 6 ? 6 - item : 0
  pad = sprintf("%" shift "s", "")
  for (n = steps + 1; n <= last; n++) print (text[n] == "" ? "" : pad text[n])
  print steps + 1, header, shift, item, last > meta
}
'
# Reads the action, then actionlint's errors as line, column, kind and
# message separated by tabs, and prints each with the action's own line and
# step.
# shellcheck disable=SC2016 # An awk program, not a shell expansion.
report_action='
function indent(s) { match(s, /^ */); return RLENGTH }
function content(s) { return s !~ /^[ \t]*(#.*)?$/ }
function value(s) {
  sub(/^[^:]*:[ \t]*/, "", s); sub(/[ \t]+#.*$/, "", s); sub(/[ \t]+$/, "", s)
  gsub(/^["\047]|["\047]$/, "", s)
  return s
}
FNR == NR { text[FNR] = $0; next }
!found {
  found = 1
  for (n = first; n <= last; n++) {
    if (indent(text[n]) != item || text[n] !~ /^ *-( |$)/) continue
    start[++count] = n
    rest = substr(text[n], item + 2)
    keys[count] = item + 1 + indent(rest)
    if (content(rest)) { if (rest ~ /^ *name:/) title[count] = value(rest) }
    else keys[count] = -1
  }
  start[count + 1] = last + 1
  for (k = 1; k <= count; k++)
    for (n = start[k] + 1; n < start[k + 1]; n++) {
      if (!content(text[n])) continue
      if (keys[k] < 0) keys[k] = indent(text[n])
      if (indent(text[n]) == keys[k] && text[n] ~ /^ *name:/ && title[k] == "") title[k] = value(text[n])
    }
}
{
  fields = split($0, f, "\t")
  message = f[4]
  for (i = 5; i <= fields; i++) message = message "\t" f[i]
  if (f[1] <= header) {
    printf "%s: %s [%s] (in the workflow generated from its inputs)\n", file, message, f[3]
    next
  }
  line = f[1] - header - 1 + first
  column = f[2] - shift
  if (column < 1) column = 1
  # ShellCheck positions count from the start of a literal block script; point
  # at the script line itself rather than at its run key. Folded scripts keep
  # the run key, since folding moves their lines.
  if (f[3] == "shellcheck" && text[line] ~ /run:[ \t]*[|][-+0-9]*[ \t]*(#.*)?$/ &&
      match(message, /SC[0-9]+:[a-z]+:[0-9]+:[0-9]+:/)) {
    split(substr(message, RSTART, RLENGTH), at, ":")
    for (n = line + 1; n <= last && !content(text[n]); n++);
    column = indent(text[n]) + at[4]
    line += at[3]
  }
  for (k = count; k > 1 && start[k] > line; k--);
  label = title[k] == "" ? "" : " \"" title[k] "\""
  printf "%s:%d:%d: step %d%s: %s [%s]\n", file, line, column, k, label, message, f[3]
}
'
checked_actions=0
if [[ "$action_count" -gt 0 ]]; then
  make_work
fi
action_failed=0
# Bash 3.2 treats an empty array as unset under set -u.
for action in ${actions[@]+"${actions[@]}"}; do
  awk -v file="$action" -v meta="$work/meta" "$wrap_action" "$action" >"$work/workflow.yml"
  [[ -s "$work/workflow.yml" ]] || continue
  ((checked_actions += 1))
  read -r first header shift item last <"$work/meta"
  status=0
  actionlint -shellcheck=shellcheck -stdin-filename "$action" \
    -format $'{{range $e := .}}{{$e.Line}}\t{{$e.Column}}\t{{$e.Kind}}\t{{$e.Message}}\n{{end}}' \
    - <"$work/workflow.yml" >"$work/errors" || status=$?
  if [[ "$status" -eq 1 && -s "$work/errors" ]]; then
    awk -v file="$action" -v first="$first" -v header="$header" -v shift="$shift" \
      -v item="$item" -v last="$last" "$report_action" "$action" - <"$work/errors"
    action_failed=1
  elif [[ "$status" -ne 0 ]]; then
    cat "$work/errors" >&2
    printf '%s: actionlint could not check this composite action (exit %s).\n' "$action" "$status" >&2
    exit "$status"
  fi
done
if [[ "$action_failed" -ne 0 ]]; then
  exit 1
fi
printf 'Shell quality passed: %s shell files, %s workflows, %s composite actions.\n' \
  "$script_count" "$workflow_count" "$checked_actions"
