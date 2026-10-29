# Python baseline

For tools, scripts and data pipelines in Python, built mostly by agents. The
bar is the same as Rust's: ruff, ty and the tests catch a mistake before
review does, and say how to fix it. [`template/`](template/) is a working
package with a CLI that passes `just verify`;
[`CLAUDE.stack.md`](CLAUDE.stack.md) is the Python part of the new repo's
agent file.

Versions and statuses were checked on 2026-10-27.

## Using it

1. Ask the [kickoff questions](../general/kickoff.md) (CLI, library or
   pipeline; who runs it; published or not; which Pythons).
2. Copy `template/` and `../general/files/` into the new repo. Every
   placeholder spells "replace me": `replace-me` as the project, script and
   program name, `replace_me` as the package folder, its imports and the
   CLI test's helper, and `Repository` in `pyproject.toml`.
   `git grep --untracked -niE 'replace[-_ ]?me([^a-z]|$)'` lists what's left, and CI
   fails while any remain.
   Run `git init -b main` if this is not already a Git repository.
3. `mise install && uv lock && just bootstrap`. The dependency groups give floors only and the
   template has no lockfile, so this resolves the newest releases.
4. Take a new Python too: set `.python-version` and `requires-python` to the
   newest release uv offers (`uv python list --only-downloads`), then
   `just verify`. If a dependency doesn't support it yet, stay one release
   back and note it in the stack ADR. Commit `uv.lock`.
5. Build `CLAUDE.md` from [`CLAUDE.template.md`](../general/CLAUDE.template.md)
   plus [`CLAUDE.stack.md`](CLAUDE.stack.md); `ln -s CLAUDE.md AGENTS.md`.

Pre-commit uses Lefthook (pinned in `mise.toml`) on staged files only, with
independent jobs in parallel and formatter fixes re-staged. typos checks
American English spelling. Run
`just bootstrap` in every clone to install hooks. Ruff applies safe lint fixes
and then formats staged Python files; type checks and tests stay in `just verify` and CI.

The target is under five seconds after installing dependencies. A commit with
no matching files skips the corresponding jobs. `git commit --no-verify`
bypasses hooks; full verify and CI remain required.

## The defaults

| Area | Default | Why |
|---|---|---|
| Toolchain | Python 3.15 in `.python-version`, installed by uv; uv 0.13 and just pinned in `mise.toml` | Every checkout and CI run one Python, with nothing installed system-wide; 3.15 makes UTF-8 the default everywhere |
| Packages | uv with `uv.lock` committed and the `uv_build` backend; every tool (ruff, ty, pytest, deptry) is a dev dependency, run through `uv run` | One lockfile pins code and tools, and Dependabot reads it; uv resolves and installs in milliseconds |
| Layout | `src/<package>/`: logic in private modules re-exported from `__init__.py`, a thin `cli.py`, and `_output.py` as the only module that prints | Logic is tested without spawning a process; each public name has one import path |
| Lint and format | ruff with every rule (`ALL`) minus a short list, each with its reason; `ruff format` | Each rule names the problem and usually the fix. A suppression must name its rule (`PGH004`), and an unused one fails (`RUF100`) |
| Types | ty, with the rules its guide lists as `mypy --strict`'s counterparts turned on, plus ruff's `ANN` for annotations; any warning fails | Checks the whole project in well under a second, so the Stop hook runs it every time; diagnostics in rustc's style |
| Errors | Subclasses of the package's `Error`, each with a stable `code` and a `hint`; the cause kept with `raise … from` | Machine-matchable, actionable, no duplicated messages |
| CLI | argparse from the standard library; `--json` prints exactly one envelope, even for bad arguments; exit 0 clean / 1 findings / 2 error / 70 bug | Agents and scripts parse stdout and branch on codes; no dependency and the fastest start |
| Logging | `logging` to stderr, `LOG_LEVEL` filter; `print` and `sys.stdout` banned outside `_output.py` | stdout stays the result |
| Tests | pytest (strict, warnings fail), doctests, inline-snapshot for the CLI contract, Hypothesis for properties | Snapshots live in the test and are rewritten by a command, so the diff is the review |
| Supply chain | deptry for undeclared and unused dependencies; `uv audit` (OSV advisories) on main and weekly, or `just audit` | A new advisory doesn't block an unrelated PR |
| Tasks | `just` | One `just verify` that runs the checks PR CI runs, the same command as the Rust template |
| CI | GitHub Actions, SHA-pinned; jdx/mise-action installs uv and just from `mise.toml`, uv installs the rest | Linux only by default; add macOS and Windows legs only for tools shipped there |

## Newer and faster than the usual picks

| Here | In place of | Why |
|---|---|---|
| uv | pip, pip-tools, Poetry, pyenv | One binary manages Python, the environment and the lockfile, many times faster |
| `uv_build` | hatchling, setuptools | uv's own build backend, in Rust; nothing to configure for a src layout |
| ruff | flake8 and its plugins, isort, Black, pyupgrade | One binary, rules from all of them, in milliseconds |
| ty | mypy `--strict` | 0.05 seconds on the template, and nearly the same strictness (the agent fragment's Traps name the gap) |
| `uv audit` | pip-audit | Reads `uv.lock` directly instead of resolving again; experimental in uv 0.13 |
| inline-snapshot | syrupy, hand-written expected values | Snapshots sit in the test source and are rewritten in place |
| argparse | click, Typer, Cyclopts | No dependency and nothing extra to import at startup; Typer and Cyclopts load rich |
| just | Makefile, nox, tox, poethepoet | Same runner as the Rust template; nox and tox build environments uv already gives |

Watched, not yet adopted: [karva](https://github.com/karva-dev/karva), a
pytest-compatible runner written in Rust (alpha, 0.0.1a13), and
[Pyrefly](https://pyrefly.org/) 1.0, Meta's stable type checker, if ty
stalls before its own 1.0.

## Add when needed

| Need | Add |
|---|---|
| Published library | Drop the `Private` classifier; `requires-python` two or three releases back with a CI leg on the oldest; `uv build` and `uv publish` with PyPI trusted publishing from Actions |
| Validating outside data | Pydantic 2 (ty understands it without a plugin) or msgspec, which is faster and smaller |
| Faster JSON | orjson |
| A richer CLI (prompts, colors, completion) | Cyclopts, at a startup cost |
| Startup time | `python -X importtime`, then 3.15's `lazy import` for the heavy modules it shows |
| Slow tests | pytest-xdist (`-n auto`) once the suite takes more than about 30 seconds |
| Coverage | coverage.py; on 3.12 and later `COVERAGE_CORE=sysmon` traces through `sys.monitoring` at a fraction of the cost |
| Stubs for an untyped dependency | `.pyi` files in `typings/`, added to ty's `environment.extra-paths` |
| License checks | `pip-licenses --allow-only` in CI |
| Django, or anything that needs a mypy plugin | mypy `--strict` in place of ty |

## Sources

- ty's [Coming from mypy or pyright](https://docs.astral.sh/ty/coming-from-mypy-or-pyright/)
  guide, for the rules that make up its strict mode.
- The agent files of ruff and uv: exact verify commands, snapshot
  discipline, narrow tests first.
- The [Rust baseline](../rust/README.md), whose CLI contract and error shape
  this template follows, so agents meet the same rules in both.
