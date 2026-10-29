# Web baseline

A client-rendered, offline-capable React PWA on Cloudflare, built for agents:
every check is local, fast, strict, and says how to fix what it finds.
[`template/`](template/) is a working starter that passes `pnpm verify`
(typecheck, lint, format, unit and story tests, build, end-to-end with an
offline check). [`CLAUDE.stack.md`](CLAUDE.stack.md) is the web part of the
new repo's agent file.

Versions and statuses were checked on 2026-10-20.

## Using it

1. Ask the [kickoff questions](../general/kickoff.md). The template fits a
   SPA/PWA; see [Choosing the shape](#choosing-the-shape) if the answers say
   otherwise.
2. Copy `template/` and `../general/files/` into the new repo. Every
   placeholder spells "replace me": `replace-me` (package.json,
   wrangler.jsonc), `Replace Me` and a `Replace me: …` description
   (index.html, the manifest in vite.config.ts, the home route and its e2e
   test) and `ReplaceMe` (the manifest's short name, at most 12 characters).
   `git grep --untracked -niE 'replace[-_ ]?me([^a-z]|$)'` lists what's left, and CI
   fails while any remain.
   Run `git init -b main` if this is not already a Git repository.
3. `mise install && pnpm install && pnpm exec playwright install chromium webkit`.
   The template has no lockfile, so this resolves the newest release each
   range allows: a caret on 0.x takes patches only, and StyleX is pinned
   exactly. Step 4 takes the rest.
4. Take new majors too: raise the pins in this repo's `mise.toml` and
   `packageManager` in package.json by hand, then `pnpm up --latest` and
   `pnpm verify`. If a major breaks verify, revert that one and note it in
   the stack ADR. Commit `pnpm-lock.yaml`. Not `mise up`: it also upgrades
   the tools in your global mise config and uninstalls their old versions.
5. Build `CLAUDE.md` from [`CLAUDE.template.md`](../general/CLAUDE.template.md)
   plus [`CLAUDE.stack.md`](CLAUDE.stack.md); `ln -s CLAUDE.md AGENTS.md`.

Pre-commit uses Lefthook (pinned in `mise.toml`) on staged files only, with
independent jobs in parallel and formatter fixes re-staged. typos checks
American English spelling. `pnpm install` installs hooks through `prepare`. oxfmt runs before type-aware oxlint
(warnings denied).

The target is under five seconds after installing dependencies. A commit with
no matching files skips the corresponding jobs. `git commit --no-verify`
bypasses hooks; full verify and CI remain required.

## The stack

| Area | Default | Why | Instead, when |
|---|---|---|---|
| Runtime and packages | Node 26 (mise), pnpm 12 | Node 26 is LTS from late October 2026. pnpm 12 refuses releases younger than a day and asks before installing into a stale `node_modules` | — |
| Build | Vite 8 (Rolldown) | The fast default; Lightning CSS built in | A package published to npm: see [Publish an npm package](#publish-an-npm-package) |
| Types | TypeScript 7 (native `tsc`) | `typescript@7` *is* the Go compiler; `tsgo`/native-preview are legacy names | — |
| Strictness | ES modules everywhere (always strict mode; the service worker, built as a classic script, gets `'use strict'` added); `<StrictMode>`; TypeScript `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and friends; React Compiler `panicThreshold: 'all_errors'`; unit tests must assert; e2e fails on page errors, console errors and CSP violations; pnpm `engineStrict` | Each turns a silent problem into a failure that names it | — |
| Lint | oxlint + type-aware (tsgolint) | Correctness and suspicious categories only; StyleX and React Compiler rules included. Detects agents and prints one line per finding | — |
| Format | oxfmt | Prettier-compatible and much faster; sorts imports. Still beta, but differences from Prettier count as bugs | Prettier if oxfmt blocks on a file type it can't format |
| UI | React 19.3 + React Compiler | Largest ecosystem; the compiler removes manual memoisation | Preact for a tiny shell on low-end devices; Solid for heavy interactivity; Svelte for a greenfield project outside React; Astro for content sites |
| Routing | TanStack Router, file-based | Paths, params, loaders and search params are typed end to end; search params validated by any Standard Schema | React Router 8 framework mode if adopting its server rendering |
| Styling | StyleX | Build-time atomic CSS, typed style props, tokens as variables. Dev class names are readable (`Button__styles.root`) | — |
| Primitives | Native elements: `<button>`, `<dialog>`, the Popover API | No JavaScript to ship; keyboard, focus and disabled behavior come from the platform. React Aria cost 11.7 KB gzipped for one Button; a Menu is +28 KB with Radix, +48 KB with React Aria | A headless library per widget the platform lacks; see [explorations/ui-primitives](../explorations/ui-primitives.md) |
| Tokens | TypeScript (`palette.ts` → `defineVars` via `stylex.env`) | One source for StyleX and the APCA test; no DTCG pipeline until Figma interchange is needed | Style Dictionary or Terrazzo when a designer owns tokens |
| Contrast | APCA via `colorjs.io` in a unit test | Fails the build with the pair and its Lc. `apca-w3`'s license restricts shipping it | — |
| Icons | Lucide (`lucide-react`) | ISC, about 1,900 icons, per-icon imports; `aria-hidden` unless labeled | Tabler for breadth; `unplugin-icons` for several sets |
| Fonts | System stack in the template | Neutral starting point | Self-host one Latin-only variable family from `@fontsource-variable` (about 20–50 KB) and precache it once the design has a typeface |
| PWA | vite-plugin-pwa 2 with Workbox 7, `injectManifest`, `registerType: 'prompt'` | The worker is source (`src/sw.ts`) built from Workbox modules, ready for custom handlers; updates wait for consent, unless `public/update-policy.json` forces them, and a kill switch removes a broken worker ([recipe](#recover-from-a-broken-service-worker)) | `generateSW` (Workbox writes the whole worker from config) when it will only ever precache, fall back to the shell and cache by URL pattern. Serwist (`@serwist/vite`), a maintained Workbox fork, if Workbox stalls. Workbox's last release was 7.4.1 in 2026-05; Serwist's was 9.5.13 in 2026-10 |
| Server state | TanStack Query v5 (add when there are requests) | Caching, retries, offline mutation queue | — |
| Client state | Jotai 3, installed | Atoms beside the feature instead of prop drilling or context; derived state without a store | — |
| Requests | Hono RPC + Zod 4 (`zod/mini` in the client) | Typed client with no codegen, native to Workers | oRPC when an OpenAPI contract is needed; `openapi-fetch` for third-party APIs |
| Dates and numbers | `Intl` + Temporal (polyfill only where missing) | Native; one formatter module with an explicit locale and zone | Paraglide JS (or Lingui) when translation becomes real |
| Unit tests | Vitest 5, node | Same config as the build | — |
| Component tests | Storybook 10 stories under Vitest browser mode, axe (WCAG A/AA) as an error | One fixture source for docs, interaction tests, a11y and visual capture | Plain Vitest browser tests (`vitest-browser-react`) for a small app with no catalogue |
| End to end | Playwright 1.64: page objects via fixtures, shared constants, axe fixture, aria snapshots, reduced motion | Real production build, Chromium and WebKit, offline check | — |
| Accessibility checks | axe with WCAG A/AA rules only, `color-contrast` off, one config in `tests/axe.ts` | Best-practice rules are noise in isolated stories; WCAG 2 contrast conflicts with APCA and is axe's usual flaky rule | — |
| PR screenshots | `pnpm screenshots` captures every story and every screen in `paths` (both browsers); for a visible change, the agent puts the one or two that show it in the PR description, before and after | A reviewer sees a visual change without checking out the branch, and no CI job needs a write token. Images go on an orphan `screenshots` branch, so a private repo's stay private | A CI job that compares every capture with `main`'s and posts the differences, if picked screenshots start missing changes |
| Visual regression | None in the template beyond the PR screenshots above. A project that needs pixel assertions uses the built-in ones (Playwright `toHaveScreenshot`, Vitest `toMatchScreenshot` on stories), with baselines generated only in CI or a pinned Docker image | No service, no account; pinning the environment is what keeps pixels stable | A dedicated, agent-oriented visual regression tool is in development and is meant to take over pixel diffs, while PRs keep their screenshots; see [explorations/visual-regression](../explorations/visual-regression.md) |
| Hosting | Cloudflare Workers static assets | Free static hosting, one deploy for app and API | See [infra.md](../general/infra.md) |
| Security headers | A strict same-origin CSP, COOP, CORP and HSTS in `public/_headers`; `vite preview` applies them and every e2e test fails on a CSP violation | StyleX emits a CSS file and Vite no inline scripts, so the policy needs no `unsafe-inline` | Trusted Types once a default policy covers the service worker's registration |
| Local checks | `pnpm verify` before every handoff. While iterating, `pnpm verify:changed` (`scripts/verify-changed.ts`): `tsc -b`, lint and format on changed files only, then `vitest run --changed`. Changes are counted against `$VERIFY_BASE`, the Graphite parent or `main`, from the merge base, including uncommitted and untracked files | Vitest's module graph picks the unit tests and stories a change reaches, and a config or `package.json` change reruns them all. End-to-end tests stay in `verify` and CI: `playwright --only-changed` can't see app changes. With no e2e, a small change checks in a few seconds | CI as the only gate for a batch of small PRs, with `verify:changed` locally, once full `verify` gets slow |
| CI | One `verify` job running `pnpm verify`, behind a single required `ci` check. Draft PRs skip `verify`; marking a PR ready runs it. Playwright's browsers are cached per Playwright version | Agents open many PRs as drafts, so each draft push runs only the short `ci` job until someone marks the PR ready. A browser cache hit skips the download, which has spiked to 8–10 minutes | Selecting tests by changed files, once the suite is slow enough to matter; see [CI and local check speed](../general/ci-speed.md#by-shape) |
| Deploy | CI's `deploy` job on `main`, its token in a `production` environment limited to `main` | No other branch's workflow can read the token, and it never shares a runner with the test run. In a session, `.claude/hooks/guard-deploy.ts` refuses production deploys and lets previews (`wrangler preview`) and dry runs through; it reads the command as text, so it catches an agent's mistake, not a deliberate workaround | — |

**Not in the baseline, on purpose:** lodash-style utilities (use the
platform), an immutability helper (spread and `toSorted`/`with` cover it;
`mutative` if nested updates get painful), Effect (an architectural choice
for an ADR, not a default), TanStack Pacer (beta; a debounce plus
`AbortController` is a few lines), MSW (see below), Tailwind, Vue, Angular.

## Choosing the shape

| Requirement | Shape |
|---|---|
| Offline app, no SEO | **This template**: Vite SPA + service worker on Workers static assets |
| Needs an API | Add a Hono Worker to the same project ([recipe](#add-an-api)) |
| App pages need SSR or SEO | TanStack Start 1.0 on `@cloudflare/vite-plugin` (keeps TanStack Router; can prerender or run as SPA) |
| Content or marketing site | Astro 7 on Workers static assets, React islands where needed |
| Must be Next.js | Next 16 via `@opennextjs/cloudflare`; only if required |
| A package published to npm | `tsc` with `isolatedDeclarations`, not Vite ([recipe](#publish-an-npm-package)) |

## Decisions still open

- **StyleX maturity.** It is 0.x with open issues that matter to a PWA: a
  chunk can change without its hashed name changing (facebook/stylex#1918,
  worked around by giving every precache entry a content revision), and
  lazily loaded CSS can arrive about 150 ms late in dev (#1919). Pin it
  exactly and re-check each release.
- **Astryx** (Meta's StyleX design system, MIT, 0.7, public beta since
  2026-06) is off-the-shelf theming, so it is not the base. Its conventions
  are worth borrowing: an `xstyle` prop, CSS layers so library styles sit
  below yours, prefixed class names. Revisit at 1.0.
- **Visual testing** stays on Storybook. No faster, maintained
  Storybook rival turned up (Ladle bundles Vite 6, Histoire is Vue-first,
  Lost Pixel is archived). Playwright component testing is now stable and
  could replace Storybook for tests, but not as a catalogue. Pixel diffs move
  to the in-house visual regression tool once it is ready.
- **MSW 3** (2026-09) is worth adopting once there is a real request layer
  (several endpoints, loading and error states worth showing in stories):
  one set of handlers serves dev, Vitest, Playwright (`@msw/playwright`) and
  Storybook. Until then, inject a typed API client and pass fakes. Check that
  `msw-storybook-addon` supports MSW 3 before adopting.

## Recipes

### Add an API

1. `pnpm add hono zod @hono/standard-validator` and
   `pnpm add -D @cloudflare/vite-plugin`.
2. Write `worker/index.ts` exporting a Hono app with routes under `/api`,
   validated with `@hono/standard-validator`. Chain the routes in one
   expression (`const routes = app.get(…).post(…)`) and
   `export type AppType = typeof routes`: the client only infers routes it
   can see in that type.
   Start it with `secureHeaders()` (`_headers` never applies to Worker
   responses), `bodyLimit({ maxSize: 64 * 1024 })`, `csrf()` and a rate
   limit: `const { success } = await env.API_LIMIT.limit({ key })`, keyed by
   user or IP, answering 429 when `success` is false. Authenticate before
   touching D1, R2, KV or AI, and send
   `Cache-Control: no-store` on authenticated responses.
3. In `wrangler.jsonc` add `"main": "worker/index.ts"`,
   `"assets": { …, "run_worker_first": ["/api/*"] }`, and the guards a
   Worker needs because it has no spend cap:
   ```jsonc
   "limits": { "cpu_ms": 50 },
   "ratelimits": [{ "name": "API_LIMIT", "namespace_id": "1001", "simple": { "limit": 100, "period": 60 } }],
   "observability": { "enabled": true },
   "upload_source_maps": true,
   "previews": {
     "ratelimits": [{ "name": "API_LIMIT", "namespace_id": "1002", "simple": { "limit": 100, "period": 60 } }],
   },
   ```
   `namespace_id` is account-wide: bindings that share one share their
   counters, even across Workers, so pick numbers nothing else in the
   account uses. A Preview takes no bindings from the top level, so without
   its own `API_LIMIT` every `/api` request in it fails; its own number
   keeps preview traffic off production's counters. Once it has a custom
   domain, set `"workers_dev": false` and `"preview_urls": false`: zone WAF
   and rate-limit rules don't cover `*.workers.dev`. Previews then need a
   domain of their own (a route with `"previews_enabled": true`) to get a
   URL. Add a budget alert in the dashboard as well.
4. Add `cloudflare()` from `@cloudflare/vite-plugin` to vite.config.ts so
   dev and preview run the Worker in workerd.
5. Run `wrangler types`, commit `worker-configuration.d.ts`, add a
   `tsconfig.worker.json` that includes it, and add `wrangler types --check`
   to `verify`.
6. In the app, `hc<AppType>('/')` gives a typed client; wrap calls in
   TanStack Query.

### Add server state

`pnpm add @tanstack/react-query`. One `QueryClient` in `main.tsx`; query
keys and fetchers live beside the feature. Jotai is already installed for
client state: atoms live beside the feature that owns them, and
`jotai-family` adds parameterised atoms (Jotai 3 moved `atomFamily` out).

### Add a typeface

`pnpm add @fontsource-variable/<family>`. Variable packages ship no
per-subset CSS, and importing the package emits every subset into the
precache, so declare the Latin file yourself in `src/index.css`. One
`@font-face` for `'<Family> Variable'`, whose `src` is
`url('@fontsource-variable/<family>/files/<family>-latin-wght-normal.woff2')`
(Vite resolves the package path) and whose `font-weight` is the family's
weight range (`100 900` for Inter; without it, bold is synthesized from the
regular weight). Then one for a metric-matched
`'<Family> Fallback'` (`src: local('Arial')` with `size-adjust` and
`ascent-override`). Put both first in `font.body` in `tokens.stylex.ts`.
`woff2` is already in the precache glob, so the font works offline.

### Publish an npm package

Use this for a TypeScript package published to npm, and for internal
monorepo libraries built through project references. Apps leave
`isolatedDeclarations` off: exported inferred values such as TanStack
Router's `Route`, Jotai atoms and components would all need hand-written
types, and an app emits no `.d.ts`.

1. Compile with `tsc` from an emitting tsconfig, so every export states its
   own type and any declaration emitter can produce the `.d.ts`. It extends
   the template's `tsconfig.base.json` for the strict flags, then switches
   to Node's module rules, since Node loads the output, not Vite. Relative
   imports keep their `.ts` extension, as in the app, and are rewritten to
   `.js` on emit:
   ```jsonc
   // tsconfig.build.json
   {
     "extends": "./tsconfig.base.json",
     "compilerOptions": {
       "module": "nodenext",
       "moduleResolution": "nodenext",
       "rewriteRelativeImportExtensions": true,
       "lib": ["ES2024"],
       "types": [], // ["node"] if the package uses Node's APIs
       "noEmit": false,
       "rootDir": "src",
       "outDir": "dist",
       "declaration": true,
       "declarationMap": true,
       "isolatedDeclarations": true,
     },
     "include": ["src"],
   }
   ```
2. Write the `exports` map by hand, `types` first in each entry, and list
   what ships in `files`. Ship `src` too, so the declaration maps lead
   editors to the source:
   ```json
   "type": "module",
   "exports": {
     ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
     "./cli": { "types": "./dist/cli.d.ts", "default": "./dist/cli.js" }
   },
   "files": ["dist", "src"],
   "scripts": {
     "build": "tsc -p tsconfig.build.json",
     "check-package": "publint run --strict ."
   }
   ```
3. Run `build`, then `check-package`, in `verify`, which CI runs. publint
   fails when a field such as an `exports` path, `bin` or `types` doesn't
   match what `pnpm pack` produces.
4. Add a packed-consumer type test to `verify`: `pnpm pack` into a temporary
   directory, install the tarball into a scratch project, and run
   `tsc --noEmit` on a file that imports every export path, once with
   `"moduleResolution": "nodenext"` and once with `"bundler"`. It catches a
   `types` file that exists but declares the wrong thing, which publint
   can't see.

Leave out attw (`@arethetypeswrong/cli`): it brings its own copy of
TypeScript, and the type test covers the same ground. Bring in tsdown only
when the package needs a real bundle (inlined dependencies, CJS, or a single
file); see [explorations/tsdown](../explorations/tsdown.md).

### Recover from a broken service worker

An installed worker keeps serving its precached app until a newer worker
takes over. Browsers check `/sw.js` on every navigation, and `public/_headers`
keeps it uncached, so a fixed worker is found on the next visit. Whether it
takes over depends on how broken the old one is. Pick the mildest of these
that works:

1. **The app still runs and shows its update prompt.** Ship the fix as
   usual. Users see "A new version is available", and tabs left open check
   hourly.
2. **Everyone must leave an old build now** (it loses data, or has a
   security hole), but its page still runs. In the fix's PR, set
   `public/update-policy.json` to `{ "forceUpdateBefore": "<now, in UTC>" }`.
   Open copies of any build made before that instant install the fix and
   reload without asking, on their next load or hourly check. That reloads
   every tab of the app, the one in use included, possibly mid-edit, so
   keep it for real emergencies. Set the field back to `null` in a later PR.
   Only builds that already have `src/lib/update-policy.ts` can read the
   policy.
3. **The page can't update** (it never renders, or every navigation fails).
   Use the kill switch. Run the ci workflow on `main` from the Actions tab
   with **kill switch** checked. It deploys main's app with
   `src/kill-switch/sw.ts` as `/sw.js`. On each user's next visit, that
   worker:
   - installs without the prompt;
   - deletes the app's Cache Storage;
   - unregisters;
   - reloads open tabs from the network.

   IndexedDB, localStorage and cookies stay. The kill-switch page registers
   no worker, so the app runs online-only until the next push to `main`
   deploys the real worker again. Any push ends it, so hold merges to
   `main` until most users have visited. That's at least the app's usual
   return interval: a user who hasn't been back yet would otherwise meet
   the broken worker again. Then land the fix as a normal PR.

The kill switch also deletes any Cache Storage the app filled itself, and it
can't reach a browser that never visits again. `tests/e2e/service-worker.spec.ts`
covers all three cases against real builds.

## Sources

- **The starting point**: Christoph Nakazawa,
  [Fastest Frontend Tooling](https://cpojer.net/posts/fastest-frontend-tooling)
  (read in its 2026-09-30 revision). It recommends native TypeScript,
  oxlint with type-aware rules, oxfmt, Vite and pnpm. This template differs
  in four ways:
  - TypeScript 7 ships the native compiler as `tsc`, so there is no `tsgo`.
  - Lint is the correctness and suspicious categories rather than the
    post's strict `@nkzw/oxlint-config` preset.
  - The React Compiler's `panicThreshold` fails the build, so no ESLint is
    kept for its rules.
  - `verify` runs its steps in order and stops at the first failure, rather
    than in parallel.
- **The update prompt**: Workbox's
  [Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)
  and web.dev's [PWA update](https://web.dev/learn/pwa/update) guide.
- **The `.claude/` hooks**: Claude Code's
  [hooks guide](https://code.claude.com/docs/en/hooks-guide).
