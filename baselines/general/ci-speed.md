# CI and local check speed

How to keep CI and local checks proportional to what a PR changes, for new
projects and for existing ones. The question came from bursts of about 30
agent PRs of roughly 5 files each, every one running the full local check
and full CI. The guidance is drawn from measuring two of our repos in
October 2026; that evidence is summarized in the
[worked example](#worked-example) at the end.

Everything under [Every project](#every-project) is a default, and the
templates already do it. Two pieces are still untried and listed as
[explorations](../explorations/README.md#smaller-ones): moon for a mixed
Rust and JS repo, and a pass cache.

## The short version

- **Most waste isn't test selection.** It's CI running on drafts nobody is
  reviewing yet, setup that isn't cached (browsers, toolchains), and
  selectors that quietly fall back to "run everything". Fix those first.
- **Select tests only where a job is slow and its inputs are separable.**
  Use what the runners already do soundly: Vitest's module graph for JS,
  and the whole workspace (not a subset of crates) for Rust.
- **No Bazel or Buck2.** Our repos are far below the hundreds of targets
  they pay off at. Use **Turborepo** for a JS monorepo that needs a cache,
  pilot **moon** for a repo mixing Rust and JS with real dependencies
  between them, and use nothing for a single package.
- **No pass cache by default.** Skipping a check because its inputs passed
  before is a trust trade, not just an optimization
  ([below](#a-pass-cache-last-if-ever)).

## New projects

### Every project

These are cheap on day one and painful to retrofit. The [web](../web/template/)
and [Rust](../rust/template/) templates already do them.

- **One required gate job** that checks the other jobs' results. Jobs can
  then be split, skipped or renamed without touching branch protection.
- **Draft PRs skip CI.** Add `ready_for_review` and `converted_to_draft` to
  the `pull_request` types, and gate the work on
  `!github.event.pull_request.draft`. Converting back to draft then starts a
  run that cancels the one in progress. Agents open PRs
  as drafts, so a burst of 30 runs only the gate job, about a billable
  minute a push, until each one is marked ready.
  The gate still reports, and a draft can't merge anyway.
- **Cache setup, not results.** `rust-cache` with saves only from `main`,
  plus sccache for the workspace's own crates, which `rust-cache` drops
  ([details](../explorations/sccache.md));
  Playwright's browsers in `~/.cache/ms-playwright` keyed on the Playwright
  version, with `playwright install-deps` on a hit. A browser download
  normally takes 20–40 s but spiked to 8–10 minutes in one repo.
- **Per-step timings in the run summary**, so a slow step shows up before
  it's expensive.
- **A quick local check beside the full gate.** The web template's
  `pnpm verify:changed` typechecks the project (`tsc -b` is incremental),
  lints and format-checks only the changed files, and runs the Vitest tests
  the change reaches. `pnpm verify` stays the
  gate before handoff, and CI runs everything.
- **Tests a module graph can see.** Prefer in-process unit tests, which
  Vitest selects soundly. Keep tests that start processes or load files
  into a browser in a small integration tier that declares its inputs, or
  that always runs. In the worked example, 20 of 39 test files started
  processes, which made import-based selection unsound.

### By shape

| New project | Selection | Cache |
|---|---|---|
| Single web app (one package) | None in CI. `vitest --changed` locally. Keep end-to-end tests unconditional, and shard them if they grow | Browsers, pnpm store |
| Single Rust workspace | None. Test the whole workspace | `rust-cache` plus sccache in jobs that build tests or binaries (not clippy), both written only by `main` |
| JS monorepo (pnpm workspace) | `pnpm -r --filter "...[origin/main]"`: changed packages plus their dependents | Turborepo, when re-runs of unchanged packages start to cost |
| Rust and JS with real dependencies between them | A few lanes in one tested script, or pilot moon | Reuse built artifacts across languages, keyed by their inputs |

### What to avoid

- **`cargo test -p <subset>`.** Building a subset changes Cargo's feature
  unification, so shared dependencies recompile. It was 5× slower than the
  whole workspace (20 s against 4 s). Choose whether Rust runs at all, not
  which crates.
- **Path rules that fall back to "run everything" silently.** If you keep
  path → lane rules, keep them in one script with its own tests, and make an
  unmapped path fail a test. Scattered `paths:` filters drift.
- **`playwright --only-changed` as a gate.** It follows only the spec files'
  imports, so it misses app changes the browser reaches at runtime.
- **Heuristics such as "formatting-only change".** Selection has to be
  sound, or it's a skip that someone will eventually regret.

## Migrating an existing project

In order of payoff. Measure before each step, because the waste is rarely
where it looks.

1. **Measure.** Billable minutes per job over a month (the Actions jobs API,
   rounding each job up to the minute as GitHub bills). How many PRs run
   every job, and which paths made them. Local check time per step.
2. **Take the free wins:** drafts skip CI, cached browsers and toolchains,
   `cancel-in-progress` for superseded pushes.
3. **If there's a path selector, find its fallbacks to "full".** Typical
   offenders: stacked PRs, `scripts/`, `.github/`, shared actions,
   templates and manifests. Map each to the jobs that actually consume it,
   and have stacked PRs diff against their parent branch. In the worked
   example this was the biggest single win: −34% CI minutes per run.
4. **One classifier for CI and the local check.** The local check runs the
   same selection and prints what it skipped and why, so a reviewer can see
   what wasn't run.
5. **Reuse artifacts across languages.** A binary built in Rust and tested
   from JS doesn't need rebuilding when no Rust input changed. Have `main`
   save it under a key derived from its inputs, and have PRs only restore
   it.
6. **Make JS tests selectable.** Move them to Vitest so its module graph
   picks the affected tests, and split process-starting tests into an
   integration tier. If some can't be split, record what each test loads
   with `c8 vitest run` on `main` and select from that map
   ([details](#libraries-and-tools)).
7. **Big migrations, such as changing test runners:** one setup PR, then
   batches based on `main` rather than stacked, then a teardown PR. Changes
   to the CI tooling itself usually run every job, so landing an
   optimization costs a full run. Weigh that against what it saves.
8. **A pass cache, last if ever** (below).
9. **A build tool** only when the [switch conditions](#switch-to-a-build-tool-when)
   hold.

### A pass cache, last if ever

A pass cache keys each job by a hash of its inputs and skips the job when
that hash already passed. It's the remote-cache half of what Nx, Turborepo
and moon sell, and about 80 lines on top of a lane map. But it reverses a
common CI rule, that an old green run doesn't vouch for a new commit. It
has to settle:

- **who writes markers others trust:** only `main`, with a PR's own markers
  reused only within that PR;
- **how the gate reports a cached job:** as a named success, never as
  skipped;
- **inputs outside the tree:** network, clock and runner image. Release
  and benchmark jobs usually aren't cacheable;
- **flaky tests:** a cached flaky pass hides the flake;
- **what reviewers see:** which jobs were cached.

The key must cover what was actually tested: the inputs' Git tree IDs, the
toolchain and lock files, OS and architecture, and the files that define
the job (its script and the workflow). `git rev-parse HEAD:<dir>` is right
in CI, where the checkout is clean, but locally it ignores uncommitted and
untracked edits. There, hash the working tree through a temporary index
(`GIT_INDEX_FILE`, `git add -A`, `git write-tree`), or allow no hits while
the worktree is dirty.

## Libraries and tools

Checked in October 2026.

| Approach | Fit |
|---|---|
| Bazel, Buck2 | No: BUILD files everywhere, and the payoff needs hundreds of targets |
| Pants | No: its Rust backend is experimental |
| Nx (`nx affected`) | Plausible for JS; Cargo only through a community plugin. Its value is Nx Cloud's cache |
| Turborepo (`--affected`) | JS monorepos. Its remote cache can be self-hosted on R2 |
| moon (`--affected`, v2) | The best fit for Rust plus JS: one binary, per-task inputs, local and remote cache. Untried; its v2 toolchain plugins are new |
| Vitest `related` / `--changed` | Sound selection for JS unit and Storybook tests. Use it |
| c8 (`c8 vitest run`) | Records what each test loads, including in processes the test starts (it sets `NODE_V8_COVERAGE` for the whole process tree). The fallback when tests can't be tiered. Unverified with Vitest's `forks` pool and sourcemaps |
| `@vitest/coverage-v8` | Same V8 data, but may not follow child processes; unchecked |
| Datadog Test Impact Analysis | No: no `node:test`, no Vitest browser mode, child processes not covered, and a paid service that receives the coverage data |
| CloudBees Smart Tests | No: selects with a trained model, a heuristic |
| Vite+ | Bundles Vite, Vitest, oxlint and oxfmt with a task runner, but no affected selection and no Cargo tasks |

No ready-made tool selects tests across child processes. So use libraries
for the hard parts and keep the glue small.

## Cost

GitHub Actions is free for public repos on standard runners. A private repo
pays $0.006 per Linux minute beyond its plan's included minutes (3,000 on
GitHub Pro). The repo in the worked example used about 9,500 minutes a
month: roughly $39 of overage, or about $20 with a third cut. **The money is
small.** The real gains are PR latency and local CPU when many agents run
checks at once. [Blacksmith](../explorations/blacksmith.md) stacks on top: it makes the
remaining minutes cheaper, and this makes there be fewer of them.

## Switch to a build tool when

- a repo passes roughly 15–20 projects with real dependency edges between
  them, so hand-kept path rules get missed: **moon** for Rust plus JS,
  **Turborepo** for a pure pnpm monorepo;
- many sibling PRs share the same job inputs, so a cache shared across PRs
  matters: a self-hosted remote cache on R2.

Bazel and Buck2 stay out unless a repo reaches hundreds of targets or needs
hermetic remote execution.

## Worked example

The evidence behind the rules above, measured on 2026-10-27.

**A Rust CLI repo** with an npm wrapper package and a web viewer: 9 crates,
2 packages, private.

- **CI:** 8,283 billable minutes from 1 to 27 October, about 9,500 for the
  month. It already had a path → lane selector, but it ran every job on 65
  of 100 PRs: 27 because stacked PRs always ran everything, and 38 because
  `scripts/`, `.github/`, actions, templates and manifests all mapped to
  "everything". A one-line edit to a Node test under `scripts/` ran the
  22-minute release build.
- **Mapping those paths** and diffing stacked PRs against their parent cut
  CI minutes per run from 41.9 to 27.8 (−34%) and wall-clock from 18 to
  13 minutes, in a replay of October's PRs. It also took the release build
  from 66 PRs to 30. The replay used each PR's diff against its own base
  branch, with lane costs from October's per-job averages; the script
  wasn't kept.
- **Local check:** 308 s warm; half was `cargo test`. The same mapping cut
  the average to 188 s (−39%). Rust compiling was cheap locally: 47 s cold,
  and 1–7 s incremental.
- **TypeScript:** a change reached a median of 1 of 39 test files through
  imports. But 20 of the 39 started processes and 2 loaded files into a
  browser, so imports alone couldn't select them. The npm job also rebuilt
  the CLI on every run, because 10 tests ran the real binary.
- **Outcome:** reusing `main`'s CLI build in the npm job has landed. The
  path mapping and selected local checks are going ahead, along with a move
  from `node:test` to Vitest. The pass cache is paused over the trust
  questions above.

**A single Vite app:** one CI job of about 2.5 minutes, most of it
installing Playwright's browser, which spiked to 487 s and 611 s on two
runs. Test selection would have saved under a minute; caching the browser
saves more.
