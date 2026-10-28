# Explorations

Options under evaluation that are not defaults yet. Each entry says what we
use instead today and what would make us switch. Alternatives that only
need a line live in the stack READMEs' "Instead, when" columns
([web](../web/README.md#the-stack), [Rust](../rust/README.md#add-when-needed),
[infra](../general/infra.md)).

| Exploration | Instead, today | Switch when |
|---|---|---|
| [Renovate](renovate/README.md) | Dependabot | Dependabot can't handle pnpm 12 lockfiles, or hand-bumping `mise.toml` keeps getting missed |
| [UI primitives](ui-primitives.md) | Native elements | A project needs a widget the platform lacks (menu, combobox, date picker); Astryx re-evaluated and not adopted |
| [Visual regression](visual-regression.md) | PR screenshots | The in-house visual regression tool has a usable release |
| [Blacksmith](blacksmith.md) | GitHub-hosted runners | A private repo pays for Actions minutes: pilot one repo in an organisation on Team, then set `CI_RUNNER` for the rest |
| [Observability](observability.md) | Nothing in the browser; Workers Logs and Issues once there is an API Worker | Launch: Sentry for browser errors (lazy, tunnelled) and Cloudflare Web Analytics |
| [tsrs](tsrs.md) | TypeScript 7's `tsc` | It has a stable release against TypeScript 7.1 and a project's typecheck gets slow |

## Smaller ones

| Option | Status | Switch when |
|---|---|---|
| React Compiler in Rust (`react({ compiler: true })` with `oxc-transform-react`) | Experimental in `@vitejs/plugin-react` 6; the template uses the Babel preset | It is marked stable; it removes Babel from the build |
| moon for a mixed Rust and JS repo | Untried; v2's toolchain plugins are new. See [CI and local check speed](../general/ci-speed.md#by-shape) | A new repo with real dependencies between its Rust and JS parts, or a repo past roughly 15–20 projects |
| A pass cache (skip a job whose inputs already passed) | Paused over trust questions; see [CI and local check speed](../general/ci-speed.md#a-pass-cache-last-if-ever) | Selected checks are still slow and the five questions there have answers |
| oxc-node | Experimental; Node 26 strips types natively, which the template's scripts and hooks use | A script needs JSX, tsconfig `paths` or enums, which native stripping rejects |
| `jotai-tanstack-query` | Unverified with Jotai 3; use TanStack Query hooks directly | It declares Jotai 3 support and a project wants queries as atoms |
