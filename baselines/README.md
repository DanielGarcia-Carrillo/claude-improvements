# Project baselines

Starting points for new projects: engineering principles, the questions to
ask before choosing infrastructure, agent-file skeletons, and working
templates with their configs. Everything is tuned for agent-driven work:
strict, local, fast checks whose failures say how to fix them.

| Path | What |
|---|---|
| [general/principles.md](general/principles.md) | Errors as the interface for agents, dependencies, implementation ethos, ways of working |
| [general/kickoff.md](general/kickoff.md) | Requirement questions to ask before choosing infrastructure |
| [general/infra.md](general/infra.md) | Hosting (Cloudflare), data, CI, toolchains, Claude Code mechanisms |
| [general/ci-speed.md](general/ci-speed.md) | Keeping CI and local checks proportional to a change: defaults for new projects, steps for existing ones |
| [general/CLAUDE.template.md](general/CLAUDE.template.md) | Skeleton for a new repo's `CLAUDE.md` |
| [general/files/](general/files/) | Editor and Git settings, shell quality checks, PR template, ADR template |
| [explorations/](explorations/README.md) | Options under evaluation, not yet defaults: Renovate, UI primitives, visual regression, Blacksmith, observability, tsrs and smaller ones |
| [web/](web/README.md) | React PWA on Cloudflare: stack decisions, agent fragment, runnable template |
| [rust/](rust/README.md) | Rust CLI/library workspace: defaults, agent fragment, runnable template |
| [python/](python/README.md) | Python tool, script or pipeline on uv, ruff and ty: defaults, agent fragment, runnable template |
| [scaffold-check/](#scaffold-check) | Pinned lockfiles for the scaffold check; never copied into a project |

## Starting a project

1. Ask the [kickoff questions](general/kickoff.md), in one batch, with a
   recommended answer for each.
2. Copy `general/files/` and the stack's `template/` into the new repo, and
   follow the stack README's "Using it" steps.
3. Build `CLAUDE.md` from [the skeleton](general/CLAUDE.template.md) plus the
   stack's `CLAUDE.stack.md`, then `ln -s CLAUDE.md AGENTS.md` so other
   agents read the same file.
4. Record the answers and every kept or changed default in
   `docs/adr/0001-stack.md`.
5. Set the repo's commit email to your GitHub noreply address
   (`git config user.email <id>+<username>@users.noreply.github.com`) unless
   it is set globally; see [Git identity](general/infra.md#git-identity).
6. Run the verify command green before the first commit.

## Scaffold check

`mise run scaffold:verify` answers, for each template: does it still
scaffold into a project that passes its own verify? It scaffolds the stack
through [`/new-project`](../mods/new-project/README.md) with the test
answers into a temporary folder, puts in the stack's pinned lockfile from
`scaffold-check/<stack>/`, and runs the mod's setup with frozen installs
(`pnpm install --frozen-lockfile`, `cargo fetch --locked`,
`uv lock --locked`) and no version bumps. Setup ends in the project's real
verify: `pnpm verify` with its end-to-end tests, or `just verify`. Name stacks
to run only those (`mise run scaffold:verify python`); `--keep` keeps the
project. The `scaffold` workflow runs it on every pull request that isn't a
draft and on main, one job per stack.

- **What it guarantees.** With the versions pinned, a red run means the
  change under test broke a template, the mod, or how they fit together. A
  rule renamed in a template's config but not in its tool fails here, before
  any new project hits it.
- **What it doesn't catch: upstream drift.** The templates ship without
  lockfiles, and `/new-project` takes the newest releases and new majors, so
  a release that breaks a new project passes this check until a lockfile
  takes it. A scheduled job that scaffolds with the newest versions, apart
  from this one, would cover that; it doesn't exist yet. Tools pinned by
  major or minor only also float: Node (`node = "26"` in the web
  `mise.toml`) and Python (`.python-version` says `3.15`, so uv takes the
  newest patch).
- **Where the pins live.** `scaffold-check/<stack>/` holds the lockfile and
  copies of the manifests the scaffold writes it from (`package.json` and
  `pnpm-workspace.yaml`, the `Cargo.toml` files, `pyproject.toml`), with the
  test answers' names. Nothing copies it into a project: the scaffolder reads
  only `general/files/` and `<stack>/template/`. Dependabot
  (`.github/dependabot.yml`, `lockfile-only`) proposes new versions inside the
  templates' ranges weekly, as pull requests this check runs on.
- **After changing a template's dependencies,** or any manifest the check
  pins, it fails and names the files. Run
  `mise run scaffold:verify --refresh <stack>`: it installs without freezing,
  starting from the old lockfile so only what changed moves, writes the
  lockfile and manifests back, and runs verify. Commit what it writes.

## Where it started

Two pages set the starting points:
- Christoph Nakazawa's
  [Fastest Frontend Tooling](https://cpojer.net/posts/fastest-frontend-tooling),
  for the web toolchain;
- Microsoft's
  [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines/guidelines/checklist/index.html),
  for Rust.

Each stack README ends with its sources, and
[principles.md](general/principles.md#sources) credits the ideas it borrows.

## Conventions in this folder

- Every stack's verify command checks shell scripts with ShellCheck and
  shfmt, and workflows with actionlint. Composite actions (`action.yml`) are
  checked the same way: actionlint does not read them, so yq copies each
  one's `runs.steps` into a generated workflow, and errors name the action's
  own line and step. Steps in shells other than `bash` and `sh` are counted
  as skipped. These tools, and yq, are pinned in each
  `mise.toml`; the shared `.shellcheckrc` and `scripts/check-shell.sh` come
  from `general/files/`. The scanner includes hidden files and extensionless
  shell scripts, honors Git ignores and also works before the first commit.
  `just shell-fix` (Rust/Python) or `pnpm shell:fix` (web) formats shell files.
  Lefthook formats and lints staged shell files before checking spelling;
  extensionless scripts, workflows and composite actions are covered by full
  verify.
- ShellCheck enables checks for masked exit statuses, suppressed `set -e`,
  unassigned uppercase variables, Bash `[[ ]]`, consistent quoting and
  explicit string tests. Validate required environment variables with
  `${NAME:?message}` and explain any local suppression. Keep the default
  severity coverage. `justfile` recipes and package-script strings are not
  shell files: move substantial shell logic into a checked script.
- Agent files are named `*.template.md` and `*.stack.md`, never `CLAUDE.md`,
  so Claude Code does not load them as instructions while working in this
  repo. The templates' `.claude/settings.json` and workflows are inert here
  for the same reason: only a repo root's copies take effect.
- The web and Rust templates passed their full verify from a fresh copy on
  2026-10-23 (web: `pnpm verify`, 47 unit and story tests plus 7 end-to-end;
  Rust: `just verify`, 19 tests plus a doctest, cargo-deny, cargo-shear), and
  the Python template on 2026-10-27 (`just verify`, 24 tests plus a doctest,
  ruff, ty, deptry). The [scaffold check](#scaffold-check) now runs that
  for every pull request; run `mise run scaffold:verify` when changing a
  template.
- Versions, prices and "still beta" notes are dated. When a decision rests
  on one, re-check it rather than trusting the date here.
