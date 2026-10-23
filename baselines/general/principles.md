# Engineering principles

These hold for every project, whatever the stack. A project's agent file
(`CLAUDE.md`, with `AGENTS.md` symlinked to it) restates the parts that apply
in that repo's own terms; this file is the reasoning behind them.

## 1. Errors are the interface for agents

Most code in these projects is written by agents, and an agent fixes what the
toolchain tells it is wrong. So the toolchain has to say, early and
precisely, what is wrong and how to fix it.

- **Fail at the earliest layer that can see the mistake.** In order of
  preference: the type system, a lint rule, a test, a hook, review. A rule
  that only lives in prose gets broken; a rule the compiler checks does not.
- **Every error names the fix.** What failed, where (file and line, or the
  input that caused it), and what to do: the command to run, the value to
  change, the doc to read. "Invalid config" is a bug; "`timeout` must be a
  duration like `30s`, got `30` in `app.toml:4`" is the bar.
- **Prefer autofixable checks.** Formatter over style lint; lint rules with a
  `--fix` over ones without. An agent that can apply the fix mechanically
  spends its effort on the actual change.
- **No silent fallbacks.** A missing token, an unknown route, a config key
  nothing reads: each fails loudly in development and in CI. A default that
  hides a mistake is worse than a crash.
- **One local command runs what CI runs** (`pnpm verify`, `just
  verify` or the repo's equivalent), fast enough to run before every handoff.
  CI is a re-run of it on a clean machine, not a different check.
- **When a trap costs real time twice, encode it.** Climb the same ladder:
  make it a type, else a lint rule or a test that fails with the fix in its
  message, else a hook. A line under "Traps" in the agent file is the last
  resort, and says why the rule exists.

Lint for bugs and ambiguity, not taste. Formatting is the formatter's job and
is never discussed in review. A lint rule earns its place when it catches a
real defect class (floating promises, unchecked indexing, `unwrap` in library
code) or removes a choice nobody should be making by hand.

## 2. Dependencies

- **Native first in the browser.** Every dependency ships to every user, so
  the platform wins when it covers the need: `Intl`, `Temporal`,
  `structuredClone`, `fetch`, `URLPattern`. Where a supported browser lacks
  one, polyfill it there only (in 2026-10, `Temporal` in Safari and
  `URLPattern` before Safari 26). No lodash-style grab bags.
- **In Rust, the bar is different.** A crate costs build time and supply-chain
  risk rather than download size, and `std` is small on purpose: regexes,
  serialisation, argument parsing and error types live in crates (`regex`,
  `serde`, `clap`, `thiserror`). Prefer the ecosystem's standard crate to
  hand-rolled code. Judge a crate by its maintenance (recent releases, more
  than one maintainer), its dependency tree and build time (`cargo tree`,
  `default-features = false`), and its build scripts and `unsafe`.
  cargo-deny checks advisories, licences, sources and duplicates.
- **Small, sharp libraries are worth it** when they buy a type-safe
  abstraction or remove a class of bugs at low cost (a schema validator, a
  state primitive, an error-reporting crate). Judge by what it removes from
  our code, its size, and whether it is maintained.
- **Every dependency is a decision.** Adding one to a project that has a
  decision record says why in the commit, and anything structural gets an
  ADR (below).

## 3. Implementation ethos

- **Rule of three.** Write it once; tolerate the second copy; on the third,
  extract a constant, helper, component, fixture or page object. Do not
  abstract ahead of the third use: a wrong abstraction costs more than the
  duplication it removed.
- **SOLID, read pragmatically.** One reason to change per module. Depend on
  narrow interfaces (a function type, a trait) rather than concrete
  services, so tests inject fakes instead of patching globals. Extend by
  adding a variant or an implementation, not by threading a flag through
  every caller.
- **Make invalid states unrepresentable.** Discriminated unions and enums
  over booleans plus optionals; parse at the boundary (schema in TypeScript,
  newtypes and `FromStr` in Rust), trust the types inside.
- **Refactor before behaviour changes.** When a change is awkward, first land
  a pure refactor that keeps every test green, then the behaviour change on
  top. Two commits at least, ideally two PRs. Reviewers can then read the
  behaviour change on its own. The refactor keeps the existing tests and
  their assertions (only imports may move): their passing unchanged is what
  shows nothing broke. Rewriting or deleting tests, even the fragile ones
  that prompted the refactor, belongs to the follow-up, which says why they
  had to go.
- **Small PRs.** One issue per branch, one branch per PR, stacked when they
  depend on each other. Aim for a diff a reviewer reads in one sitting
  (a few hundred lines of non-generated change). Split by layer or by
  refactor/behaviour rather than shipping a big one.
- **Tests check behaviour, not structure.** Assert what a user or caller can
  observe (output, rendered text, a returned value, an error code) through
  the public interface. Don't assert which internal function ran, and don't
  re-test what the type checker already guarantees.
- **Test the inputs that can happen.** Cover the edges real input reaches:
  empty, boundary values, malformed input at a parse boundary. Property tests
  suit parsers and pure transforms. Write no production or test code for
  states the types rule out; if a state seems possible, make it
  unrepresentable instead.
- **A UI has visual regression tests.** Behaviour tests stay green while a
  layout breaks; screenshots compared with `main`'s catch it. The
  [web baseline](../web/README.md) and
  [explorations/visual-regression.md](../explorations/visual-regression.md)
  say how.
- **Tests are production code.** Same naming, typing and review bar. Shared
  setup lives in fixtures, builders and page objects, not copy-paste. A test
  states one behaviour and fails with a message that says which.
- **Decisions are written down.** A choice that shapes the codebase (a
  framework, a storage format, a public contract) gets an ADR in
  `docs/adr/NNNN-<slug>.md`: context, decision, alternatives, consequences,
  and a Mermaid diagram when it changes structure, a flow or a state machine.
  Supersede with a new record rather than editing an accepted one.
  [`files/docs/adr/0000-template.md`](files/docs/adr/0000-template.md) is the
  shape.

## 4. Ways of working live in the repo

An agent arriving cold must be able to find, without asking:

- what the project is and who it is for;
- the commands (install, dev, verify, release) and which one gates a handoff;
- where issues are filed, how branches, commits and PRs name them, and who
  merges;
- how text an agent writes (commits, PRs, comments, messages) names the
  agent that wrote it;
- the definition of done (verify green, tests added, docs and ADRs updated);
- the architectural choices and where their records are;
- the traps: things that look safe and are not, each with its reason.

The [`CLAUDE.template.md`](CLAUDE.template.md) is the skeleton. Anything the
toolchain can enforce goes in a hook, lint or test instead, with the agent
file pointing at it.

## Sources

- **A check the agent can run**: Claude Code's
  [best practices](https://code.claude.com/docs/en/best-practices). Without
  one, "looks done" is the agent's only signal that it has finished.
- **Rule of three**: popularised by Martin Fowler's *Refactoring*, which
  credits Don Roberts
  ([summary](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming))).
- **Make invalid states unrepresentable**: Yaron Minsky,
  [Effective ML Revisited](https://blog.janestreet.com/effective-ml-revisited/).
- **Parse at the boundary**: Alexis King,
  [Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/).
- **ADRs**: Michael Nygard,
  [Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
- **The agent file**: the [AGENTS.md](https://agents.md/) format. Here it is
  kept as `CLAUDE.md`, with `AGENTS.md` symlinked to it, so Claude Code and
  other agents read the same file.
