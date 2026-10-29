<!--
Web stack fragment. Splice each section into the matching
"stack fragment" marker of general/CLAUDE.template.md, then delete what the
project does not use (an API, Storybook) and these comments.
-->

## Commands

```bash
pnpm dev               # Vite dev server; the service worker is off in dev
pnpm verify            # spelling, typecheck, lint, format check, every test suite: the gate
pnpm verify:changed    # while iterating: typecheck, then lint, format and Vitest for changed files only; no e2e
pnpm test              # Vitest: unit tests (node) and every story in a real browser
pnpm e2e               # Playwright against a production build and preview server
pnpm e2e:report        # the newest local run's HTML report, with each test's trace
pnpm lint:fix          # safe autofixes; then `pnpm format`
pnpm storybook         # component workshop on :6006 or the next free port
pnpm build:kill-switch # emergency only: the service worker kill switch (README, "Recover from a broken service worker")
```

Node comes from `mise.toml`, pnpm from `packageManager`. If pnpm says
dependencies are out of date, run `pnpm install` once; it will not install
by itself.

Spelling: `typos` enforces American English, including hooks and CI config.
It runs in verify, CI and edit/stop hooks; `mise install` installs its pinned version.

## Conventions

- **Styling is StyleX.** Styles live beside their component in
  `stylex.create`; colors, spacing, radii and motion come only from the
  tokens in `src/theme/*.stylex.ts`, never literals. A component that accepts
  styling takes a typed `xstyle` prop (`StyleXStyles<{ …allowed properties }>`),
  never a class name. Interaction states are pseudo-classes on native
  elements: `:active`, `:focus-visible`, `:disabled`, and `:hover` only inside
  `@media (hover: hover)` so it doesn't stick after a tap.
- **Dark mode, reduced motion and contrast are token concerns.** Tokens change
  under `prefers-color-scheme`, `prefers-reduced-motion` and
  `prefers-contrast`; components never test those media queries themselves.
  Borders stay `transparent` rather than absent so forced-colors mode paints
  them.
- **Color values live in `src/theme/palette.ts`**, the one source the
  StyleX tokens and the APCA test both read. Every foreground/background pair
  the app draws is listed in `src/theme/contrast.test.ts` and must reach APCA
  Lc 75 for body text, 60 for UI text, 45 for non-text, in both themes. Add
  the pair when you add the combination.
- **Native elements first.** `<button>`, `<a>`, `<input>`, `<dialog>` and
  the Popover API cover most widgets with no JavaScript. Add a headless
  library only for a widget the platform lacks (combobox, menu with
  typeahead, date picker), per widget, and record it in an ADR.
- **Accessible by construction.** Every page passes the axe fixture in
  `tests/e2e/fixtures.ts` and every story the same rules; both read
  `tests/axe.ts`. If axe flags something, fix it; don't disable a rule
  without a reason written there.
- **Dates, times and numbers go through `src/lib/intl.ts`** with an explicit
  `Viewer` (locale and zone). The clock and the viewer are read at the edges
  (route loaders), never inside components; tests pin locale and zone.
- **Component tests are stories.** A story's play function is its
  interaction test and runs under Vitest with axe; don't add a separate test
  file that renders the same component.
- **A visible change gets a screenshot in its PR.** `pnpm screenshots`
  captures every story and every screen in `paths`, in both browsers, into
  `screenshots/stories/` and `screenshots/screens/`. Put the one or two that
  show the change best in the PR's Screenshots section; if the change alters
  something that exists, run the same command in a scratch worktree of
  `main` for the before. A new screen is captured once its path is in
  `paths`; anything that changes by itself (dates, live data) goes in
  `VOLATILE` in `tests/e2e/screens.spec.ts`.
- **Strictness is on everywhere and stays on.** Don't loosen a tsconfig
  flag, the React Compiler's `panicThreshold`, Vitest's `requireAssertions`
  or the e2e error fixtures to get green; fix the code. A compiler bail-out
  names the Rule of React it hit.
- **Values tests share with the app** (paths, test ids) live in
  `src/constants.ts`. Locate by role and accessible name first.
- **Page objects** in `tests/e2e/pages/` expose locators and actions; specs
  hold the assertions and import `test`/`expect` from `tests/e2e/fixtures.ts`.
- **State**: server data through TanStack Query, client state in Jotai atoms
  beside the feature that owns them. State a component doesn't use itself
  comes from an atom, not a prop passed through. No global store module.
- **Routes** are files under `src/routes/` (TanStack Router). The plugin
  regenerates `src/routeTree.gen.ts` on dev and build; commit it.

## Traps

- **The service worker is generated from `src/sw.ts`.** `dist/sw.js` is
  rebuilt on every build, and dev runs without a worker. Test offline
  behavior against `pnpm e2e`, or `pnpm build` then `pnpm preview`.
- **`public/update-policy.json` stays `{ "forceUpdateBefore": null }`**
  except in an emergency fix's PR. A date there makes every open tab of an
  older build reload without asking. The kill switch is deployed only from
  the Actions tab, never from a session.
- **The precache lists extensions, never `**/*`.** `public/_headers` is read
  by Cloudflare at deploy and never served; precaching a URL that 404s fails
  the worker's install, which kills offline mode silently.
- **StyleX: per-property conditions only.** A top-level `'@media …': {}`
  block fails `@stylexjs/valid-styles`. Write
  `color: { default: x, '@media …': y }` instead. Unused style keys still
  ship CSS; `@stylexjs/no-unused` is the guard.
- **StyleX keeps Vitest's server open** until facebook/stylex#1846 is
  released; `test.teardownTimeout` in vite.config.ts works around it. Remove
  it once a StyleX release includes the fix.
- **Never deploy production from a session.** CI deploys `main`;
  `.claude/hooks/guard-deploy.ts` refuses production deploys, rollbacks and
  secret changes. Previews are fine: `wrangler preview` gives the branch its
  own URL and only the bindings in `wrangler.jsonc`'s `previews` block, while
  `wrangler versions upload` would carry production's. `--dry-run` and a
  non-production `--env` pass too.
- **The CSP lives in `public/_headers`** and `vite preview` applies it, so
  e2e fails on any violation. A new third-party origin (fonts, analytics,
  an API) goes into the matching directive there, not into an inline
  `<script>` or `<style>`.
- **Every e2e run keeps to itself.** Playwright finds its server from the
  server's output, never a fixed port, and a local run writes its build,
  traces and report to its own `test-results/<time>-<pid>/`, so sessions
  sharing a checkout or running in worktrees never test or wipe each
  other's builds and results. Keep `webServer.wait`, don't add a `port`,
  and don't point the e2e build back at `dist/`, which only `pnpm build`
  writes.
