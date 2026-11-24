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
fi
if [[ "$action_count" -gt 0 ]]; then
  # Composite actions are read with yq.
  require_tool yq
fi
if [[ "$workflow_count" -gt 0 || "$action_count" -gt 0 ]]; then
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

# actionlint reads only workflows, so yq copies each composite action's
# runs.steps into a generated workflow, with the action's inputs declared as
# workflow_call inputs. actionlint then checks it as it does any workflow:
# ShellCheck with each step's shell and ${{ }} expressions replaced, plus the
# expressions themselves, with inputs kept strict. The job's runner names no
# platform and its matrix is unknown, since the calling job decides both.
# Errors are mapped back to the action's own lines with yq's positions.
fail_action() {
  printf '%s: %s\n' "$action" "$1" >&2
  exit 2
}

# The indentation of a line of the action, to place ShellCheck columns.
line_indent() {
  local text lead
  text=$(sed -n "$1p" "$action")
  lead=${text%%[! ]*}
  printf '%s' "${#lead}"
}

checked_actions=0
skipped_steps=0
action_failed=0
if [[ "$action_count" -gt 0 ]]; then
  make_work
fi
sc_position='SC[0-9]+:[a-z]+:([0-9]+):([0-9]+):'
# Bash 3.2 treats an empty array as unset under set -u.
for action in ${actions[@]+"${actions[@]}"}; do
  # One read per value: in yq, reading a missing key can add it, and binding
  # a missing value to a variable yields nothing.
  if ! runs_kind=$(yq '.runs | type' "$action" 2>"$work/yq-errors"); then
    printf '%s: yq cannot read this YAML:\n' "$action" >&2
    cat "$work/yq-errors" >&2
    exit 2
  fi
  [[ "$runs_kind" = '!!map' ]] || fail_action 'cannot find runs in this action'
  using=$(yq '.runs.using // "" | tostring | downcase' "$action")
  case "$using" in
    composite) ;;
    node* | docker) continue ;;
    '') fail_action 'cannot find runs.using in this action' ;;
    *) fail_action "runs.using is '$using', not composite, docker or a node runtime" ;;
  esac
  steps_kind=$(yq '.runs.steps | type' "$action")
  inputs_kind=$(yq '.inputs | type' "$action")
  [[ "$steps_kind" = '!!seq' ]] || fail_action 'cannot find the list of runs.steps in this composite action'
  [[ "$inputs_kind" = '!!map' || "$inputs_kind" = '!!null' ]] ||
    fail_action 'inputs must be a mapping of input names'
  ((checked_actions += 1))

  # One line per step: its line and column, its run script's line, column and
  # style, its shell, whether it runs a script, and its name. As above, has()
  # comes before the reads.
  # shellcheck disable=SC2016 # A yq program, not a shell expansion.
  yq '.runs.steps | .[] | . as $s | ($s | has("run")) as $runs |
    [($s | line), ($s | column), ($s.run | line), ($s.run | column),
      ($s.run | style | sub("^$"; "plain")), $s.shell // "-", $runs,
      ($s.name // "" | tostring | sub("[\t\r\n]+"; " "))] | map(tostring) | join("\t")' \
    "$action" >"$work/steps"
  step_count=0
  while IFS=$'\t' read -r line column run_line run_column style shell runs name; do
    # yq prints an empty line when there are no steps.
    [[ -n "$line" ]] || continue
    step_line[step_count]=$line
    step_column[step_count]=$column
    step_run_line[step_count]=$run_line
    step_run_column[step_count]=$run_column
    step_style[step_count]=$style
    step_label[step_count]="step $((step_count + 1))${name:+ \"$name\"}"
    ((step_count += 1))
    [[ "$runs" = true ]] || continue
    case "${shell%% *}" in
      -)
        printf '%s:%s:%s: %s: a composite run step needs shell, which GitHub requires\n' \
          "$action" "$line" "$column" "${step_label[step_count - 1]}"
        action_failed=1
        ;;
      bash | sh) ;;
      *) ((skipped_steps += 1)) ;;
    esac
  done <"$work/steps"
  [[ "$step_count" -gt 0 ]] || fail_action 'runs.steps has no steps'

  # shellcheck disable=SC2016 # Expressions for actionlint, not shell expansions.
  MATRIX='${{ fromJSON(vars.MATRIX) }}' yq '{"on": {"workflow_call": {"inputs":
      ((.inputs // {}) | with_entries(.value = {"type": "string"}))}},
    "jobs": {"composite": {"runs-on": "self-hosted", "strategy": {"matrix": strenv(MATRIX)},
      "steps": .runs.steps}}}' "$action" >"$work/workflow.yml"
  yq '.jobs.composite.steps[] | (line | tostring) + "\t" + (column | tostring)' \
    "$work/workflow.yml" >"$work/generated"
  generated=0
  while IFS=$'\t' read -r line column; do
    generated_line[generated]=$line
    generated_column[generated]=$column
    ((generated += 1))
  done <"$work/generated"

  status=0
  actionlint -shellcheck=shellcheck -stdin-filename "$action" \
    -format $'{{range $e := .}}{{$e.Line}}\t{{$e.Column}}\t{{$e.Kind}}\t{{$e.Message}}\n{{end}}' \
    - <"$work/workflow.yml" >"$work/errors" || status=$?
  if [[ "$status" -ne 0 && ("$status" -ne 1 || ! -s "$work/errors") ]]; then
    cat "$work/errors" >&2
    fail_action "actionlint could not check this composite action (exit $status)"
  fi
  while IFS=$'\t' read -r line column kind message; do
    action_failed=1
    if [[ "$line" -lt "${generated_line[0]}" ]]; then
      printf '%s: %s [%s] (in the workflow generated from its inputs)\n' "$action" "$message" "$kind"
      continue
    fi
    step=$((generated - 1))
    while [[ "$step" -gt 0 && "${generated_line[step]}" -gt "$line" ]]; do ((step -= 1)); done
    if [[ "$kind" = shellcheck && "$message" =~ $sc_position ]]; then
      # ShellCheck counts from the start of the script.
      script_line=${BASH_REMATCH[1]}
      script_column=${BASH_REMATCH[2]}
      line=${step_run_line[step]}
      column=${step_run_column[step]}
      case "${step_style[step]}" in
        literal)
          line=$((line + script_line))
          column=$(($(line_indent "$line") + script_column))
          ;;
        plain)
          line=$((line + script_line - 1))
          if [[ "$script_line" -eq 1 ]]; then
            column=$((column + script_column - 1))
          fi
          ;;
        *) ;;
      esac
    else
      line=$((step_line[step] + line - generated_line[step]))
      column=$((step_column[step] + column - generated_column[step]))
      if [[ "$step" -lt "$((step_count - 1))" && "$line" -ge "${step_line[step + 1]}" ]]; then
        line=${step_line[step]}
      fi
      [[ "$column" -ge 1 ]] || column=1
    fi
    printf '%s:%s:%s: %s: %s [%s]\n' "$action" "$line" "$column" "${step_label[step]}" "$message" "$kind"
  done <"$work/errors"
done
if [[ "$action_failed" -ne 0 ]]; then
  exit 1
fi
skipped=
if [[ "$skipped_steps" -gt 0 ]]; then
  skipped=" ($skipped_steps steps in other shells skipped by ShellCheck)"
fi
printf 'Shell quality passed: %s shell files, %s workflows, %s composite actions%s.\n' \
  "$script_count" "$workflow_count" "$checked_actions" "$skipped"
