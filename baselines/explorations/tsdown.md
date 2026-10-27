# tsdown (exploration)

Status: **not the default.** A TypeScript package that's published to npm compiles with
TypeScript 7's `tsc` and checks what it would publish with publint. Checked on
2026-10-27, against the npm package of an in-house visual regression tool in development.

## What it is

[tsdown](https://tsdown.dev) is the Rolldown-based library bundler from the Rolldown and Vite
team. It replaces tsup: tsup's README now says it "is not actively maintained anymore. Please
consider using tsdown instead."

- **Version:** 0.23.2 on npm, released 2026-10-23, on rolldown 1.2.15. It is still 0.x, with no
  1.0 or semver statement. 0.23.0 (2026-09-03) removed options, dropped Node 25 and changed the
  default attw profile. 0.23.2 depends on a beta of its declaration plugin
  (`rolldown-plugin-dts ^0.29.0-beta.2`).
- **Defaults:** it reads `package.json`. ESM is the default output, and the docs call CJS
  "maintenance-only". `engines.node` sets the target, and declarations are generated when
  `types` is set. It can rewrite `exports` (`exports: true`).
- **Built-in options:**
  - an unbundled mode (`unbundle: true`);
  - a workspace mode (`-W`, `-F <package>`);
  - publint and attw (`publint`, `attw`, with `'ci-only'`);
  - executable bundling.
- **Declarations:** it uses Oxc when `isolatedDeclarations` is on and the TypeScript API
  otherwise. On TypeScript 7.0 that API doesn't exist, so the build stops with:
  > TypeScript 7.0.2 does not provide the classic TypeScript API required by tsc. Please use
  > TypeScript 6.0 or below, or enable `isolatedDeclarations`

  The `tsgo` path needs TypeScript 7.1 (beta since 2026-10-20) and is marked experimental.

## Tried on an in-house npm package

The package is ESM-only, with one output file per source module, a `bin` with a shebang and
committed output. The tsdown build was unbundled, with two configs to keep `.ts → .js` and
`.mts → .mjs`, and `isolatedDeclarations` on (8 annotations).

| | `tsc` (TypeScript 7.0.2) | tsdown 0.23.2 |
|---|---|---|
| Build, median of 10 | 95 ms, type checking included | 144 ms, no type checking |
| Output | 47 files | the same files plus a stray `.d.mts` for the bin. Non-JSDoc comments are dropped, imports hoisted and exports collected at the end |
| `.d.ts` | `tsc` | Oxc: the same API, verified by the package's packed-consumer type test |
| `exports: true` | hand-written map | wrong: every module under `./lib/*`, with subpaths and `types` conditions dropped |
| publint 0.3.25, attw 0.18.5 (`esm-only`) | clean | clean |
| Package tests (391) | pass | pass |

It works, but for a package that maps source files one to one onto output files it is slower
than `tsc` and still needs `tsc --noEmit`. Its generated `exports` would need rewriting by hand.

## What we do instead (kept from the trial)

- Compile with `tsc` and set `isolatedDeclarations: true` in the emitting tsconfig. Every
  export then states its own type, and any declaration emitter, tsdown's Oxc path included,
  can produce the `.d.ts` later without code changes.
- Check the package before it's published:

  ```json
  "check-package": "publint run --strict ."
  ```

  It runs in the verify script and CI. A `package.json` field that doesn't match what
  `pnpm pack` produces, such as an `exports` path pointing at a missing file, fails it.
- Leave out attw (`@arethetypeswrong/cli`), even though it passed in the trial. It brings its
  own copy of TypeScript alongside the project's, a second compiler to install and keep in step.
  A type test that compiles a consumer file against the packed tarball covers the same ground
  without it.

The in-house package runs both.

## Switch when

- A package needs a real bundle: inlined dependencies, CJS alongside ESM, or a single file to
  publish; or
- TypeScript 7.1's declaration API is stable in tsdown and tsdown has reached 1.0.

Then add tsdown with `unbundle` as needed, keep `tsc --noEmit` for type checking, and keep the
hand-written `exports` unless the generated one matches.
