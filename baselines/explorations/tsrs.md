# tsrs (exploration)

Status: **not the default.** The web template typechecks with TypeScript
7's `tsc`. Checked on 2026-10-21.

## What it is

[`tsrs`](https://github.com/oxc-project/tsrs) is the oxc project's Rust port
of the TypeScript 7 type checker and language server, announced on the
Cloudflare blog. It aims to be a drop-in replacement with 100% conformance,
lower memory and faster checking.

- Version 0.18.0 (`0.18.0-ts7.1.0-dev.20260929` on npm), released
  2026-10-19; the repo is three weeks old, Apache-2.0, with frequent
  releases.
- Tracks TypeScript's main branch; a stable release is planned against
  TypeScript 7.1.
- Pull requests are closed to outside contributors for now; issues are open.
- `--init` and `--showConfig` aren't supported. Diagnostic order can differ
  from `tsc` in some cases, by design.

## Tried on the web template

`pnpm add -D tsrs`, then `pnpm exec tsrs -b`: it handled the template's
project references (app, service worker, node) with no errors, and reported
the same `TS2322` diagnostic as `tsc` for a planted type error. The template
is too small for a speed comparison; both finish in well under a second.

## Adopting it in a project

1. `pnpm add -D tsrs` (the npm version carries the TypeScript build it
   tracks).
2. Change the `typecheck` script from `tsc -b` to `tsrs -b`. Keep the
   `typescript` package: Vite, Vitest, Storybook and type-aware oxlint read
   its library files and API.
3. Optionally point the editor at its language server (see its LSP docs).

## Switch when

- It has a stable release against TypeScript 7.1, and
- a project's typecheck is slow or memory-hungry enough to matter, which
  first shows up in the Stop hook and in CI.

Until then, `tsc` from TypeScript 7 is already native and fast enough for
these templates.
