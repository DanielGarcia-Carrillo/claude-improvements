# new-project

`/new-project` starts a repository from the [project baselines](../../baselines/README.md):
the React PWA on Cloudflare, or the Rust CLI workspace. You get a checkout
that passes its verify command before the first commit, with an agent file and
a first ADR that record why it looks the way it does.

## What it does

1. **Kickoff.** Claude asks the questions in
   [kickoff.md](../../baselines/general/kickoff.md) in one message, each with a
   recommended answer, plus the name, slug and target folder. Reply "ok", or
   override by number.
2. **Baseline.** The answers pick web or Rust. A brief neither fits (SSR, a
   mobile app, a Python service) stops here rather than forcing a template.
3. **Scaffold.** `scripts/new-project.ts scaffold` copies
   `general/files/` and the stack's `template/` into the target, renames the
   placeholders (each spells "replace me": `replace-me`, `Replace Me`,
   `ReplaceMe` and the description for web; the `replace-me` crates, folders
   and packages and `replace_me` identifiers for Rust), and writes:
   - `CLAUDE.md`: `general/CLAUDE.template.md` with the stack's
     `CLAUDE.stack.md` spliced in and every placeholder filled. `AGENTS.md`
     links to it.
   - `docs/adr/0001-stack.md`: the kickoff answers, and every default from the
     stack README's table, kept or changed.
   - `README.md`, and `git init`.

   It checks everything first (every kickoff question answered, names that
   are valid package and crate names, nothing left that the template CI's
   placeholder step would find) and writes nothing if a check fails.

4. **Judgment.** Claude adapts what the answers change: issue keys outside
   Linear, conventions for parts the project won't use, a licence.
5. **Setup and verify.** `scripts/new-project.ts setup` runs the stack
   README's "Using it" steps through `mise exec`: install, take new majors
   (mise.toml's pins and npm packages; the Rust toolchain and crates), format what the
   scaffold wrote, then `pnpm verify` or `just verify`. A major that breaks
   verify is reverted and recorded in the ADR, and `--keep-versions` reruns
   without taking majors again. `--stack web` or `--stack rust` names the
   baseline, which a folder holding both package.json and Cargo.toml (a Rust
   tool with an npm wrapper) needs. Claude reports the result and offers the
   first commit. Nothing is pushed.

## Where the baselines come from

The mod looks two folders up, at `baselines/` in the claude-improvements
checkout it runs from. A copy installed elsewhere needs the **Baselines
folder** option set to a checkout's `baselines` folder; without it,
`/new-project` says so instead of starting.

## Needs

Node 23.6 or later for the script, and mise. The stacks' own tools (pnpm,
Playwright's browsers, Rust, just, nextest, cargo-deny, cargo-shear) come from
each template's `mise.toml` and lockfiles.

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
`scripts/compose.ts`. The plugin test kit has no file system, so the test that
scaffolds both stacks from the real `baselines/` and runs the template CI's
placeholder check on the result runs under Node:

```bash
node --test mods/new-project/tests/baselines.node.mts
```

After changing a baseline or the script, scaffold each stack into a scratch
folder and run setup there:

```bash
node mods/new-project/scripts/new-project.ts scaffold --answers answers.json --target /tmp/np-web
```

```bash
node mods/new-project/scripts/new-project.ts setup /tmp/np-web
```
