# new-project

`/new-project` starts a repository from the [project baselines](../../baselines/README.md):
the React PWA on Cloudflare, the Rust CLI workspace, or the Python package.
You get a checkout
that passes its verify command before the first commit, with an agent file and
a first ADR that record why it looks the way it does.

It's a skill, so Claude Code and Codex both run it: describe the project
after `/new-project` in Claude Code or `$new-project` in Codex, or just ask
for a new project. For example: `/new-project a habit tracker for my phone
that works on the subway`.

## Install

Clone claude-improvements: the skill reads the baselines from the checkout.

**Inside claude-improvements**, nothing needs installing. The repo links the
skill at `.agents/skills/new-project` (Codex) and `.claude/skills/new-project`
(Claude Code), so each worktree runs its own copy of the skill, script and
baselines.

**From any other folder**, link the skill into your agent. Link it rather
than copying it: the skill's `scripts` link is relative. In these commands,
`~/src/claude-improvements` is an example: use the path of your clone.

```bash
mkdir -p ~/.agents/skills && ln -s ~/src/claude-improvements/mods/new-project/skills/new-project ~/.agents/skills/new-project
```

```bash
mkdir -p ~/.claude/skills && ln -s ~/src/claude-improvements/mods/new-project ~/.claude/skills/new-project
```

The first is for Codex and any agent that reads `~/.agents/skills`. The
second is for Claude Code. It links the whole mod, so its hook and its
**Baselines folder** option come too; linking only the skill folder works as
well. A link like this runs the code of the checkout it points at, so point it
at a checkout you keep on `main`, not at a worktree you edit.

The first run checks the tools: Node 22.18 or later, git and mise. If any is
missing, it offers to install it. Every stack tool after that comes from the
template's own pins.

## What it does

1. **Kickoff.** The agent answers every question in
   [kickoff.md](../../baselines/general/kickoff.md) from your description,
   plus the name, slug and target folder. Each answer is marked **stated**
   (you said it), **inferred** (it follows from what you said) or
   **default** (the baseline's pick). It then asks only the open ones: those
   it can't tell, and the costly-to-undo ones you didn't state, such as
   public or private, auth, personal data, offline and publishing. The rest
   come as a numbered table. Reply "ok", or override by number. The ADR
   keeps each answer's source.
2. **Baseline.** The answers pick web, Rust or Python. A brief none of them
   fits (SSR, a mobile app, a Python web service, a TypeScript package for
   npm, which gets the web README's recipe instead) stops here rather than
   forcing a template.
3. **Scaffold.** `scripts/new-project.ts scaffold` copies
   `general/files/` and the stack's `template/` into the target, renames the
   placeholders (each spells "replace me": `replace-me`, `Replace Me`,
   `ReplaceMe` and the description for web; the `replace-me` crates, folders
   and packages and `replace_me` identifiers for Rust; the `replace-me`
   project and `replace_me` package for Python), and writes:
   - `CLAUDE.md`: `general/CLAUDE.template.md` with the stack's
     `CLAUDE.stack.md` spliced in and every placeholder filled. `AGENTS.md`
     links to it.
   - `docs/adr/0001-stack.md`: the kickoff answers, and every default from the
     stack README's table, kept or changed.
   - `README.md`, and `git init`.

   It checks everything first (every kickoff question answered, names that
   are valid package and crate names, nothing left that the template CI's
   placeholder step would find) and writes nothing if a check fails.

4. **Judgment.** The agent adapts what the answers change: issue keys outside
   Linear, conventions for parts the project won't use, a license.
5. **Setup and verify.** `scripts/new-project.ts setup` runs the stack
   README's "Using it" steps through `mise exec`: install, take new majors
   (mise.toml's pins and npm packages; the Rust toolchain and crates; uv,
   just and the Python release, while `uv lock` takes every dependency's
   newest), format what the scaffold wrote, then `pnpm verify` or
   `just verify`. A major that breaks verify is reverted and recorded in the
   ADR, and `--keep-versions` reruns without taking majors again.
   `--stack web`, `--stack rust` or `--stack python` names the baseline, which
   a folder holding more than one manifest (a Rust tool with an npm wrapper or
   Python bindings) needs. The agent reports the result and offers the
   first commit. Nothing is pushed.

## Where the baselines come from

`scripts/new-project.ts doctor` names the folder and where the name came
from. It takes the first of these that is set:

1. `--baselines`;
2. `$NEW_PROJECT_BASELINES`;
3. `baselines/` in the claude-improvements checkout the script sits in.

Node resolves links, so a linked skill folder still finds its checkout. In
Claude Code, the mod's **Baselines folder** option, when set, is passed as
`--baselines`. If no folder holds `general/kickoff.md`, the skill asks for
one.

## Needs

Node 22.18 or later for the script, git and mise. The stacks' own tools (pnpm,
Playwright's browsers, Rust, just, nextest, cargo-deny, cargo-shear, uv,
Python, ruff, ty) come from each template's `mise.toml`, toolchain files and
lockfiles.

## Develop

The mod keeps to the web template's rules: its oxlint and oxfmt settings,
copied here, and its `tsconfig.base.json` strictness, extended. From
`mods/new-project`, `pnpm install` once (pnpm 12, as the template pins), then

```bash
pnpm verify
```

type-checks, lints, checks formatting and runs both the plugin's validation and
the tests below. `claude-code.d.ts` types the part of Claude Code's plugin API
the hook and its tests use; widen it when they use more. Each step also runs on
its own:

```bash
claude plugin validate mods/new-project
```

```bash
claude plugin test mods/new-project
```

The tests cover the hook that finds the baselines and the text work in
`scripts/compose.ts`. The plugin test kit has no file system, so the rest run under Node: they
scaffold every stack from the real `baselines/`, run the template CI's
placeholder check on the result, and run doctor through a linked skill
folder:

```bash
mise exec -- node --test mods/new-project/tests/baselines.node.mts
```

After changing a baseline or the script, scaffold each stack into a scratch
folder and run setup there:

```bash
node mods/new-project/scripts/new-project.ts scaffold --answers answers.json --target /tmp/np-web
```

```bash
node mods/new-project/scripts/new-project.ts setup /tmp/np-web
```
