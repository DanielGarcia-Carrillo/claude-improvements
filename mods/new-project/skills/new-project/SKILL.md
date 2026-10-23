---
name: new-project
description: Bootstrap a new repository from the claude-improvements project baselines (a React PWA on Cloudflare, or a Rust CLI workspace). Asks the kickoff questions in one batch, copies and renames the template, writes CLAUDE.md, AGENTS.md and the stack ADR, then installs and runs verify. Use when the user wants to start, create, scaffold or bootstrap a new project or repository.
argument-hint: "[what it is] [where it goes]"
---

# Bootstrap a new project

`$ARGUMENTS` is the user's brief: what the project is, and perhaps where it
goes.

- **BASELINES** is the folder named on this prompt's first line
  (`Baselines folder: …`). If that line is missing, the mod's hook did not
  run: use `${CLAUDE_PLUGIN_ROOT}/../../baselines` when it holds
  `general/kickoff.md`, else ask the user where the baselines folder is.
- **SCRIPT** is `${CLAUDE_PLUGIN_ROOT}/scripts/new-project.ts`. It needs Node
  23.6 or later (`node --version`).
- Single-quote each path you put in a command below: a folder the user
  names may hold spaces.

## 1. Ask the kickoff, in one batch

Read `BASELINES/general/kickoff.md`, then the stack READMEs
(`BASELINES/web/README.md`, `BASELINES/rust/README.md`) for each default and
when another shape fits.

Send one message holding every question, then stop and wait for the reply.
Don't use AskUserQuestion: it takes four questions and the batch is longer.

- **Setup** first: display name; slug (lowercase words joined by hyphens: the
  package, Worker or crate name); target folder (new or empty, and outside any git repository; recommend
  `<parent of the main checkout>/<slug>` unless the brief names one, where
  the main checkout is the parent of
  `git rev-parse --path-format=absolute --git-common-dir`, so a worktree
  session doesn't pick a folder inside the repo); for web,
  a short name of at most 12 characters for the installed app; for Rust, the
  repository URL (`https://github.com/<owner>/<slug>`; `gh api user --jq .login`
  gives the owner).
- **Every project**, then the stack's own section, each question in
  kickoff.md's words. If the brief makes the kind clear (a web app, or a CLI or
  library), include only that stack's section and say which stack you assumed;
  otherwise include both, each headed with when it applies.
- A recommended answer for every question, from the brief and the baseline's
  defaults. Where the brief already answers one, give that answer and mark it
  "from your brief".

Lay it out as numbered tables (`# | Question | Recommended`) so the user can
reply "ok", or "ok except 3: public, 9: multi-device sync".

## 2. Pick the baseline

- **web** for a web app. The template is a client-rendered SPA/PWA. If the
  answers need SEO or SSR, or are a content site, say the template doesn't fit
  as is, name the shape the web README's "Choosing the shape" gives, and ask
  whether to start from the SPA anyway or stop.
- **rust** for a CLI, library or developer tool in Rust.
- Neither (a mobile app, a Python service): say there is no baseline for it
  and stop. Don't force one.

An API, server state or anything else under a README's recipes or "Add when
needed" doesn't change the baseline: it's a follow-up, unless the user asked
for it now.

## 3. Write the answers file

Write JSON to a file outside the target (your scratchpad if the session has
one, else `$TMPDIR`). Every field is a string unless shown otherwise:

```json
{
  "stack": "web",
  "name": "Trip Planner",
  "slug": "trip-planner",
  "shortName": "Trips",
  "description": "Plans multi-day trips offline, for travellers without signal.",
  "summary": "CLAUDE.md's opening paragraph: what it is, who it is for, the one thing it must do well.",
  "issues": "Linear team \"Personal\", project \"Trips\"",
  "merging": "Daniel pushes, marks ready and merges; agents open drafts",
  "repository": "https://github.com/owner/trip-planner",
  "issue": "PER-40",
  "kickoff": [{ "question": "Public or private repo?", "answer": "Private", "assumed": false }],
  "changed": [{ "area": "Styling", "to": "vanilla-extract", "why": "Semantic class names in production" }],
  "architecture": [{ "choice": "Routing", "line": "TanStack Router, file-based" }],
  "alternatives": [{ "option": "TanStack Start with SSR", "why": "No page needs SEO" }],
  "consequences": "What becomes easier or harder, and what would make us revisit this.",
  "followUps": ["Add the Hono API with the README's recipe"]
}
```

- `shortName` is web only and optional; `repository` is required for Rust
  only; `issue` (the ADR's Issue line) is optional.
- `description` is one sentence: it becomes the README's opening, the HTML
  description and the manifest's.
- `kickoff` answers every question of "Every project" and the stack's section,
  each question copied verbatim from kickoff.md. `assumed: true` marks a
  default the user accepted without being asked. Setup answers don't go here.
- `changed` lists only defaults you change in the new repo during this
  bootstrap, `area` spelled as in the stack README's defaults table. A change
  for later is a `followUps` entry.
- `architecture` is the 4 to 8 key choices, one line each, from the defaults
  table as changed.
- `alternatives` is at least one option considered and not taken, with why;
  they become the ADR's "Alternatives considered".
- `changed` and `followUps` may be empty or left out. Every other list needs
  at least one entry, and no string in an entry may be blank.

Check the file with
`node SCRIPT scaffold --answers FILE --target DIR --baselines BASELINES --dry-run`.
Always pass `--baselines`: the script's own default only holds in a
claude-improvements checkout, not an installed copy. It reports every problem
at once, each naming its fix; fix the file and rerun until it passes.

## 4. Scaffold

`node SCRIPT scaffold --answers FILE --target DIR --baselines BASELINES` copies
`general/files/` and the stack's `template/`, renames the placeholders (each
spells "replace me": web `replace-me`, `Replace Me`, `ReplaceMe` and the
`Replace me: …` description; Rust the `replace-me` crates, folders and
packages, `replace_me` identifiers and `repository`), writes CLAUDE.md with
AGENTS.md linked to it, `docs/adr/0001-stack.md` and README.md, and runs
`git init`. It writes nothing unless every check passes, refuses a target
inside another git repository, and refuses an answer that reads as a
placeholder (the new repo's CI would fail on it).

## 5. Finish what needs judgment

The script fills every placeholder; some lines still depend on the answers.
Read the new CLAUDE.md and adapt it, keeping it short:

- Issues outside Linear: use the tracker's key form (`#12`, not `PER-12`) in
  the TODO, branch and commit examples, and drop the `Linear:` line from the
  PR bullet and `.github/pull_request_template.md`.
- Drop conventions for parts the project won't use (the web fragment's state
  line or Storybook, for example).
- Make each `changed` default real in the code (a CI matrix, a dependency),
  and keep the ADR in step.
- A public repo with a chosen licence gets a LICENSE file, and Rust's
  `license` in Cargo.toml matches it.

## 6. Set up and verify

Run `node SCRIPT setup DIR --stack STACK` in the background, STACK being the
baseline from step 2 (`web` or `rust`): it takes minutes. Always pass
`--stack`: a Rust tool with an npm wrapper holds both package.json and
Cargo.toml, and setup won't guess between them. It runs `mise trust` and
`mise install`, takes new majors, and verifies:

- web: moves mise.toml's pins to their latest releases (what the README's
  `mise up --bump` means, without touching global tools or uninstalling old
  versions), `pnpm install`, `pnpm up --latest`, Playwright's Chromium and
  WebKit, `pnpm format`, `pnpm verify`;
- Rust: pins `rust-toolchain.toml` to the current stable (and `rust-version`,
  unless step 5 set an older MSRV), `cargo generate-lockfile`,
  `cargo upgrade --incompatible`, `cargo fmt --all`, `just verify`.

Each pnpm, cargo and just command goes through `mise exec` so the pinned tools
win, and the run stops at the first failure. It lists the version lines the majors changed. Don't run
`mise up` yourself: it upgrades the user's global tools too.

On a failure, read the output and fix the cause in the new repo, then rerun
setup. Never silence a lint, skip a test or loosen a type to get green. If the
cause is in a baseline file, say so: the fix belongs in the baselines too.

If a new major breaks verify, revert that one to the version setup listed
before it, rerun with `--keep-versions` (which skips the majors, so the revert
holds), and record it in the ADR's follow-ups: what stayed behind and why.

## 7. Report

Tell the user the folder and stack; the verify result (its test counts), or
the failing step and its error; the majors taken and any reverted; what you
adapted in step 5; the defaults changed (the ADR has the rest); and the
follow-ups.

Then ask whether to make the first commit (`Start from the <stack> baseline`,
with the issue key if there is one; the lockfile goes in it). Create no remote
and push nothing unless asked.
