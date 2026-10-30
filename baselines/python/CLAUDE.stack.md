<!--
Python stack fragment. Splice each section into the matching
"stack fragment" marker of general/CLAUDE.template.md, rename `replace-me`
and `replace_me`, and delete these comments.
-->

## Commands

```bash
just verify                                # spelling, format, lint, types, deps, tests: the gate
uv run pytest tests/test_width.py -k NAME  # narrowest test first, then widen
just fix                                   # ruff's safe fixes, then formatting
just snapshots                             # rewrite changed inline snapshots, then rerun
uv run replace-me check FILE --json
uv add NAME                                # or `uv add --dev NAME`; never pip install
```

Python comes from `.python-version`, uv and just from `mise.toml`
(`mise install`), and every other tool from `uv.lock`. Run them through
`uv run` or `just`, never a global `python`, `pip` or `ruff`.

Spelling: `typos` enforces American English, including hooks and CI config.
It runs in verify, CI and edit/stop hooks; `mise install` installs its pinned version.

Lefthook checks staged files, re-stages formatter fixes, and checks spelling.
After `mise install`, run `just bootstrap` in every clone. Keep the full
verify gate before handoff; the pre-commit is a fast file check.

## Conventions

- **Layout**: logic lives in private modules (`_width.py`, `_errors.py`),
  re-exported from `src/replace_me/__init__.py`, which is the one import
  path for each public name. `cli.py` parses and dispatches; `_output.py` is
  the only module that prints. New logic goes in a private module with unit
  tests; the CLI only wires it up.
- **Dependencies** are added with `uv add` (or `uv add --dev`), with
  `uv.lock` committed alongside. A new runtime dependency is a decision:
  justify it in the commit. deptry fails on an import that isn't declared or
  a declaration nothing imports.
- **Types everywhere.** Every function is annotated (ruff `ANN`), `Any` is
  banned in annotations (`ANN401`), and a bare `list` or `dict` fails ty.
  Parse untyped input at the boundary into a typed class, as `cli.py` does
  with argparse's namespace, and trust the types inside.
- **Suppressions name the rule and the reason**, and only after trying the
  fix: `# noqa: CODE  <why>`, `# ty: ignore[rule]  <why>`. A blanket or
  unused one fails. A rule that is wrong for the repo changes in
  `pyproject.toml` in its own commit.
- **Nothing prints outside `_output.py`.** `print` (T201) and `sys.stdout`
  or `sys.stderr` (TID251) fail anywhere else; log with `logging`.
- **Errors**: subclass `replace_me.Error` with a stable `code` and a `hint`,
  and raise it `from` the cause, which the message doesn't repeat. Error
  codes are part of the CLI contract: never change or reuse one.
- **The CLI contract** lives in `src/replace_me/_output.py`: one JSON
  document on stdout with `--json`, logs and text-mode errors on stderr,
  exit 0 clean / 1 findings / 2 error / 70 bug. Every case has a snapshot in
  `tests/test_cli.py`.
- **Snapshots are rewritten, never hand-edited**: `just snapshots`, then
  review the diff. A changed CLI snapshot is a contract change and says so
  in the PR.
- **No TODO comments** (FIX002): finish the work, or open an issue for it.
- **Docs describe the code, not its history.** No design journals, no "as
  discussed", no tests that only restate a constant.

## Traps

- **`uv run` syncs the environment first.** Under `just` and in CI,
  `UV_LOCKED=1` makes a `pyproject.toml` that no longer matches `uv.lock`
  fail instead of re-resolving: run `uv lock` after editing dependencies by
  hand. A `pip install` into `.venv` is undone by the next sync.
- **ty is pre-1.0.** A ty upgrade can add or change diagnostics; fix them in
  the upgrade's PR. It doesn't flag importing a name a module only imported
  itself (mypy's `no_implicit_reexport`): import from where it is defined,
  or from the package.
- **inline-snapshot's run that writes a snapshot fails.** `just snapshots`
  runs the tests again to show they pass.
- **Advisories run on main and weekly, not on PRs or in `just verify`**, so
  a fresh advisory shows up as a red main build, not on your branch.
  `just audit` checks them now (`uv audit`, experimental in uv 0.13).
- **Tests run the CLI as `python -m replace_me`**, the same entry point as
  the `replace-me` script, so they don't depend on the script being on
  `PATH`.
