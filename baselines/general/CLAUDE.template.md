<!--
Skeleton for a new project's CLAUDE.md. Copy it to the repo root as
CLAUDE.md, symlink AGENTS.md to it (`ln -s CLAUDE.md AGENTS.md`), fill every
<placeholder>, and splice in the stack fragment (web/, rust/ or
python/CLAUDE.stack.md) where marked. Delete these comments.

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
  for example `TODO(ABC-12): …` (`ABC-12` stands for any issue key).
- **Branches**: one issue per branch, `<track>/<issue key>-<slug>`, for
  example `web/abc-12-offline-banner`. Stack dependent branches with
  Graphite (`gt create`, `gt restack`).
- **Commits**: imperative subject ending in the issue key, for example
  `Add offline banner (ABC-12)`. A refactor and a behavior change are
  separate commits.
- **PRs**: one branch each, title carries the key, body has the `Linear:`
  (or `Closes #n`) line, how it was verified and, for a visible change, a
  representative screenshot ([template](.github/pull_request_template.md)).
  Open as draft. <Who may push, mark ready and merge.>
- **Screenshots**: on the repo's orphan `screenshots` branch under
  `pr-<number>/`, committed from a separate worktree, never on the PR's
  branch. Link each by that branch's commit, so a later push doesn't change
  what an old description shows:
  `![what it shows](https://github.com/<owner>/<repo>/blob/<commit>/pr-<number>/<file>.png?raw=true)`.
  The images keep the repo's access rules, so a private repo's stay private.
- **Provenance**: whatever an agent posts to a service (PR bodies, review
  replies, issue comments, chat messages) ends with a line naming the agent,
  such as `🤖 Generated with [Claude Code](https://claude.com/claude-code)`,
  and its commits carry its `Co-Authored-By:` trailer.
- **Done** means: verify green; tests cover the new behaviour; an ADR is
  added or superseded if a decision changed; this file is updated if a
  command, convention or trap changed.

## Process

1. Read the issue and any ADR it touches. Ask before building if the
   acceptance criteria are unclear.
2. If the change is awkward in the current shape, refactor first, in a
   separate commit (ideally a separate PR) where the existing tests pass with
   their assertions unchanged. Rewriting or removing tests comes after, in
   its own change.
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
- **Native before dependencies** in the browser and in Python's standard
  library; in Rust, the ecosystem's standard crate before hand-rolled code.
  A new dependency is justified in its commit message; a structural one gets
  an ADR.
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
