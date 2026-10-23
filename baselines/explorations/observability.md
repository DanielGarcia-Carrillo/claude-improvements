# Observability (exploration)

Status: **nothing in the templates, on purpose.** The web template is
static assets with no Worker to observe, and a browser SDK costs bundle size
and a privacy decision before there are users. Checked on 2026-10-21; sizes
are gzipped, measured with esbuild and a typical init, so allow about ±10%
under Rolldown.

## When to add what

| Stage | Web | Rust CLI |
|---|---|---|
| Before launch | With an API Worker: Workers Logs and Issues (`"observability": { "enabled": true, "issues": { "enabled": true } }` and `"upload_source_maps": true` in `wrangler.jsonc`). Free, no bundle cost | `tracing` to stderr with `RUST_LOG` (already in the template) |
| At launch | Sentry for browser errors only, loaded lazily and tunnelled through your own Worker; Cloudflare Web Analytics for traffic and Web Vitals | `human-panic` once binaries are released: a local crash report, nothing sent |
| On a specific question | PostHog (cookieless) for funnels, retention or replay; `web-vitals` beaconed to Workers Analytics Engine for per-route vitals that ad blockers can't drop; OpenTelemetry export to Axiom or Honeycomb for longer Worker retention. Each is an ADR, with a privacy review | Opt-in telemetry only, recorded in an ADR, off by default |

## The options

| Tool | Covers | Free tier | Browser cost | Notes |
|---|---|---|---|---|
| **Sentry** 11.8 | Errors, tracing, replay, logs | 1 user, 5k errors, 50 replays, 5M spans a month | Errors only 30 KB; with tracing 53 KB; with replay 87 KB | `tunnel` option gets past ad blockers. The Vite plugin uploads source maps and deletes them. `@sentry/cloudflare` for Workers |
| **PostHog** | Analytics, replay, errors, feature flags | 1M events, 5k recordings, 100k exceptions a month (from its FAQ) | 108 KB default; 52 KB slim | `cookieless_mode: "always"` stores nothing in the browser, and PostHog says it then needs no consent banner (with its "Cookieless server hash mode" on); EU host; documented Cloudflare Worker proxy |
| **Workers Logs, Traces, Issues** | Worker logs, traces, grouped errors | 200k log events a day. Changes on 2026-12-01 to 0.5 GB a day, kept 7 days | None | Traces are early beta; Issues is open beta and groups errors logged with `console.error()` |
| **Cloudflare Web Analytics** | Traffic, LCP, INP, CLS | Free | 10.3 KB, third-party beacon | Cookieless; SPA soft navigations since 2026-08; some ad blockers drop it |
| **Grafana Faro** | Errors, vitals, sessions, traces | 50k sessions a month, 14-day retention | 40 KB; 89 KB with tracing | Self-hostable through Alloy |
| **Honeycomb** | Traces, events | 20M events a month | 68 KB | Symbolication needs your own collector |
| **Axiom** | Log and trace sink | 500 GB a month, 30-day retention | No browser SDK | Back end only |
| **OpenTelemetry (browser)** | Traces | Needs a back end | 24 KB | JS SDK 3.0 shipped on 2026-10-20 and deprecates `sdk-trace-web`; wait for it to settle |
| **`web-vitals`** 6.2 | Web Vitals | Free | 3.3 KB | Send with `sendBeacon` to your own Worker |
| Highlight | — | — | — | Hosted Highlight ended 2026-02-28 (now LaunchDarkly). Skip |

## Adding Sentry at launch

- `pnpm add @sentry/react` and `pnpm add -D @sentry/vite-plugin`.
- `src/lib/monitoring.ts` calls `import('@sentry/react')` from
  `requestIdleCallback` after first render (`setTimeout` where it is
  missing: Safari has it only behind a flag), with `dsn`, `tunnel: '/api/e'`,
  `release`, `sendDefaultPii: false` and `tracesSampleRate: 0`. No replay or
  tracing integrations. A small early `error` listener queues errors that
  happen before the SDK loads.
- A Hono route `/api/e` forwards envelopes to Sentry's host, allowing only
  your project's ID. Each forwarded error is a Worker request.
- Sentry doesn't document service-worker support, so the service worker
  doesn't load it; its `error` and `unhandledrejection` listeners post to a
  client or to `/api/e`.
- Source maps: `build.sourcemap: 'hidden'` only when `SENTRY_AUTH_TOKEN` is
  set, and the plugin's `filesToDeleteAfterUpload: ['dist/**/*.map']`. The
  token reaches CI's build step on `main` only. Before `wrangler deploy`, fail
  if any `.map` is left in `dist/`: static assets would serve it publicly.
- With the tunnel, the CSP's `connect-src 'self'` needs no change. Web
  Analytics needs `script-src https://static.cloudflareinsights.com` and
  `connect-src https://cloudflareinsights.com`.

## Rust CLIs

No telemetry by default. The norm is opt-in, and Go made its toolchain
telemetry opt-in, local-only by default, after its opt-out proposal was
rejected. `human-panic` writes a crash report to a temporary file and tells
the user where; nothing leaves the machine. `sentry` (0.49) only for a
long-running service, or behind an explicit opt-in with a first-run notice.

## Not verified

- Sentry, PostHog or Faro running inside a service worker.
- Whether Web Analytics' automatic injection works on Workers static assets
  (use the manual snippet).
- Whether Sentry without replay writes anything to browser storage.
