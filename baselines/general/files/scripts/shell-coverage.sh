#!/usr/bin/env bash
# Runtime coverage for checked-in Bash scripts, including hidden agent hooks.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v kcov >/dev/null; then
  printf 'Install kcov 43 (macOS: brew install kcov; Ubuntu: apt-get install kcov).\n' >&2
  exit 1
fi
version=$(kcov --version)
[[ "$version" = 'kcov 43' ]] || {
  printf 'Bash coverage requires kcov 43.\n' >&2
  exit 1
}
# The collector launcher is orchestration, not a subject: collecting its own
# recursive invocation would distort coverage. Tests and generated files are
# excluded; every other Bash script in scripts/ and .claude/hooks/ is counted,
# including scripts the suite never executes.
rm -rf coverage/shell
mkdir -p coverage/shell
SHELL_COVERAGE=1 bash tests/shell.sh
kcov --merge coverage/shell/merged coverage/shell/run-*
uv run --script --locked scripts/check-coverage.py coverage/shell/merged/kcov-merged/cobertura.xml
