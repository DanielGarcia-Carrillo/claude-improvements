# Rust baseline

For developer tools: CLIs and the libraries behind them, built mostly by
agents. The bar is that the compiler, clippy and the tests catch a mistake
before review does, and say how to fix it. [`template/`](template/) is a
working workspace that passes `just verify`;
[`CLAUDE.stack.md`](CLAUDE.stack.md) is the Rust part of the new repo's agent
file.

Versions and statuses were checked on 2026-10-20.

## Using it

1. Ask the [kickoff questions](../general/kickoff.md) (CLI or library,
   distribution, platforms, published or not).
2. Copy `template/` and `../general/files/` into the new repo. Every
   placeholder spells "replace me": `replace-me` in the crate folders,
   package names, `[workspace.dependencies]`, the CLI test and `repository`
   in `Cargo.toml`, and `replace_me_core` in `use` paths.
   `git grep -niE 'replace[-_ ]?me([^a-z]|$)'` lists what's left, and CI
   fails while any remain.
3. `mise install && cargo generate-lockfile`. Requirements like `"4.6.7"`
   are carets (`^4.6.7`), and the template has no lockfile, so this resolves
   the newest compatible releases.
4. Take new majors too: set `rust-toolchain.toml` to the current stable
   (`rustup check`; not `mise up`, which also upgrades and uninstalls global
   tools), run `cargo upgrade --incompatible` (from cargo-edit),
   then `just verify`. If a major breaks verify, revert that one and note it
   in the stack ADR. Commit `Cargo.lock`: this is a binary.
5. Build `CLAUDE.md` from [`CLAUDE.template.md`](../general/CLAUDE.template.md)
   plus [`CLAUDE.stack.md`](CLAUDE.stack.md); `ln -s CLAUDE.md AGENTS.md`.
6. Point agents at Microsoft's
   [Pragmatic Rust Guidelines for agents](https://microsoft.github.io/rust-guidelines/agents/all.txt)
   (one file, about 34k tokens) for review-only rules the lints can't check.

## The defaults

| Area | Default | Why |
|---|---|---|
| Toolchain | Rust 1.99.1 pinned in `rust-toolchain.toml`, edition 2024, resolver 3 | Every checkout and CI build the same; resolver 3 respects `rust-version` |
| MSRV (minimum supported Rust version: the oldest compiler a crate promises to build on) | `rust-version` equals the pinned channel for binary-only tools | Libraries published to crates.io sit two or three releases behind and add an MSRV job |
| Layout | Virtual workspace: `crates/<tool>` (thin bin) + `crates/<tool>-core` (lib) | Logic is testable without spawning a process, doctests have a library, print and exit lint exceptions stay in one module |
| Lints | rustc + clippy `all` and `pedantic`, plus restriction lints chosen for agent failure modes (`unwrap_used`, `todo`, `print_stdout`, `allow_attributes`, `map_err_ignore`, `let_underscore_must_use` …), and rustdoc's. Doctests deny warnings too (`#![doc(test(attr(deny(warnings))))]`) | Each lint names the problem and usually the fix; `#[expect(…, reason)]` instead of `#[allow]`, which clippy and a source check in `just lint` and CI reject. `just lint` also fails a crate that doesn't take the workspace lints |
| Release profile | `overflow-checks = true`, thin LTO, one codegen unit, stripped symbols | Integer overflow panics instead of wrapping into a wrong answer |
| Warnings | `CARGO_BUILD_WARNINGS=deny` in `just` and CI | Fails on warnings without the cache misses of `RUSTFLAGS=-D warnings` |
| Errors (lib) | `thiserror` enum with stable `code()` and `hint()`, cause as `#[source]` | Machine-matchable, actionable, no duplicated messages |
| Errors (bin) | `main() -> ExitCode`, one output module | `main() -> Result` prints Debug output and always exits 1 |
| CLI | clap 4 derive; `--json` prints exactly one envelope; exit 0 / 1 findings / 2 error | Agents and scripts parse stdout and branch on codes |
| Logging | `tracing` to stderr, `RUST_LOG` filter | stdout stays the result |
| Tests | nextest (+ `cargo test --doc`), insta-cmd CLI snapshots, proptest | Fast, isolated, contract-shaped; flaky tests fail even when a retry passes |
| Supply chain | cargo-deny (licences, bans, sources; advisories on main and weekly), cargo-shear | Unused and duplicate dependencies fail; a new advisory doesn't block an unrelated PR |
| Tasks | `just` | One `just verify` that mirrors CI |
| Tools | mise pins just, nextest, cargo-deny, cargo-shear, cargo-insta | Same versions locally and in CI |
| CI | GitHub Actions, SHA-pinned; `rustup toolchain install` reads the toolchain file; Swatinem/rust-cache; taiki-e/install-action | Linux only by default; add macOS and Windows test legs only for tools shipped there |

## Add when needed

| Need | Add |
|---|---|
| Published library | `cargo-semver-checks` in CI, `avoid-breaking-exported-api = true` in clippy.toml, `missing_docs` stays, an MSRV job, `expect_used` lint |
| Releases with prebuilt binaries | `dist` (cargo-dist) for installers and GitHub releases; `release-plz` for versions, changelog and crates.io |
| Source-span diagnostics (parsers, config files) | `miette` or `annotate-snippets` for labelled spans; keep codes and hints |
| An error type of the binary's own, with context chains | `anyhow` with `.with_context(…)` at I/O boundaries; the reporter downcasts to the core error for its code |
| Feature flags | `cargo hack --feature-powerset check` in CI |
| `unsafe` (FFI only) | `unsafe_code = "deny"` with `#[expect(unsafe_code, reason)]` at each site, `undocumented_unsafe_blocks`, Miri in CI |
| Async or network I/O | tokio with only the features used; a decision recorded in an ADR |
| Coverage, mutation testing | cargo-llvm-cov, cargo-mutants |

## Sources

- Microsoft [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines/guidelines/checklist/index.html),
  including the AI section (single item paths, no meta design docs, no
  tautological tests, Rust-shaped APIs).
- [Rust API Guidelines checklist](https://rust-lang.github.io/api-guidelines/checklist.html).
- The agent files of ruff, uv, oxc, biome and rust-analyzer: exact verify
  commands, no panics or lint suppression, snapshot discipline, narrow tests
  first.
