# Renovate (exploration)

Status: **not the default.** The templates ship Dependabot for now
(`.github/dependabot.yml`), despite the gaps below. This folder keeps what
we know about Renovate, and a ready config, for when the choice is revisited.
Facts checked on 2026-10-20.

## Why it was considered

Renovate covers what Dependabot doesn't for these stacks:

| | Dependabot | Renovate |
|---|---|---|
| pnpm | Documented for v7–v10; the templates use pnpm 12 | Current pnpm |
| `mise.toml` (Node, just, nextest, cargo-deny …) | Not read: bump by hand | Has a `mise` manager |
| `rust-toolchain.toml` | Yes (`rust-toolchain` ecosystem) | Yes |
| SHA-pinned Actions | Updates the SHA and the version comment | Same, plus pins new ones (`config:best-practices`) |
| Grouping | `groups`, `multi-ecosystem-groups` | `packageRules` with `groupName` |
| Waiting before new releases | `cooldown`, 3 days by default | `minimumReleaseAge` |
| Hosting | Built into GitHub | A GitHub app (Mend) or self-hosted |

## Hosting and cost

From [Renovate's hosting docs](https://docs.renovatebot.com/mend-hosted/overview/):

- **Mend Renovate Community Cloud** (free): unlimited public *and* private
  repos; one job at a time per account, each repo every four hours, 1 vCPU
  and 3 GB per job, 30-minute timeout; no Merge Confidence data, no support.
- **Community (OSS) Cloud** (free, on application, for open-source
  maintainers): two jobs at a time, more memory, Merge Confidence.
- **Enterprise Cloud** (paid, priced through sales): hourly runs, 16 jobs,
  support. This is the only opaque price, and a solo setup doesn't need it.
- **Self-hosted**: Renovate is open source (AGPL-3.0).
  `renovatebot/github-action` on a weekly cron runs it in your own Actions:
  no Mend account, a few Actions minutes a week on a private repo, plus a
  token or GitHub App to create and rotate.

## What would make it the default

- Dependabot fails on a pnpm 12 lockfile (it is only documented to v10), or
  its pnpm PRs regularly need fixing by hand.
- Hand-bumping `mise.toml` tools gets missed often enough to matter.
- A decision on private repos: Community Cloud (a third party with read and
  write access to private code) or self-hosted (a token to manage).

## Trying it on a repo

1. Install the Renovate GitHub app on that repo only, or add the self-hosted
   Action.
2. Copy [`renovate.json`](renovate.json) to the repo root.
3. Delete `.github/dependabot.yml`, or both bots will open PRs for the same
   updates. (Keep Dependabot *security* alerts on in the repo settings; they
   are separate from version updates.)
4. Merge Renovate's "Configure Renovate" PR, which lists what it detected.

`renovate.json` here runs weekly before 6am Monday, groups minor and patch
updates into one PR with separate ones for Actions and for `mise.toml`, and
waits three days before taking a new npm release.
