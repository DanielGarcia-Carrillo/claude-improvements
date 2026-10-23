<!--
Rust stack fragment. Splice each section into the matching
"stack fragment" marker of general/CLAUDE.template.md, rename `replace-me`,
and delete these comments.
-->

## Commands

```bash
just verify                              # fmt, deny, clippy, tests, docs, shear: the gate
cargo nextest run -p replace-me-core NAME  # narrowest test first, then widen
just fix                                 # clippy --fix, then rustfmt
just snapshots                           # review changed insta snapshots
cargo run -p replace-me -- check FILE --json
```

Rust comes from `rust-toolchain.toml`; `just`, nextest, cargo-deny,
cargo-shear and cargo-insta from `mise.toml` (`mise install`). Never build
with `--release` unless asked: it is slow and nothing here needs it.

## Conventions

- **Layout**: `crates/replace-me` is a thin binary (parse, run, emit);
  `crates/replace-me-core` holds all logic, typed errors and doctests. New
  logic goes in core with unit tests; the binary only wires it up.
- **Dependencies** are declared once in the root `[workspace.dependencies]`
  and used as `foo.workspace = true`. A new dependency is a decision: justify
  it in the commit. `cargo shear` and cargo-deny fail on unused or duplicate
  declarations.
- **No panics in non-test code.** No `unwrap`, `todo!`, `unimplemented!`;
  encode the constraint in a type, or return an error. `expect("why this
  can't fail")` only for true invariants.
- **Lint overrides use `#[expect(lint, reason = "…")]`**, and only after
  trying the fix. `#[allow]` fails clippy and `just lint`. A rule that is wrong for the repo changes in
  `Cargo.toml` in its own commit.
- **Errors**: `thiserror` enums in core, each variant with a stable `code()`
  and a `hint()`, the cause kept as `#[source]` and not repeated in the
  message. Error codes are part of the CLI contract: never change or reuse
  one.
- **The CLI contract** lives in `crates/replace-me/src/output.rs`, the only
  module that prints: one JSON document on stdout with `--json`, logs and
  text-mode errors on stderr, exit 0 clean / 1 findings / 2 error. Every
  case has a snapshot in `crates/replace-me/tests/cli.rs`.
- **Snapshots are regenerated, never hand-edited**: run the tests, then
  `just snapshots` to review. A changed CLI snapshot is a contract change and
  says so in the PR.
- **One path per public item.** Modules stay private and items are
  re-exported from `lib.rs`.
- **Docs describe the code, not its history.** No design journals, no "as
  discussed", no tests that only restate a constant.
- **Repo-specific "use this instead" rules** go in `clippy.toml`
  `disallowed-methods` with a reason, so the lint names the replacement.

## Traps

- **`RUSTUP_TOOLCHAIN` beats `rust-toolchain.toml`.** A global
  `rust = "stable"` in mise exports it everywhere. `mise.toml` here reads the
  toolchain file instead; if `rustc --version` disagrees with
  `rust-toolchain.toml`, check `echo $RUSTUP_TOOLCHAIN`.
- **`CARGO_BUILD_WARNINGS=deny` is set by `just` and CI, not by plain
  `cargo build`.** A warning that compiles locally fails verify. Use it
  instead of `RUSTFLAGS=-D warnings`, which throws away the build cache.
- **nextest does not run doctests.** `just test` runs `cargo test --doc`
  after it; keep both.
- **Advisories run on main and weekly, not on PRs or in `just verify`**, so
  a fresh RUSTSEC entry shows up as a red main build, not on your branch.
  `just deny-all` checks them now.
