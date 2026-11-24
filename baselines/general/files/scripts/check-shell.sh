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
# expressions themselves. The job's runner names no platform, so a step's
# shell (cmd on Windows, say) is checked for every runner the action may
# meet. The copy keeps the steps' lines in order, so the report maps back to
# the action's own lines and steps. Prints nothing for a JavaScript or Docker
# action, and fails on metadata it cannot read rather than skipping it.
# shellcheck disable=SC2016 # Awk programs, not shell expansions.
read_yaml='
function indent(s) { match(s, /^ */); return RLENGTH }
function content(s) { return s !~ /^[ \t]*(#.*)?$/ }
# Splits a mapping line, after any indentation or list dash, into its key K
# (unquoted) and its value V (without a trailing comment). Returns 0 if the
# line is not a key.
function split_key(s,   t) {
  K = ""; V = ""
  sub(/^ *(- +)?/, "", s)
  if (!match(s, /^"[^"]*"[ \t]*:([ \t]|$)/) && !match(s, /^\047[^\047]*\047[ \t]*:([ \t]|$)/) &&
      !match(s, /^[^:#"\047 \t][^:#]*:([ \t]|$)/)) return 0
  t = substr(s, 1, RLENGTH); sub(/[ \t]*:[ \t]*$/, "", t)
  K = t ~ /^["\047]/ ? substr(t, 2, length(t) - 2) : t
  V = substr(s, RLENGTH + 1)
  sub(/^[ \t]+/, "", V); sub(/[ \t]+#.*$/, "", V); sub(/[ \t]+$/, "", V)
  return 1
}
# The unquoted value of a mapping line.
function value(s) {
  split_key(s)
  return V ~ /^(".*"|\047.*\047)$/ ? substr(V, 2, length(V) - 2) : V
}
{ sub(/\r$/, ""); text[NR] = $0 }
'
# shellcheck disable=SC2016 # An awk program, not a shell expansion.
wrap_action='
function fail(message) { printf "%s: %s\n", file, message > "/dev/stderr"; exit 2 }
# Prints the keys of a flow mapping such as {target: {default: x}, other: {}}.
function flow_keys(s,   i, c, depth, quote, token, done) {
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (quote != "") {
      if (c == quote) quote = ""
      if (depth == 1 && !done) token = token c
      continue
    }
    if (c == "\"" || c == "\047") {
      quote = c
      if (depth == 1 && !done) token = token c
      continue
    }
    if (c == "{" || c == "[") { depth++; continue }
    if (c == "}" || c == "]") { depth--; continue }
    if (depth != 1) continue
    if (c == ",") { token = ""; done = 0; continue }
    if (done) continue
    if (c == ":") { declare(token); done = 1; continue }
    token = token c
  }
}
function declare(name) {
  sub(/^[ \t]+/, "", name); sub(/[ \t]+$/, "", name)
  if (name ~ /^(".*"|\047.*\047)$/) name = substr(name, 2, length(name) - 2)
  if (name == "") return
  if (!declared++) { print "    inputs:"; header++ }
  printf "      \"%s\":\n        type: string\n", name
  header += 2
}
END {
  for (n = 1; n <= NR + 1; n++) {
    if (n <= NR && (!content(text[n]) || indent(text[n]) > 0 || text[n] ~ /^(---|\.\.\.)([ \t]|$)/)) continue
    if (key == "runs") { runs = top; runs_end = n }
    if (key == "inputs") { inputs = top; inputs_end = n }
    if (n > NR) break
    if (!split_key(text[n])) fail(sprintf("line %d: cannot read this top-level entry as a key", n))
    key = K; top = n
  }
  if (!runs) fail("cannot find runs in this action")
  if (value(text[runs]) != "") fail("write runs as a block mapping so its steps can be checked")
  for (n = runs + 1; n < runs_end; n++) {
    if (!content(text[n])) continue
    if (!child) child = indent(text[n])
    if (indent(text[n]) != child || !split_key(text[n])) continue
    if (K == "using") using = value(text[n])
    if (K == "steps") steps = n
  }
  if (using == "") fail("cannot find runs.using in this action")
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
  if (inputs && value(text[inputs]) ~ /^\{/) {
    flow = value(text[inputs])
    for (n = inputs + 1; n < inputs_end; n++) if (content(text[n])) flow = flow " " text[n]
    flow_keys(flow)
  } else if (inputs && value(text[inputs]) != "") {
    fail("write inputs as a mapping so its names can be declared")
  }
  for (n = inputs + 1; inputs && n < inputs_end && flow == ""; n++) {
    if (!content(text[n])) continue
    if (!input) input = indent(text[n])
    if (indent(text[n]) != input) continue
    if (!split_key(text[n])) fail(sprintf("line %d: cannot read this input name", n))
    declare(K)
  }
  print "jobs:"
  print "  composite:"
  print "    runs-on: self-hosted"
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
!found && FNR != NR {
  found = 1
  for (n = first; n <= last; n++) {
    if (indent(text[n]) != item || text[n] !~ /^ *-( |$)/) continue
    start[++count] = n
    rest = substr(text[n], item + 2)
    keys[count] = item + 1 + indent(rest)
    if (!content(rest)) keys[count] = -1
    else if (split_key(rest) && K == "name") title[count] = value(rest)
  }
  start[count + 1] = last + 1
  for (k = 1; k <= count; k++)
    for (n = start[k] + 1; n < start[k + 1]; n++) {
      if (!content(text[n])) continue
      if (keys[k] < 0) keys[k] = indent(text[n])
      if (indent(text[n]) == keys[k] && split_key(text[n]) && K == "name" && title[k] == "") title[k] = value(text[n])
    }
}
FNR != NR {
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
  if (f[3] == "shellcheck" && split_key(text[line]) && K == "run" && V ~ /^[|][-+0-9]*$/ &&
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
  awk -v file="$action" -v meta="$work/meta" "$read_yaml$wrap_action" "$action" >"$work/workflow.yml"
  [[ -s "$work/workflow.yml" ]] || continue
  ((checked_actions += 1))
  read -r first header shift item last <"$work/meta"
  status=0
  actionlint -shellcheck=shellcheck -stdin-filename "$action" \
    -format $'{{range $e := .}}{{$e.Line}}\t{{$e.Column}}\t{{$e.Kind}}\t{{$e.Message}}\n{{end}}' \
    - <"$work/workflow.yml" >"$work/errors" || status=$?
  if [[ "$status" -eq 1 && -s "$work/errors" ]]; then
    awk -v file="$action" -v first="$first" -v header="$header" -v shift="$shift" \
      -v item="$item" -v last="$last" "$read_yaml$report_action" "$action" - <"$work/errors"
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
