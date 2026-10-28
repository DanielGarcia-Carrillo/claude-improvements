# sccache for Rust builds (exploration)

When a compiler cache such as [sccache](https://github.com/mozilla/sccache)
speeds up Rust builds, for local agent worktrees and for GitHub Actions. The
question came from many parallel agent PRs, where each fresh worktree
compiles cold and some CI jobs rebuild the same crates on every run. The
guidance is drawn from measuring one of our repos in October 2026; that
evidence is in the [worked example](#worked-example) at the end. For which
jobs and tests run at all, see
[CI and local check speed](../general/ci-speed.md).

## The short version

- **sccache pays off across builds, not within one.** It stores each
  compiled crate in a cache that outlives the build, keyed by the crate's
  inputs. A later build, in another job, run or worktree, downloads a crate
  whose inputs match instead of compiling it. A single build compiles each
  crate once and gains nothing.
- **Its Rust key includes the working directory** and every `CARGO_*`
  variable, `CARGO_MANIFEST_DIR` among them. Registry dependencies compile
  in `~/.cargo/registry` and hit from anywhere. Workspace crates hit only
  when compiled again at the same checkout path, and `SCCACHE_BASEDIRS`
  doesn't change that for Rust.
- **In CI, add it beside `rust-cache`, so PRs reuse `main`'s workspace
  crates.** `rust-cache` carries dependencies from `main`'s runs to PR runs
  but deliberately drops the repo's own crates, so every job recompiles all
  of them. With sccache, a `main` push also saves each workspace crate it
  compiles to the Actions cache. A PR's job then compiles only the crates
  whose inputs differ from what `main` built, and downloads the rest. Every
  runner checks out at the same path, so the keys match. In the worked
  example, a PR that changed one crate spent 79% less compile CPU on a
  binary build. sccache alone was slower than `rust-cache` alone.
- **Locally, clone a warm `target/` instead.** An APFS clone of a built
  `target/` into a new worktree, followed by touching its checked-out files,
  reused every dependency and cut compile CPU by about half. sccache
  managed 30%.
- **Never in release builds.** The keys can't mix debug and release
  artifacts, but a release, and above all a reproducibility check that
  builds twice, should compile from source.
- **Test and benchmark binaries aren't cacheable.** Anything that links
  isn't: `bin`, `cdylib`, `proc-macro` and test harnesses. A crate with
  many integration tests keeps most of its build time.

## New projects

- **Use `rust-cache` and sccache together in CI, both written only from
  `main`**, as the [Rust template](../rust/template/) does by default
  (setup below).
- **Keep build stamps in the leaf crate.** A build script that embeds the
  Git commit (`cargo:rustc-env=…`) changes that crate on every commit, so it
  and every crate depending on it miss any cache. Put it in the binary
  crate, or in a tiny crate only the binary depends on.
- **Keep `RUSTFLAGS` the same across jobs.** Flags are part of the key, so a
  job with its own `RUSTFLAGS` gets its own cache entries and its own
  `rust-cache` key. Pass lints as tool arguments
  (`cargo clippy -- -D warnings`), not through `RUSTFLAGS`.
- **Prefer few, large integration test binaries** if build time matters.
  Each `tests/*.rs` file is a separately linked binary that no cache can
  serve.

## Migrating an existing project

### CI

Within one job each crate compiles once, so the gain comes only from
crates an earlier run already compiled. In practice that's `main`: its
pushes save entries, and PR jobs read them, as with `rust-cache`. How
much a PR reuses depends on how far its crates' inputs are from a recent
`main` build:

- **Changes one crate that nothing else depends on**, such as the binary
  crate: every other workspace crate hits. This is the case that pays.
- **Changes a crate others depend on:** that crate and everything
  downstream miss, because each crate's key includes its dependencies'
  compiled output.
- **Based on an older `main`:** a crate `main` has changed since then hits
  only if `main` built that exact version within the cache's 7-day expiry.
  Keys are by content, not commit, so any recent `main` build counts.
- **Re-runs of the same PR** hit only if PRs may write. Read-only is the
  default here, because GitHub scopes a PR's cache writes to that PR's
  ref, so no other PR or `main` can read them. They still count against
  the repo's 10 GB, where the least recently used entries are evicted
  first, so a burst of PR pushes can evict `main`'s entries, which every
  PR's hits come from. They also share the repo's 200 uploads a minute.
  Unchanged crates already hit from `main`, and the crate being edited
  misses either way. So PR writes only help a re-run of the same commit,
  or a PR that changed a crate others depend on and then edits elsewhere.
  Allow them if that's common, and have the cache pruning remove a closed
  PR's sccache entries.

1. **Find the jobs that rebuild workspace crates.** In a job's log, count
   the `Compiling` lines for workspace members after a `rust-cache` hit.
   `rust-cache` restores dependencies only, so every run rebuilds every
   workspace crate, and a PR that changed one crate pays for all of them.
2. **Add sccache to those jobs, beside `rust-cache`.** The
   [Rust template](../rust/template/)'s CI does this by default:

   ```yaml
   env:
     SCCACHE_GHA_ENABLED: 'true'
     RUSTC_WRAPPER: sccache
     SCCACHE_GHA_RW_MODE: ${{ github.ref == 'refs/heads/main' && 'READ_WRITE' || 'READ_ONLY' }}
   steps:
     - uses: mozilla-actions/sccache-action@<sha> # v0.0.11
       with:
         version: v0.19.0
     - uses: Swatinem/rust-cache@<sha> # v2
       with:
         save-if: ${{ github.ref == 'refs/heads/main' }}
   ```

   The action only installs sccache, passes the cache service's token
   through, and reports the hit rate in a post step. The job sets
   `SCCACHE_GHA_ENABLED` and `RUSTC_WRAPPER` itself. Install sccache before
   any step that runs Cargo, because Cargo fails if `RUSTC_WRAPPER` names a
   missing program. Keep `CARGO_INCREMENTAL=0` (`rust-cache` sets it);
   sccache can't cache incremental compiles. Read-only on PRs matches
   `rust-cache`'s `save-if`: `main` writes, and PRs read `main`'s entries.
3. **Budget the Actions cache.** sccache stores each compiled crate under
   its own cache key. With `rust-cache` in front, sccache only sees
   workspace crates, so a `main` push writes about a dozen entries per job.
   Without it, a cold build writes hundreds, and GitHub accepts only 200 new
   cache uploads a minute per repo. The build carries on past that, but the
   rejected crates aren't stored and miss next time. Entries expire after
   7 days unused, and the repo shares 10 GB. If
   a script prunes caches by key prefix, teach it sccache's entries, or they
   count against the budget without being pruned.
4. **Leave out release jobs and anything that only runs `cargo check` or
   `clippy`.** Check builds emit metadata without linking, which sccache
   doesn't cache.
5. **Measure** the build step's time before and after on a few PRs that
   change one crate.

### Local worktrees

1. **Seed each new worktree's `target/`** from an idle, built one of the
   same toolchain, as an APFS clone (`cp -cR`; on Linux,
   `cp -r --reflink=auto` on btrfs or XFS). About 27,000 files cloned in
   5–6 s here, sharing disk blocks until they're rebuilt.
2. **Then touch the checked-out files** (`git ls-files -z | xargs -0 touch`).
   Cargo decides freshness for workspace crates by modification time. A
   worktree checked out before the seed was built would look up to date,
   even on another commit, and test stale code. Touching makes the
   workspace crates rebuild while every dependency stays fresh. Skip the
   touch only when the seed was built from exactly the worktree's commit.
3. **Don't turn incremental compilation off to make sccache cache workspace
   crates.** They miss across worktree paths anyway, and edit rebuilds took
   twice as long without it.
4. **sccache as well** is optional: it adds a global `RUSTC_WRAPPER` and a
   daemon for the registry dependencies the clone already covers. It helps
   when there's no seed to clone, such as the first build after a lockfile
   change, or across several projects that share dependencies.

## How it interacts

| With | Effect |
|---|---|
| `CARGO_INCREMENTAL` | Incremental compiles aren't cacheable, and Cargo uses incremental for workspace crates in the dev profile. CI usually sets `CARGO_INCREMENTAL=0` already. Locally, keep it on |
| Feature unification | Each feature set is a separate entry. A `-p` subset build that recompiles shared dependencies with other features hits after its first time, but still doesn't beat building the whole workspace |
| `--locked`, `Cargo.lock` | No effect on the key. A version bump changes the bumped crate and its dependents' inputs |
| `RUSTFLAGS` | Hashed with the arguments; different flags mean different entries |
| `CARGO_*` variables | All hashed, apart from a few such as `CARGO_MAKEFLAGS`. Set CI-wide ones such as `CARGO_TERM_COLOR` in the workflow's `env`, so every job agrees |
| Build scripts | Their binaries link, so they aren't cached; they rerun on a fresh `target/`. Values they pass through `rustc-env` are hashed, so a commit stamp misses on every commit |
| Release profile | Opt-level, LTO and codegen units are all arguments, so release and debug never share entries. Still keep release jobs off the cache |
| `cargo-zigbuild`, cross targets | Cacheable in principle; untested here, and release jobs are excluded anyway |

## Libraries and tools

Checked in October 2026.

| Approach | Fit |
|---|---|
| `Swatinem/rust-cache` | The default. Restores `~/.cargo` and dependency artifacts; strips workspace crates and incremental data before saving |
| `rust-cache` with `cache-workspace-crates: true` | Keeps workspace artifacts, but Cargo judges them by modification time, and a fresh checkout's files are all newer, so they should rebuild anyway (not measured) |
| **sccache 0.19 with the GitHub Actions backend** (`mozilla-actions/sccache-action`) | **Add it in CI** beside `rust-cache` for jobs that rebuild workspace crates. Content-addressed, so a fresh checkout's modification times don't matter |
| sccache with a local disk cache | Optional locally; caches registry dependencies only, across worktree paths |
| `SCCACHE_BASEDIRS` | Normalizes paths for C and C++ compiles. In 0.19 it doesn't affect Rust keys (checked in its source), so it doesn't make workspace crates hit across worktrees |
| Cloned `target/` (`cp -c`, reflinks) | **Use locally.** No daemon or wrapper, and it also covers build scripts, proc macros and linked binaries when the commit matches |
| Shared `CARGO_TARGET_DIR` across worktrees | No: concurrent Cargo runs wait for each other on the target directory's lock |
| Packing `main`'s build outputs by input hash | Good when no Rust input changed. It misses on every PR that changes a crate, which is where sccache helps |
| Remote sccache backends (S3, R2, Redis) | Not needed: the Actions backend is free, and locally there's no second machine |

## Cost

sccache is free (Apache-2.0), and the Actions cache costs nothing within
the repo's 10 GB. Caching the workspace crates of a 9-crate workspace
behind `rust-cache` takes far less space than the 232 MB a whole cold
build's entries took. The money saved is small: in the worked example,
about 400 billable minutes a month, or a few dollars of overage. The gain is
a minute or so off each Rust job on PRs that change one crate.

## Switch when

- **CI, in an existing project:** a job rebuilds unchanged workspace
  crates on most runs, and that build takes more than about a minute. Add
  sccache to that job. New projects get it from the Rust template.
- **Locally, to sccache instead of cloning:** sccache normalizes the
  working directory and `CARGO_MANIFEST_DIR` for Rust, so workspace crates
  hit across worktrees
  ([mozilla/sccache#2652](https://github.com/mozilla/sccache/issues/2652)
  tracks applying `SCCACHE_BASEDIRS` to Rust). Leaving copy-on-write
  isn't a reason to switch: a plain copy of `target/` still works but
  costs disk and time, and sccache would still miss on workspace crates,
  helping only with registry dependencies.
- **To a remote cache:** builds move to machines that can't share a
  directory or the Actions cache, such as several self-hosted runners.

## Worked example

Measured on 2026-10-27 on the Rust CLI repo from
[CI and local check speed](../general/ci-speed.md): 9 crates (one of them
the CLI crate that most PRs touch), about 230 compile units for
`cargo test --workspace --no-run`, and 67 integration test files. Of
October's 73 merged PRs that changed Rust, 49 changed only the CLI crate.

**Method.** Throwaway worktrees of `origin/main` on an 18-core Apple Silicon
Mac shared with other agents. The load average was 17–50 throughout, so
wall time is noisy. Compile CPU (user plus system time of Cargo and of a
foreground sccache server) holds up better and is the main figure. Each
scenario ran twice; tables show the mean, with both runs where they
differ much. sccache 0.19.0 with a local disk cache, Rust 1.98.1.

### Local worktrees

`cargo test --workspace --locked --no-run` in a new worktree at a new path,
with default settings (incremental on):

| New worktree | Wall | Compile CPU |
|---|---|---|
| Cold, plain Cargo | 50 s | 651 s |
| Cold, empty sccache (first worktree) | 53 s | 688 s (+6%) |
| Warm sccache, same commit | 39 s | 458 s (−30%) |
| Cloned `target/`, then touched | 40 s (41, 39) | 347 s (−47%) |
| Cloned `target/`, same commit, not touched | 0.4 s | 0 |

- **What sccache served:** 331 of 357 cacheable compiles hit, all of them
  registry dependencies. The other 26 missed in every run, whether on the
  same commit or a nearby one, and with or without `SCCACHE_BASEDIRS`. 88
  compiles were incremental and so not cacheable, 45 were binaries, proc
  macros or a `cdylib`, and 7 were invocations sccache doesn't handle.
- **With `CARGO_INCREMENTAL=0`** the 88 became 10 more misses (workspace
  libraries, still path-bound) and 78 test harnesses, which link. No gain.
- **Editing the CLI crate** in a warm worktree rebuilt in 3.3 s with
  incremental on and in 7.3 s with it off.
- **The cloned `target/`:** a worktree checked out after the seed was built
  rebuilt exactly the 12 workspace units, while one checked out before it,
  on the same commit, rebuilt nothing. That second case would also have
  rebuilt nothing on a different commit, hence the touch.

### CI, emulated

GitHub's runners always check out at the same path, so this was emulated
with one fixed worktree and a fresh `target/` per run, with
`CARGO_INCREMENTAL=0` as in the repo's CI. First, a build of `main` filled
the sccache cache, standing in for `main`'s push. Each PR run then started
from a copy of that cache, as a PR job reads `main`'s entries. "rust-cache" means dependencies
built and workspace crates removed (`cargo clean -p` for each member and
the vendored path dependency), which is what a `rust-cache` hit leaves. The
PR changed one source file in the CLI crate and had a new commit stamp,
because one store crate's build script embeds the commit. Compile CPU:

| Build | Cold | rust-cache (today) | rust-cache + sccache | sccache alone |
|---|---|---|---|---|
| Viewer job's build: `cargo build -p <cli> --bin <cli> --example <renderer>` | 364 s | 73 s | **15.5 s (−79%)** | 115 s |
| Test job's build: `cargo test --workspace --no-run` | 597 s | 241 s | **184 s (−24%)** | 300 s |

- **rust-cache + sccache:** 10 of the 12 workspace units hit. The misses
  were the CLI crate and the store crate with the commit stamp; the CLI
  crate is the stamp's only dependent, so the stamp cost little here. On a
  re-run of the same commit all 12 hit (6 s and 168 s).
- **The test build's floor** is about 165 CPU-s: 78 test harnesses and 5
  binaries that link on every run.
- **sccache alone** loses because a fresh `target/` reruns every build
  script and relinks every proc macro and binary. In real CI it would also
  fetch about 320 entries over the network.

In the repo's CI (4-vCPU Linux runners), the viewer job's build step takes
95–106 s after a full `rust-cache` hit. It recompiles every workspace crate
plus the TLS crates. The npm wrapper job's two builds take 68 s and 34 s when
a Rust input changed. The test job's `cargo test --workspace` spends 4 m 09 s
compiling before any test runs. Scaling by the CPU ratios above, which
assumes the compile stays CPU-bound:

| Job (per run on a PR that changed one crate) | Today | With sccache (estimate) |
|---|---|---|
| Viewer build | 95–106 s | about 30–50 s |
| npm wrapper builds (when Rust changed) | about 100 s | about 30–50 s |
| Test job compile | 4 m 09 s, plus 1 m 17 s for the no-default-features build | about 3 m 10 s, plus about 1 m |

About 3 minutes per run, roughly 400 of the repo's 9,500 billable minutes a
month (4%). The Actions cache used 4.4 GB of 10 GB at the time, with the
repo's prune script budgeting 8 GiB. None of this has been run in CI yet.
The estimate also assumes the GitHub Actions backend fetches about a dozen
entries in a few seconds.

**Outcome:** recommended for the viewer, npm wrapper and test jobs as a
small addition, after the selector work in
[CI and local check speed](../general/ci-speed.md), which saves about
eight times as much. Release and bench jobs stay as they are. Locally, seeding worktrees
from a cloned `target/` is the better change.
