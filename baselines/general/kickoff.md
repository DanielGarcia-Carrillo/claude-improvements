# Kickoff questions

Ask these before choosing infrastructure. Each answer selects something
concrete; the right column says what. Skip a question when the answer is
already obvious from the brief, and say which default you assumed instead.
Record the answers in the new repo's `docs/adr/0001-stack.md`.

Ask in one batch, grouped as below, with a recommended answer for each so
the user can accept defaults quickly.

## Every project

| Question | Decides |
|---|---|
| What is it, in one sentence, and who uses it? | README opening, naming, the agent file's first paragraph |
| Prototype, personal tool, or something others depend on? | How much of the baseline to adopt now vs later (release tooling, ADRs, visual tests) |
| Public or private repo? | CI minutes (free on public), secret handling, licence |
| Where are issues filed (Linear team/project, GitHub Issues)? | The agent file's "Ways of working", commit and PR naming |
| Solo, or other humans reviewing? | PR template, review gates, CODEOWNERS |
| Any hard constraints: budget ceiling, existing accounts, data residency, compliance? | Hosting and database choice |

## Web apps

| Question | Decides |
|---|---|
| Does it need to work offline? Fully offline-first, or just cache the shell? | Service worker strategy, local storage, sync engine |
| Does content need SEO or link previews (public pages indexed by search engines)? | Static generation or SSR vs a client-rendered SPA |
| Is there server-side data? Read-only, CRUD, realtime, multi-device sync, collaboration? | No backend / Worker API / sync database (see [infra.md](infra.md)) |
| Accounts and auth? Who signs in and how? | Auth provider, whether a backend is needed at all |
| Any personal or sensitive data? | Storage location, encryption, logging rules |
| Primary devices: phone, desktop, both? Installed as an app? | Layout shells, manifest, touch targets, perf budget |
| Which languages and regions? (Default: English UI, locale-correct dates, numbers and units.) | i18n library or plain `Intl` |
| Third-party APIs to call? Do they publish OpenAPI? | Typed client generation, proxying through a Worker |
| Expected traffic and data size? | Plan tier, caching, whether the free tier suffices |
| Is any of it published to npm as a package? | `tsc` with `isolatedDeclarations`, a hand-written `exports` map, publint and a packed-consumer type test ([recipe](../web/README.md#publish-an-npm-package)) |

## Rust tools

| Question | Decides |
|---|---|
| CLI, library, or both? | Single crate vs workspace with a `-cli` crate; lint strictness for public API |
| Who runs it: humans, agents, CI? | Output contract: human text, `--json`, exit codes |
| Target platforms? | CI matrix, release targets, whether to avoid system deps |
| How is it distributed: `cargo install`, prebuilt binaries, Homebrew, an npm wrapper? | Release tooling (cargo-dist, release-plz) |
| Published to crates.io? | `publish`, semver checks, docs requirements, MSRV policy |
| Async or network I/O needed? | Whether tokio comes in at all |
| Config files or environment variables? | Config crate and error reporting for bad input |

## Python tools

| Question | Decides |
|---|---|
| CLI, library, or a pipeline of scripts? | The template's CLI as is, or a package without `[project.scripts]` |
| Who runs it: humans, agents, CI? | Output contract: human text, `--json`, exit codes |
| Published to PyPI, or used in place? | The `Private` classifier, `requires-python` range, a CI leg per Python, trusted publishing |
| Which Python versions must it run on? | `.python-version` and `requires-python` |
| Native dependencies (GDAL, Cairo, CUDA)? | System packages in CI and the README; whether uv's wheels cover every platform |
| Does it validate outside data (files, APIs)? | Pydantic or msgspec at the boundary, or plain dataclasses |

## After the answers

1. Pick the baseline ([web](../web/README.md), [rust](../rust/README.md),
   [python](../python/README.md)) and
   copy its `template/` into the new repo (see the [README](../README.md#starting-a-project)).
2. Write `docs/adr/0001-stack.md` with the answers and every default you
   kept or changed.
3. Fill in the agent file from [`CLAUDE.template.md`](CLAUDE.template.md).
4. Set the repo's commit email to the GitHub noreply address
   ([Git identity](infra.md#git-identity)).
5. Run the repo's verify command once green before the first commit.
