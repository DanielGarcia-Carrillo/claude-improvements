# Affected-only builds (exploration)

Status: **partly adopted** (see [Status](#status)). Draft recommendation:
**don't adopt a build system; tighten the lane selectors we already have and
add a content-hash pass cache. For TypeScript, also split tests into tiers
Vitest can select, and reuse `main`'s CLI binary**
([below](#typescript-where-selection-pays)). Measured on 2026-10-27 against
two of our repos: a Rust CLI with an npm wrapper package and a web viewer
(9 crates, 2 packages; "the CLI repo" below) with its October CI history,
and a single Vite app with its last 12 green runs. The method is described
under each table so it can be re-run.

## Status

Two pieces are going ahead in the CLI repo, in this order:

1. **Reuse `main`'s CLI binary and cache Playwright's browser in CI**
   ([items 4–5 below](#before-the-vitest-migration)).
2. **Move the npm package's tests from `node:test` to Vitest**, based on
   `main`: one setup PR, about 6 batches, and a teardown PR. Locally each
   batch runs its changed tests plus lint; the setup and last PRs run the
   full smoke.

The selector mapping, smoke selection and pass cache
([Recommendation](#recommendation)) are paused: "I don't think it's fully
thought out yet" (Daniel, 2026-10-27). They change deliberate choices in
the CLI repo's CI policy: stacked PRs run every lane, the macOS smoke stays
a full pre-merge requirement, and an old green SHA doesn't vouch for a
rebased one.

A pass cache has to settle five things before it fits that policy:

- only `main` writes markers that other PRs trust;
- the gate reports a cached lane as a named success, never as skipped;
- lanes with inputs outside the tree (release, bench) aren't cached;
- whether a lane that needed a retry can be cached;
- reviewers can see which lanes were cached.

An open question is whether some PRs still need `smoke --all` before
merge: the top of a stack, or a PR whose selection fell back to full.

**Keep visual regression capture unconditional.** A capture job that skips
screens publishes an incomplete baseline on `main` and can't be signed off
on a PR. So a template must not put a visual capture step behind
affected-only selection until there is a sound way to map app source files
to the page tests they affect.

## The question

About 30 agent PRs of roughly 5 files each ran the full local smoke and full
PR CI. Can smoke and CI run only what the changed files affect, directly or
transitively, and what would that save?

## Where the time goes today

### The CLI repo's CI

Billable Linux minutes from 1 to 27 October, summed per job and rounded up
per job as GitHub bills them:

| Workflow | Minutes |
|---|---|
| `ci` on pull requests (331 runs) | 5,352 |
| `ci` on pushes to `main` (76 runs) | 2,829 |
| Cache maintenance, approvals | 102 |
| **Total** | **8,283** (about 9,500 for a full month) |

Per job: test 1,704, release build 1,693, npm wrapper 1,605, bench 1,411,
viewer self-capture 805, bookkeeping jobs the rest.

The repo already has an affected-lane selector (`scripts/ci-policy.py`), so
this isn't a missing feature. **It runs everything on 65 of the last 100
PRs**:

- **27 are stacked** (base isn't `main`); the selector deliberately falls
  back to full validation for them.
- **38 touch a path mapped to "full"**: `scripts/` (71 file touches, mostly
  standalone `scripts/*.test.mjs`), `actions/`, `templates/`, `.github/`,
  manifests and lockfiles. A one-line edit to a Node unit test under
  `scripts/` runs Rust, npm, the full bench and the 22-minute two-pass
  release build.

Draft PRs run no lanes; the billed runs are the one when a PR is marked
ready, later pushes to it, and the selected lanes again on `main` after
merge.

### The CLI repo's local smoke

`pnpm smoke` (35 steps) on this Mac with a warm `target/`: **308 s**.

| Steps | Time | Share |
|---|---|---|
| `cargo test` workspace + filesystem-only | 151 s | 49% |
| `pnpm -r test` | 61 s | 20% |
| `node --test scripts/*.test.mjs` | 34 s | 11% |
| Corpus frame check | 15 s | 5% |
| The other 31 steps | 47 s | 15% |

Rust compiling is cheap locally: cold `cargo test --no-run` took 47 s in a
fresh worktree, and incremental rebuilds after an edit took 1–7 s. The cost
is test execution. With 30 agents each running smoke, that time is paid in
parallel on one machine, so CPU contention multiplies it.

### A single Vite app

270 files with one CI job. `pnpm verify` takes about 2.5 minutes in CI. The
cost is `playwright install --with-deps chromium`, which takes 22–42 s
normally and spiked to 487 s and 611 s on the two most recent runs. Test
selection would save under a minute per run here; caching the browser (or
running in the Playwright container image) saves more.

## Options

| Approach | What it selects by | Fit here |
|---|---|---|
| Bazel, Buck2 | File-level action graph, remote cache and execution | No. Every crate and package needs BUILD files plus a rules_rust / rules_js toolchain, and the payoff needs hundreds of targets. The CLI repo has 9 crates and 2 packages. |
| Pants | File-level for Python, Go, JS; Rust unsupported | No: the CLI repo is mostly Rust. |
| Nx (`nx affected`) | Project graph from `package.json`; Cargo via a community plugin | Plausible, but its value is Nx Cloud's remote cache. Another daemon and config tree. |
| Turborepo (`turbo run --affected`) | pnpm workspace graph | JS only; cargo would have to be wrapped as package scripts. Its remote cache can be self-hosted on R2. |
| moon (`moon ci`, `--affected`) | Project graph with first-class Rust and Node | The best fit if we adopt a tool: one Rust binary, per-task input globs, local and remote cache. |
| **Path → lane selector + content-hash pass cache** | Lanes (rust, node, viewer, bench, release, scripts) declared as path globs | **Recommended.** The repo already has the selector and its test suite. The fix is mapping, not graph resolution. |
| Runner built-ins | `vitest --changed` and `vitest related` (module graph), `playwright --only-changed` (imports of test files only), `cargo test -p` | Vitest's are sound and worth using. Playwright's misses app-code changes that end-to-end tests reach through the browser, so it can't gate alone. `-p` is a trap here (below). |

### Why finer Rust selection doesn't pay

In a warm worktree, after editing a storage-backend crate:

| Command | Time |
|---|---|
| `cargo test --workspace --no-run` | 4 s |
| `cargo test -p <storage crate> -p <cli crate> --no-run` | **20 s** |

Selecting a subset of crates changes Cargo's feature unification, so shared
dependencies recompile with a different feature set, and the run is slower
than the whole workspace. (cargo-hakari fixes that, at the cost of a
workspace-hack crate.) The CLI crate depends on every other crate and is the
one most PRs touch (374 file touches in October), so a crate graph would
select almost all of it anyway. The useful split for Rust is the existing
one: whether the Rust lane runs, not which crates.

### TypeScript: where selection pays

TS PRs are where finer selection helps most. Formatting PRs rarely break
anything, and detecting "formatting only" is a heuristic we don't want.

**Why a TS PR runs everything today.** Of October's 49 PRs touching TS:

- **The release build never comes from TS itself.** 17 of the 49 got it
  because they were stacked, and 7 because they also touched `scripts/`,
  `.github/`, `actions/`, `templates/` or `package.json`. Only 1 got it from
  a real packaging file (`resolve-binary`).
- **The npm wrapper job is all-or-nothing.** It always builds the CLI and
  the renderer (about 75 s in CI), installs Chromium, and runs
  `pnpm -r test`: all 39 npm-package test files plus the viewer's tests,
  about 334 s. It builds the CLI because 10 of the 39 test files run the
  real binary, and nothing selects which tests run.
- **Viewer TS selects Rust.** A viewer source change regenerates the bundle
  committed inside the CLI crate. The selector reads that as a crate change
  and runs the whole Rust lane plus bench smoke (12 PRs). Only the CLI crate
  embeds the bundle, so other crates' tests, clippy and the bench can't be
  affected by it.

**The import graph.** Built for the npm package on `main`, with committed
`lib/` and `bin/` files merged into the `src/` modules they're compiled
from. Run over the October PRs, a change reaches a median of **1 of 39**
test files; most reach 1–6 and the largest reached 15. Static imports alone
are unsound, though:

- **20 of the 39** test files start processes (the CLI, fixture runners,
  Playwright), whose code is loaded at runtime, not imported;
- **2** load source files into a browser page.

`playwright --only-changed` has the same blind spot, and so does mapping app
source files to visual regression page tests.

**Preferred: split the tests into tiers on Vitest 5.** Make the selection
problem one a well-tested tool already solves:

- **Unit tier:** tests that call the code in-process. Vitest picks these
  from its own module graph (`vitest related`, `--changed`), with no
  coverage map. The 20 process-starting tests move their logic checks here.
- **Integration tier:** a small set that starts the CLI, fixture runners or
  Playwright. Each declares its inputs (the binary plus named modules), or
  the whole tier runs whenever package source changes.
- **Runner:** the npm package moves from `node:test` to Vitest 5, and the
  viewer moves from Vitest 4.1 to 5 with it. Both packages then share one
  runner. The web template is already on Vitest 5. The repo is already on
  Vite 8; no Vite change is needed.

Porting about 40 test files and rewriting the process-starting ones is the
cost.

**Fallback: a recorded map of what each test loads.** Use this only if some
tests can't be split. On `main`, run each test file with
c8 (`c8 vitest run`) and store the map from test file to loaded files as a
CI artifact. A PR then runs:

- tests whose recorded files intersect the diff;
- tests that are new or missing from the map;
- every test when the map is stale or its tooling changed.

Files loaded into the browser are declared explicitly, the way
`ci-policy.py` already declares the PNG decoder that Rust tests read at
runtime. A tripwire test keeps those declarations complete, as the existing
viewer import walk does. With the tiers in place, the same coverage run is
only an optional check that the integration tier's declared inputs are
complete.

**Binary reuse.** The CLI binary depends only on the Rust lane's inputs.
Key it by their tree hash. When no Rust input changed, the npm job downloads
`main`'s binary for that key instead of building, and skips the Rust
toolchain and `rust-cache` restore.

**Viewer bundle as its own input.** A change to the committed bundle alone
selects the viewer lane and the CLI crate's tests, not the workspace or the
bench.

**Library or homegrown.** Checked on 2026-10-27. No ready-made tool selects
tests across child processes, so: well-used libraries for the hard parts,
plus a small amount of our own glue.

| Piece | Use | Homegrown part |
|---|---|---|
| Lane selection (stacked PRs, `scripts/`, viewer bundle) | `ci-policy.py`, already homegrown and tested | Mapping changes |
| Choosing unit tests | Vitest 5's module graph (`vitest related`, `--changed`) | None |
| Integration-tier inputs | Declared per test, like `ci-policy.py`'s existing runtime edges | A list plus a tripwire test |
| Recording what each test loads (fallback, or the tripwire check) | c8 (ISC; 2.1k stars, about 3.5M npm downloads a week) wrapping Vitest: `c8 vitest run`. c8 sets `NODE_V8_COVERAGE` for the whole process tree, so it also records code in the CLI and runner processes that tests start | A `main`-only step that stores the map (about 100–200 lines) |
| Reusing the CLI binary | `actions/cache`: `main` saves it under a key from the Rust inputs' tree hash; PRs only restore | About 20 lines of YAML |

**Decision (Daniel, 2026-10-27): Vitest plus c8; Vite+ isn't needed.**
Other libraries read the same V8 data. Vitest's own `@vitest/coverage-v8`
(about 39M downloads a week, used by the web template) may not follow
processes that tests start; that's unchecked. c8 does follow them, which is
the point of the map.
[monocart-coverage-reports](https://github.com/cenfun/monocart-coverage-reports)
also covers Chromium pages, but those files are declared instead.

Rejected:

- **[Datadog Test Impact Analysis](https://docs.datadoghq.com/tests/test_impact_analysis/)**
  is the same idea, built on per-test coverage. [Its JS
  support](https://docs.datadoghq.com/tests/test_impact_analysis/setup/javascript/)
  covers only Jest, Mocha, Cucumber, Cypress and Vitest. It doesn't list
  `node:test`, which the npm package uses, and it excludes Vitest browser
  mode. Its [Ruby docs](https://docs.datadoghq.com/fr/tests/test_impact_analysis/setup/ruby/)
  say code in child processes isn't covered, and 20 of the 39 test files
  start one. It's also a paid SaaS that receives the coverage data.
- **CloudBees Smart Tests** (formerly Launchable) selects tests with a
  trained model, a heuristic we've ruled out. Pricing is by quote.
- **Smaller open-source tools:** jev-test-impact scores likely-affected
  tests rather than tracing them, siftwise selects only Python and Go
  tests, and the rest target Java. Their maturity wasn't checked.
- **moon, Turborepo, Nx** would provide the binary caching, but they select
  whole packages and would replace a selector that already works. That
  changes if the package is split (below).
- **Vite+** (MIT, 1.4) bundles the same Vite, Vitest, oxlint and oxfmt the
  repo already uses, plus a cached task runner (Vite Task). It has no
  affected selection and no Cargo tasks, and it pins its bundled versions.
  Not needed for now.

Further restructuring, only if the tiers leave selection too coarse:

- **Split the npm package into private workspace packages** along its
  existing exports: core (snapshots, PNG, hashes, types), Playwright,
  Vitest/Storybook, and binary/CLI. Each declares its dependencies, which
  makes package-level selection sound. The packages are bundled back into
  the published package, so its `exports` don't change. It's still a change
  to the npm contract and needs a design review.
- **moon** (v2, remote cache stable) models the Rust CLI build as a task
  whose output the JS integration tests depend on. Its cache then provides
  the binary reuse and the pass cache. `ci-policy.py`'s special cases become
  declared task inputs. Costs: v2's toolchain plugins are fairly new, the
  CI policy's gate semantics have to be re-expressed, and the supported
  remote-cache backends weren't checked.

Open risks:

- c8 wrapping Vitest is unverified on this repo. Check that Vitest's
  `forks` pool inherits `NODE_V8_COVERAGE` and that sourcemaps map the
  coverage back to the `.ts` sources.
- Recording one map per test file means running the files one at a time,
  which is slower. That runs only on `main` or nightly.

For a package-only TS PR, these three changes plus stacked PRs diffing
against their parent bring CI down from about 13 minutes (54 if stacked) to
about 3–4. Local smoke drops from about 5 minutes to about 1. Those are
estimates; none of it has been built.

## Before the Vitest migration

Moving about 40 test files to Vitest means many PRs that change mostly
tests. Run through the current selector, the files such a PR touches cost:

| Path (npm package) | Lanes selected today |
|---|---|
| `test/*.test.ts`, `test/support/*` | node |
| `vitest.config.ts` | unmapped → full |
| `package.json` (either package) | full |
| `pnpm-lock.yaml`, `scripts/smoke.sh` | full |
| `test/resolve-binary.test.ts`, `test/npm-pack.test.ts` | node + single-pass release |
| `test/viewer-capture/*` | node + viewer |
| `test/fixtures/pixelhash/*` | rust + node |
| the viewer's `vitest.config.ts` | node + viewer |
| `tsconfig.json` | node |

A test-only PR costs about 13 billable minutes, because the npm wrapper job
still builds the CLI, installs Chromium and runs all 39 test files. Stacked,
or touching config, `package.json`, the lockfile or `smoke.sh`, it costs
about 54. Local smoke is about 5 minutes either way.

Changes that would make those PRs cheaper, roughly in order of payoff:

1. **Stacked PRs diff against their parent.** Or base the migration PRs on
   `main` instead of stacking them; test files don't depend on each other.
2. **Map the migration's paths:**
   - the npm package's `vitest.config.ts` → node lane only.
   - A `package.json` change limited to `devDependencies` or `scripts` → node
     lane only. Changes to `files`, `exports`, `bin` or `version` keep
     today's packaging rule.
   - `scripts/smoke.sh` → no CI lane; CI never runs it.
   - The Vitest 5 bump, lockfile and shared config land together in one
     setup PR, so the full run is paid once.
3. **Test-only PRs run only the changed test files.** Product code never
   imports `test/`, so this is exact, not a heuristic:
   - add the tests that import a changed support file;
   - run every test if a fixture directory changes, since fixtures are read
     by path at runtime;
   - any change outside `test/` runs the full suite.

   That replaces the ~334 s `pnpm -r test` with a few seconds per file.
4. **Reuse `main`'s CLI binary** when no Rust input changed
   ([Binary reuse](#typescript-where-selection-pays)). The npm wrapper job
   skips Rust setup and both builds, about 75 s plus cache restore.
5. **Cache Playwright's Chromium in CI:** 39 s per run in the CLI repo, and
   it spiked to 487–611 s in the Vite app.
6. **Local smoke uses the same selection.** A test-only change runs only
   the JS steps for the changed files: about 20–40 s instead of 308 s.
7. **Per-file test times in both runners**, like the Rust test-time budget,
   so each migration PR shows whether Vitest is slower than `node:test` for
   that file. Convert and delete in the same PR, so no file runs under both
   runners.

Estimated cost of one migration PR:

| | CI (billable) | Local smoke |
|---|---|---|
| Today, stacked | ~54 min | ~5 min |
| Today, based on `main` | ~13 min | ~5 min |
| After 1–6 | ~3–4 min | ~20–40 s |

None of it has been run; the per-lane costs are October's averages.

Two catches:

- **Draft pushes are free**, so counting every push overstates the cost.
  The lever is fewer PRs.
- **Landing items 1–3 isn't free.** `ci-policy.py` and `ci.yml` live under
  `scripts/` and `.github/`, which select every lane, so each of those PRs
  is a full run. That's about what they would save over the migration.

**What was chosen.** Items 4 and 5 land first; they don't change what CI
checks. The migration is based on `main`, not stacked: one setup PR (the
Vitest bump, lockfile, the package's `vitest.config.ts` with a node-only
lane mapping, and the test script), about 6 test-only batches on the node
lane, and a teardown PR that removes `node:test`. The setup and teardown PRs
pay for every lane once. Instead of item 6, each batch runs its changed
tests plus lint locally, CI is the gate, and the setup and last PRs run the
full smoke. Item 7 is left to the implementer.

## Recommendation

### 1. Fix the selector mapping (CI and smoke)

- **Stacked PRs:** diff against the PR's base branch (the parent) instead of
  forcing every lane. The parent's own PR validates the parent's changes.
  When it merges, Graphite retargets the child to `main` and CI re-runs.
  Keep the merge-base check that already guards against a stale base.
- **`scripts/`:** give each script its consumer lane instead of "full". Add
  a cheap `scripts` lane (`node --test scripts/*.test.mjs` plus the Python
  policy tests, about 1.5 minutes in CI). Route only the release, Mach-O,
  npm-pack and Zig-install scripts to the release build, and only the test
  budgets, store-boundary check and CI inputs to Rust.
- **`actions/`, `templates/`, other workflows:** the `scripts` lane, plus
  `viewer` for `actions/lib/`. `ci.yml` itself, lockfiles and manifests stay
  full.
- **Smoke reads the same mapping:** `pnpm smoke` diffs against
  `gt parent` (or the merge base with `main`), runs the selected lanes,
  and prints which lanes it skipped and why, so the PR summary still shows
  what was checked. `pnpm smoke --all` keeps today's behavior.

Re-classifying the 100 October PRs with that mapping:

| | Today | With the mapping |
|---|---|---|
| CI minutes per PR run | 41.9 | 27.8 (**−34%**) |
| CI wall-clock per PR run | 18.0 min | 13.0 min |
| PRs running the release build | 66 | 30 |
| Local smoke per PR | 308 s | 188 s (**−39%**) |

The local distribution is wide. A `scripts/`-only PR drops to about 48 s, a
JS-only PR to about 99 s, and a PR touching a crate still runs about 276 s,
because it needs Rust and the npm wrapper's integration tests.

Method:

- **Files:** each PR's changed files as GitHub reports them, which is the
  diff against the PR's own base branch. For a stacked PR that base is the
  parent, the same diff the proposed policy and `gt parent` would use.
- **Today:** `ci_policy.select()` as it was on `main` on 2026-10-27, which
  forces every lane for a stacked PR.
- **With the mapping:** the same `select()` with the changes above
  applied: no forced full run for stacked PRs, and the `scripts/`,
  `actions/`, `templates/` and workflow rules as listed.
- **Costs:** lane costs come from October's per-job averages (CI) and from
  the timed smoke above (local), with each lane mapped to its smoke steps.
  Bench smoke and single-pass release are estimated at 4 and 8 minutes.

The simulation script wasn't kept, so re-running it means re-applying those
rule changes to the selector.

### 2. Skip lanes whose exact inputs already passed

Key each lane by a hash of the Git tree IDs of its input paths, plus:

- the toolchain and lock files;
- the OS and architecture;
- the files that define what the lane runs: the policy script, the smoke
  runner and the CI workflow.

On a green lane, record a pass marker under that key. Before running a
lane, look the key up, and skip the lane on a hit.

The tree IDs must describe the files the lane actually tested.
`git rev-parse HEAD:<dir>` is free in CI, where the checkout is clean. In a
local worktree it ignores uncommitted and untracked edits, so a dirty
worktree would match an old marker. Locally, hash the working tree instead:
`git add -A` into a temporary index (`GIT_INDEX_FILE`), then
`git write-tree` and `git rev-parse <tree>:<dir>`. Or simply allow no
cache hits while the worktree is dirty.

- **Locally** the marker is a file under `~/.cache/<repo>-smoke/`. Every
  worktree shares it. In a restacked 30-PR stack, each child whose Rust
  inputs match a tree some worktree already passed skips Rust. Re-running
  smoke after a review fix re-runs only the lanes the fix touched. This is
  where most of the local win beyond −39% comes from.
- **In CI**, `actions/cache` with `lookup-only` does the same. Cache scope
  limits it to re-runs within one PR and to trees `main` already passed.
  Sharing markers across sibling PRs needs an external store; Turborepo's or
  moon's remote cache on R2 is the off-the-shelf version, if it's ever
  needed.

This is the remote-cache half of what Nx, Turborepo and moon sell, in about
80 lines on top of a lane map the repo already maintains and tests.

### 3. The single Vite app

See [Web-only projects](#web-only-projects).

## New and web-only projects

### Web-only projects

A single Vite app, like the [web template](../web/template/), is one
package with one CI job. There's nothing to route between lanes, and a full
`pnpm verify` takes a few minutes. The waste is in setup and in running CI
on PRs nobody is looking at yet, not in which tests run. In order of
payoff. The web template does the first two.

1. **Skip CI on draft PRs.** Agents open PRs as drafts, so this is where a
   burst of 30 PRs costs nothing until each one is marked ready. Add
   `ready_for_review` to the `pull_request` types and gate the verify job
   on `!github.event.pull_request.draft`. The required `ci` job still
   reports, and a draft can't merge anyway.
2. **Cache Playwright's browsers.** Instead of running
   `playwright install --with-deps chromium webkit` every time, cache
   `~/.cache/ms-playwright` keyed on the Playwright version in the
   lockfile, and on a hit run only `playwright install-deps` for the system
   libraries. Or run the job in the `mcr.microsoft.com/playwright` image for
   that version. Normally that saves 20–40 s, but it also removes the
   8–10 minute download spikes we saw.
3. **Select tests locally, run everything in CI.** While an agent iterates,
   run a `verify:changed` script:
   - `tsc -b` as today, since it's already incremental;
   - oxlint and oxfmt on the changed files only;
   - `vitest run --changed <base>`, where base is `gt parent` or the merge
     base with `main`. This covers both the unit and Storybook projects,
     because stories import the components they render, so Vitest's module
     graph sees them.

   Skip end-to-end tests locally. CI runs the full `pnpm verify` and is the
   gate, and the PR summary says that local checks were selected. This is
   the same deal the CLI repo adopted for its Vitest migration.
4. **Keep end-to-end tests unconditional in CI.** `playwright
   --only-changed` follows only the spec files' imports, so it misses app
   changes the browser reaches at runtime. The suite is small; if it grows,
   shard it (`--shard`) rather than select it.
5. **Don't add a pass cache or a build tool.** With one job and drafts
   skipped, a cache key would save one re-run of a few minutes.

When a web project grows into a pnpm workspace with several packages, start
with pnpm's own filter, `pnpm -r --filter "...[origin/main]" test`. It
selects changed packages plus everything that depends on them. Move to
Turborepo only when you need its cache across runs.

### New projects

Set these up from the start, because they're cheap on day one and painful
to retrofit:

- **One required gate job** that checks the others' results. Jobs can then
  be split, skipped or renamed without touching branch protection. The web
  template's `ci` job already does this.
- **Drafts skip CI**, as above. The web and Rust templates both do this.
- **Add lanes only when a job is worth skipping**, meaning it takes more
  than a couple of minutes and has inputs that many PRs don't touch.
  - Keep the path → lane rules in one script with its own tests, not
    scattered `paths:` filters. Then CI and local smoke read the same rules.
  - Map every new top-level directory when you add it; an unmapped path
    should fail the policy test, not silently fall back to "full".
  - Stacked PRs diff against their parent from the first stack.
- **Write tests a module graph can see.** Prefer in-process unit tests,
  which Vitest selects soundly. Keep tests that start processes or load
  files into a browser in a small integration tier with declared inputs.
  Most of the CLI repo's selection problem came from 20 of 39 test files
  starting processes.
- **Rust:** test the whole workspace, not `-p` subsets, and let the lane
  decide whether Rust runs at all.
- **A binary built in one language and tested from another:** cache it by
  the tree hash of its inputs from the first CI job that needs it.
- **Print per-step timings** in the run summary, as the web template's
  `ci` job does, so slow steps show up before they're expensive.

## Cost

The CLI repo is private, so its Actions minutes are billed; public repos
on standard runners are free. Assuming a plan with 3,000 included minutes a
month (GitHub Pro) and $0.006 per Linux minute beyond that, the repo uses
about 6,500 overage minutes a month, or roughly $39. A third off brings it
to about $20. On a plan with fewer included minutes, both figures go up by
the difference times $0.006, a few dollars. **The money is small.** The real gains are PR
latency (18 → 13 minutes on average, and much lower for PRs that skip the
release build) and local CPU with many agents running smoke at once.
[Blacksmith](blacksmith.md) stacks on top: it makes the remaining minutes
cheaper, and this makes there be fewer of them.

## Switch to a build tool when

- a repo grows past roughly 15–20 projects with real dependency edges
  between them, so hand-kept lane globs get missed: **moon** for Rust plus
  JS, **Turborepo** for a pure pnpm monorepo;
- cross-PR cache sharing in CI matters, meaning many sibling PRs with the
  same lane inputs: a self-hosted remote cache on R2.

Bazel and Buck2 stay out unless a repo reaches hundreds of targets or needs
hermetic remote execution.
