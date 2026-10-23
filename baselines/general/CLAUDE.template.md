<!--
Skeleton for a new project's CLAUDE.md. Copy it to the repo root as
CLAUDE.md, symlink AGENTS.md to it (`ln -s CLAUDE.md AGENTS.md`), fill every
<placeholder>, and splice in the stack fragment (web/CLAUDE.stack.md or
rust/CLAUDE.stack.md) where marked. Delete these comments.

Keep it short: an agent reads all of it every session. Anything the
toolchain can enforce belongs in a lint, test or hook, with one line here
pointing at it.
-->

# <Project name>

<One paragraph: what it is, who it is for, the one thing it must do well.>
[README.md](README.md) is for users; this file is how to work on it.

Read first: [docs/adr](docs/adr/README.md), every structural decision and why.

## Commands

<!-- stack fragment: Commands -->

`<verify command>` is the gate. It runs everything CI runs. Run it before
every handoff and never hand off red.

## Ways of working

- **Issues** live in <Linear team "X", project "Y" | GitHub Issues>. File
  bugs and follow-ups there, never as bare TODOs: a TODO names its issue,
  `TODO(PER-12): …`.
- **Branches**: one issue per branch, `<track>/per-<n>-<slug>`. Stack
  dependent branches with Graphite (`gt create`, `gt restack`).
- **Commits**: imperative subject ending in the issue key,
  `Add offline banner (PER-12)`. A refactor and a behaviour change are
  separate commits.
- **PRs**: one branch each, title carries the key, body has the `Linear:`
  (or `Closes #n`) line and how it was verified ([template](.github/pull_request_template.md)).
  Open as draft. <Who may push, mark ready and merge.>
- **Done** means: verify green; tests cover the new behaviour; an ADR is
  added or superseded if a decision changed; this file is updated if a
  command, convention or trap changed.

## Process

1. Read the issue and any ADR it touches. Ask before building if the
   acceptance criteria are unclear.
2. If the change is awkward in the current shape, refactor first: tests
   green, separate commit (ideally a separate PR).
3. Make the change with its tests. A bug fix starts with a test that
   reproduces it.
4. Run verify. Fix every failure at its cause. Never silence a lint, skip a
   test or loosen a type to get green; if a rule is wrong, change the rule in
   its own commit and say why.
5. Hand off with the branch, the SHA, the verify result and any departure
   from the issue.

## Conventions

- **Rule of three**: tolerate a second copy, extract on the third (constant,
  helper, component, fixture, page object). Not before.
- **Errors name the fix**: what failed, where, and what to do about it. No
  silent fallbacks; an unexpected state fails loudly.
- **Parse at the boundary, trust types inside.** Invalid states should not
  be representable.
- **Native before dependencies** in the browser; in Rust, the ecosystem's
  standard crate before hand-rolled code. A new dependency is justified in
  its commit message; a structural one gets an ADR.
- **Tests check behaviour** a caller can observe, not internals or what the
  types already guarantee, and only inputs that can happen. Shared setup in
  fixtures and builders, one behaviour per test, failure messages that say
  which.

<!-- stack fragment: Conventions -->

## Architecture

<!-- One line per key choice, each linking its ADR. -->

- <Choice>: <one line>. [ADR 0001](docs/adr/0001-stack.md)

## Traps

<!--
Things that look safe and are not. Each entry: what breaks, why, and what to
do instead. Add one when a mistake costs real time; remove it once a lint,
test or hook enforces it.
-->

<!-- stack fragment: Traps -->
