# Infrastructure, CI and tooling

Defaults for hosting, data, CI and toolchains, with the alternatives worth
knowing. Prices and versions were checked on 2026-10-20; re-check anything
that decides a purchase.

## Hosting: Cloudflare Workers with static assets

New projects use **Workers with static assets**, not Pages. Pages is still
supported but Cloudflare puts all new investment into Workers
([announcement](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/),
[migration guide](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)).
Workers-only features include the Vite plugin, gradual deployments, Workers
Logs, cron triggers and queue consumers.

- **Config** is `wrangler.jsonc` with
  `"$schema": "./node_modules/wrangler/config-schema.json"`.
- **Types**: `wrangler types` writes `worker-configuration.d.ts` (the `Env`
  bindings plus runtime types for the compatibility date). Commit it, add it
  to the Worker tsconfig's `types`, and run `wrangler types --check` in
  verify so a binding change without regenerated types fails.
- **Dev**: `@cloudflare/vite-plugin` runs the Worker in workerd under Vite,
  so dev and `vite preview` match production.
- **A single-page app** sets `assets.not_found_handling` to
  `"single-page-application"`.

**Deploy safety.** `wrangler deploy` on Workers always publishes to
production, so production deploys only from CI on `main`:

- CI's `deploy` job runs on a GitHub-hosted runner, after `verify`, from the
  `dist/` that passed. Its token is a secret of a GitHub environment named
  `production` whose deployment branches are `main` only, never a
  repository secret: a workflow edited on any other branch can't read it.
  Scope the token to Workers Scripts edit on one account. Environments in
  private repos need GitHub Pro or Team.
- Sessions never deploy. The web template's `guard-deploy.ts` hook refuses
  every spelling of `wrangler deploy`, `versions deploy`, `rollback`,
  `delete` and `secret put` unless it names a non-production `--env`.
- **Previews:** `wrangler preview` (Wrangler 4.135+) gives a branch its own
  Preview with its own variables, secrets and bindings, configured in a
  `previews` block. Previews don't inherit production settings: a Preview has
  only the bindings its `previews` block names. Point those at separate D1,
  KV or R2 resources; a Preview bound to production's database writes to it.
  `wrangler versions upload
  --preview-alias <branch>` is fine for a static-only Worker, but a version
  carries production's bindings. Both kinds of URL are public; put Cloudflare
  Access in front of them.

Cloudflare's new `cf` CLI (beta since 2026-09-28) will eventually replace
wrangler; revisit at GA.

**Cost and abuse.** Static-asset requests are free and unlimited, so the
template as shipped has nothing to attack. A Worker has no spend cap (budget
alerts arrive the next day), so the API recipe in the web baseline sets a
CPU limit, a rate-limit binding, a request body limit and `workers_dev:
false`, and authenticates before any paid binding is touched.

### Pricing (Workers Paid is $5/month minimum)

| Product | Free | Paid includes |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU each | 10M requests, 30M CPU-ms |
| Static assets | Unlimited | Unlimited |
| KV | 100k reads, 1k writes/day, 1 GB | 10M reads, 1M writes |
| D1 | 5M rows read, 100k written/day, 500 MB/DB | 25B reads, 50M writes, 5 GB |
| R2 | 10 GB-month, zero egress | $0.015/GB-month |
| Durable Objects (SQLite) | 100k requests/day, 5 GB | 1M requests, then $0.15/M |
| Queues | 10k ops/day | 1M ops |

Source: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

### When to look elsewhere

| Host | Why you would | Why not by default |
|---|---|---|
| Vercel | The project must be Next.js with every feature | Hobby tier is non-commercial; Pro is $20/seat |
| Netlify | An existing Netlify site | Credit-based plan charges per production deploy |
| AWS (Lambda, Amplify) | Needs AWS-only services or an existing account | Heaviest setup: IAM, regions, many bills |
| Azure Static Web Apps | Organizational requirement | Free tier stops serving at quota |

## Data

Pick by what the app needs, not by habit. Ask the
[kickoff questions](kickoff.md) first.

| Need | Default | Escalate to |
|---|---|---|
| No backend (local-only) | IndexedDB through TanStack DB local collections, or Dexie | — |
| Simple CRUD | Worker + **D1 + Drizzle** (typed schema, SQLite, no lock-in) | Kysely if you prefer a query builder over an ORM |
| Realtime per document or room | Durable Objects with SQLite storage (+ Drizzle) | — |
| Offline-first with sync | TanStack DB (IndexedDB persistence + offline transaction outbox) against a D1-backed Worker API | PowerSync + Postgres (Neon) once data is shared between users |
| Realtime app, vendor accepted | **Convex**: end-to-end types, reactive queries, strong agent tooling | — |

Notes:

- **Convex** is the most agent-friendly backend: the schema generates types
  end to end, and `npx convex ai-files install` maintains AI guidelines and
  sections in the agent file. Costs: its own API and runtime (medium-high
  lock-in, self-host is FSL then Apache), no offline writes yet, Pro is
  $25/developer. Choose it deliberately in an ADR.
- **Supabase** free projects pause after a week idle. **InstantDB**'s cloud
  is closed to new sign-ups and shuts down 2027-08-31: do not adopt.
  **Zero** has no offline writes by design.
- Whatever the store, the schema is the source of types; never hand-write a
  type that mirrors a table.

## CI: GitHub Actions

Standard runners are free on public repos (4 vCPU); private repos get 2,000
to 3,000 minutes a month, depending on the plan. A private repo that pays
for minutes should move to [Blacksmith](../explorations/blacksmith.md):
every job reads its runner label from the `CI_RUNNER` repository variable
and defaults to GitHub-hosted Ubuntu, so the move needs no commit. The
[workflow templates](../web/template/.github/workflows/ci.yml) follow these
rules:

- `permissions: contents: read` at the top, widened per job only where
  needed; `actions/checkout` with `persist-credentials: false`; never
  `pull_request_target`.
- Actions pinned by full commit SHA with the version in a comment.
  Dependabot updates the SHA and the comment together.
- `concurrency` cancels superseded runs on branches but lets `main` finish.
- One aggregate job (`ci`) is the required status check, so renaming or
  splitting jobs never breaks branch protection.
- CI runs the same verify command as local, on a clean checkout.
- Draft PRs skip the work jobs; `ready_for_review` starts the first real
  run. Setup is cached (`rust-cache` and sccache, written only by `main`;
  Playwright's browsers by version), never results. For selecting what runs, see
  [CI and local check speed](ci-speed.md).
- One job holds a secret: the web template's `deploy`, with the Cloudflare
  token. It runs on `main` only, on a GitHub-hosted runner, and installs
  with `--ignore-scripts`, so no install script runs beside the token.
- Every run's summary lists its ten slowest steps; the Rust template adds
  its slowest tests and a `cargo --timings` report as an artifact, the
  Python template its slowest tests from pytest's JUnit report, and
  Playwright's HTML report ranks tests by duration. For trends, use GitHub's
  Actions performance metrics (organization Insights) or Blacksmith's
  dashboard.
- On public repos, turn on secret-scanning push protection and CodeQL
  default setup in the repo settings (both free, both off per repo by default).

**Dependency updates: Dependabot, for now.** Each template ships a
`.github/dependabot.yml`: weekly, minor and patch updates grouped into one
PR, Actions in another, and a three-day wait before taking a new release.
It is built in and free on private repos, but has two known gaps:

- pnpm is documented only up to v10, and the web template uses pnpm 12.
  Watch its first PRs; if it can't update the lockfile, that settles the
  question.
- It doesn't read `mise.toml`, so Node and the Rust tools pinned there are
  bumped by hand, as are uv and just in the Python template, and its
  `.python-version`.

Renovate covers both and is free for public and private repos through Mend's
Community Cloud, or self-hosted. It is parked as an exploration, with a
ready config: [explorations/renovate](../explorations/renovate/README.md).

## Git identity

Commit with your GitHub noreply address, never a personal email: every
commit's author and committer emails are public once pushed to a public
repo, and stay in its history.

- The address is `<id>+<username>@users.noreply.github.com`, shown under
  GitHub → Settings → Emails once "Keep my email addresses private" is on.
- Also turn on "Block command line pushes that expose my email" there. A push
  that would publish the private address is then refused instead of
  shipping.
- Set it globally (`git config --global user.email …`) or, at the least, in
  each new repo before its first commit (`git config user.email …`).
- If unpushed commits already carry a personal address, rewrite them before
  the first push:
  `git rebase <base> --exec 'git commit --amend --no-edit --author="Name <noreply address>"'`
  (with the repo's `user.email` already set, so the committer is rewritten
  too).

## Toolchains

- **mise** pins Node (and anything else that is not Rust) in `mise.toml`.
  Volta is unmaintained and Corepack no longer ships with Node 25+.
- **pnpm** is pinned by `packageManager` in `package.json`.
- **Rust** is pinned by `rust-toolchain.toml`, which rustup and CI read
  directly. A global `rust = "stable"` in mise exports `RUSTUP_TOOLCHAIN`,
  which overrides that file in every repo; the Rust template's `mise.toml`
  makes mise read the file instead.
- **Python** is pinned by `.python-version`, which uv reads and installs
  from its own builds; the Python template's `mise.toml` pins only uv and
  just. Leave Python out of mise there, so uv's copy is the only one.
- **pnpm refuses packages published less than a day ago.** The web
  template sets `minimumReleaseAge` explicitly, which also makes it strict:
  pnpm fails rather than fall back to a younger release. A template that
  names a same-day version fails to install; lower the range rather than
  adding an exclusion.

## Claude Code setup

Encode process in the cheapest mechanism that enforces it:

| Goal | Mechanism |
|---|---|
| Facts an agent needs every session | `CLAUDE.md` (under 200 lines), `AGENTS.md` symlinked to it |
| Conventions for one area of the tree | `.claude/rules/<topic>.md` with `paths:` frontmatter, loaded only when matching files are touched |
| Format and autofix after every edit | `PostToolUse` hook on `Edit\|Write` |
| Verify before the agent says it is done | `Stop` hook running the fast checks (exit 2 sends the failure back) |
| Never do X (deploy prod, `--no-verify`, force push) | `permissions.deny` plus a `PreToolUse` hook for patterns deny can't express |
| A repeatable procedure (file an issue, cut a release) | A skill in `.claude/skills/<name>/SKILL.md`, `disable-model-invocation: true` if it should only run on request |

Hooks are guarantees; text in the agent file is a request. The stack
templates ship a `.claude/settings.json` wired this way:
[web](../web/template/.claude/settings.json),
[rust](../rust/template/.claude/settings.json),
[python](../python/template/.claude/settings.json).

Git hooks are optional. Claude Code hooks catch problems earlier inside the
agent loop; CI is the gate for everything else. Add a thin lefthook
pre-commit (format and lint staged files, under five seconds) only once
humans or other agents commit to the repo too.
