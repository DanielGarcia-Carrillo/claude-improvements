# Coverage gates

Every stack checks **80% overall line coverage** and **90% coverage of new
or modified executable lines**, separately for each report. The floors live
in `coverage-policy.toml`. No account, token, upload to a coverage service or
base-branch coverage report is needed. Reports stay local or in GitHub Actions.

| Stack | Local command | Collector and scope |
|---|---|---|
| Python | `just coverage` | coverage.py: all `src/`, including unimported modules and CLI subprocesses; branch details are reported alongside lines |
| Rust | `just coverage` | cargo-llvm-cov with nextest: workspace source; doctests run separately on stable Rust, without coverage |
| Web | `pnpm test:coverage` | Vitest V8 plus an isolated Istanbul-instrumented Playwright build: application `src/`, including service workers; c8 measures native Node hook/script subprocesses separately |
| Bash, in every stack | `just shell-coverage` or `pnpm shell:coverage` | kcov: Bash scripts under `scripts/` and `.claude/hooks/`, including scripts the tests never execute |

The full `just verify` / `pnpm verify` runs these gates too. Narrow `just
test`, `pnpm test`, and `pnpm verify:changed` remain useful while iterating;
partial test selection must not produce a whole-project coverage verdict.

## Setup and exclusions

`mise install` supplies uv, and cargo-llvm-cov for Rust. The standalone
`scripts/check-coverage.py` and its adjacent lockfile pin diff-cover and its
dependencies without adding them to the application's dependencies. uv
provides the script's Python runtime. Python's application collector is in
its dev dependencies. Web collectors are dev dependencies too.

Bash coverage also needs **kcov 43**: `brew install kcov` on macOS, or
`sudo apt-get install kcov` on Ubuntu. The runner rejects other versions so
an unexpected package update cannot silently change the measurement. CI
installs it on the Ubuntu runner. Bash behavior tests use disposable Git
checkouts and fake checkers; they never format the real checkout or install
packages. Each subject runs directly under kcov, then their reports merge;
wrapping the test harness alone would miss child Bash processes.

Tests, declaration files and generated router code are excluded from the web
application report. The Node tooling report excludes its test fixtures.
Bash excludes its collector launcher, which would otherwise recursively
collect itself. The shared Python checker and collection launchers are
development tooling, outside the application coverage scope. Review new
exclusions like changes to the floors; never exclude a module just because
it is untested. Coverage says code executed, not that assertions were useful.

The web coverage build lives under `coverage/browser-build/`. Normal
`pnpm e2e`, which verify runs afterward, builds and tests the ordinary
production artifact. Deployment continues to consume that artifact.
Coverage instrumentation is enabled only in the coverage child process.
Coverage uploads exclude browser traces, raw collector data and instrumented
builds; failure traces keep the workflow's shorter retention.

## Which changes count

CI fetches history and sets `COVERAGE_BASE` to the PR target's exact SHA,
including a stacked PR's target. The checker compares its merge base with
the candidate under test. Main pushes use the previous main SHA.

Locally, `--base REF` or `COVERAGE_BASE` wins, then `VERIFY_BASE`, then the
Graphite parent if available, then `origin/main` or `main`. No network fetch
runs implicitly: fetch the intended parent before checking. The diff includes
committed, staged, unstaged and untracked files. Before the first commit, or
without a comparison ref, all source is treated as new. An invalid explicit
base, missing/empty report, missing source file or Git inspection failure
fails the command instead of passing an empty check.

Run the checker again on an existing current report with:

```sh
uv run --script --locked scripts/check-coverage.py coverage/python.xml --base origin/main
```

Collect again after changing source or tests; an old report does not validate
a new candidate. HTML reports and changed-line details are under `coverage/`.
CI writes coverage to its job summary and uploads reports on failure too.
The existing aggregate `ci` job receives failures from its verification/test
job. Configure that `ci` status as required in the generated repository's
branch protection; template code cannot configure repository settings.

## Sources

- [coverage.py configuration and subprocesses](https://coverage.readthedocs.io/en/latest/config.html)
- [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)
- [Vitest coverage](https://vitest.dev/guide/coverage.html), [c8](https://github.com/bcoe/c8)
- [Istanbul reporting](https://github.com/istanbuljs/nyc), [Vite instrumentation](https://github.com/ifaxity/vite-plugin-istanbul)
- [kcov](https://github.com/SimonKagstrom/kcov), [diff-cover](https://github.com/Bachmann1234/diff_cover)
