# Project baselines

Engineering guidance for contributions to existing repositories, plus
starting points for new projects: principles, kickoff questions, agent-file
skeletons, and working templates with their configs. Everything is tuned
for agent-driven work: useful checks whose failures say how to fix them.

## Existing repositories

Apply the ownership policy to every baseline in this folder, including the
general principles, stack guides, configurations, templates, and explorations.

| Project ownership | How to use new baseline recommendations |
|---|---|
| Daniel owns the project | Actively evaluate new recommendations as they become available, including those that conflict with the current setup. Adopt worthwhile improvements judiciously, weighing correctness, maintenance, compatibility, migration cost, and disruption. Existing setup alone is not a reason to dismiss an improvement. |
| Someone else owns the project | Its requirements and guidelines take precedence. Use baselines as secondary references to fill relevant gaps within its conventions. Preserve conflicting requirements unless the owner directs a change. |

Establish ownership from the project context. A personal fork used to
contribute upstream follows the upstream project's requirements. Clarify
ownership when it is uncertain and would change the adoption decision.
Explicit instructions, product constraints, and review, validation, and
release gates remain in force until deliberately revised through the
project's normal process.

1. Read the repository's applicable `AGENTS.md`, `CLAUDE.md`, contributor
   guidance, accepted decisions, build configuration, and CI. Identify its
   architecture, supported platforms, tools, and required verification.
2. Compare the relevant baseline with that evidence. Separate practices
   already covered, useful gaps, conflicts, and things that do not apply.
3. Apply the ownership policy within the assigned scope. In Daniel's projects,
   assess conflicts on their merits and make proportionate improvements;
   record why a recommendation is adopted, deferred, or rejected. Plan larger
   migrations as focused work. In other people's projects, fill gaps within
   their conventions and preserve conflicting requirements.
4. Validate the contribution using the repository's required checks and
   relevant behavior tests. When adopting a change to tools or conventions,
   update configuration and instructions together and supersede accepted
   decisions through the normal process. Record missing checks, existing
   failures, and limitations separately from results for the change.

The template-copying and toolchain-upgrade steps below and in stack guides
are for new projects. For an existing project, integrate improvements
incrementally under the ownership policy instead of copying a template over
its files. The [Kotlin/Android guide](android/README.md) includes explicit
lint configurations and contribution guidance for existing projects.

| Path | What |
|---|---|
| [general/principles.md](general/principles.md) | Errors as the interface for agents, dependencies, implementation ethos, ways of working |
| [general/kickoff.md](general/kickoff.md) | Requirement questions to ask before choosing infrastructure |
| [general/infra.md](general/infra.md) | Hosting (Cloudflare), data, CI, toolchains, Claude Code mechanisms |
| [general/ci-speed.md](general/ci-speed.md) | Keeping CI and local checks proportional to a change: defaults for new projects, steps for existing ones |
| [general/CLAUDE.template.md](general/CLAUDE.template.md) | Skeleton for a new repo's `CLAUDE.md` |
| [general/files/](general/files/) | `.editorconfig`, `.gitattributes`, PR template, ADR template |
| [explorations/](explorations/README.md) | Options under evaluation, not yet defaults: Renovate, UI primitives, visual regression, Blacksmith, observability, tsrs and smaller ones |
| [web/](web/README.md) | React PWA on Cloudflare: stack decisions, agent fragment, runnable template |
| [rust/](rust/README.md) | Rust CLI/library workspace: defaults, agent fragment, runnable template |
| [python/](python/README.md) | Python tool, script or pipeline on uv, ruff and ty: defaults, agent fragment, runnable template |
| [android/](android/README.md) | Kotlin/Android contribution quality: explicit lint configurations, agent fragment, review checklist, and incremental adoption; no app scaffold |

## Starting a project

1. Ask the [kickoff questions](general/kickoff.md), in one batch, with a
   recommended answer for each.
2. Copy `general/files/` and the stack's `template/` into the new repo, and
   follow the stack README's "Using it" steps.
3. Build `CLAUDE.md` from [the skeleton](general/CLAUDE.template.md) plus the
   stack's `CLAUDE.stack.md`, then `ln -s CLAUDE.md AGENTS.md` so other
   agents read the same file.
4. Record the answers and every kept or changed default in
   `docs/adr/0001-stack.md`.
5. Set the repo's commit email to your GitHub noreply address
   (`git config user.email <id>+<username>@users.noreply.github.com`) unless
   it is set globally; see [Git identity](general/infra.md#git-identity).
6. Run the verify command green before the first commit.

## Where it started

Two pages set the starting points:
- Christoph Nakazawa's
  [Fastest Frontend Tooling](https://cpojer.net/posts/fastest-frontend-tooling),
  for the web toolchain;
- Microsoft's
  [Pragmatic Rust Guidelines](https://microsoft.github.io/rust-guidelines/guidelines/checklist/index.html),
  for Rust.

Each stack README ends with its sources, and
[principles.md](general/principles.md#sources) credits the ideas it borrows.

## Conventions in this folder

- Agent files are named `*.template.md` and `*.stack.md`, never `CLAUDE.md`,
  so Claude Code does not load them as instructions while working in this
  repo. The templates' `.claude/settings.json` and workflows are inert here
  for the same reason: only a repo root's copies take effect.
- The web and Rust templates passed their full verify from a fresh copy on
  2026-10-23 (web: `pnpm verify`, 47 unit and story tests plus 7 end-to-end;
  Rust: `just verify`, 19 tests plus a doctest, cargo-deny, cargo-shear), and
  the Python template on 2026-10-27 (`just verify`, 24 tests plus a doctest,
  ruff, ty, deptry). Re-run
  that check when changing a template: copy it to a scratch directory,
  install, verify.
- Versions, prices and "still beta" notes are dated. When a decision rests
  on one, re-check it rather than trusting the date here.
