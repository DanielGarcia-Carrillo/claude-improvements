# Blacksmith (exploration)

Status: **recommended for private repos that pay for Actions minutes;
public repos stay on GitHub's free runners.** It needs the repos in a GitHub
organization, which in practice means the Team plan (see below). Not yet
piloted. Checked on 2026-10-21 from Blacksmith's and GitHub's docs and
pricing pages; speed figures are the vendor's and unverified.

## What it is

[Blacksmith](https://www.blacksmith.sh) runs GitHub Actions jobs on its own
bare-metal machines, one ephemeral Firecracker microVM per job. Adopting it
is a label change: install its GitHub app, then point `runs-on` at
`blacksmith-{2,4,8,16,32}vcpu-ubuntu-2404` (or `-arm`, Windows, macOS M4).
`actions/cache`, `setup-node`, `rust-cache` and other cache-backed actions
are redirected to a cache next to the runners with no workflow change.

The templates' workflows already take the label from a repository variable,
`runs-on: ${{ vars.CI_RUNNER || 'ubuntu-26.04' }}`. Setting `CI_RUNNER`
moves every job; deleting it moves CI back to GitHub, for example during a
Blacksmith outage, without a commit.

## Cost against GitHub-hosted runners

| | Blacksmith | GitHub-hosted |
|---|---|---|
| Public repos | Billed like private (an OSS discount exists, amount unstated) | **Free**, and standard runners get 4 vCPU / 16 GB |
| Free minutes | 3,000 two-vCPU Linux minutes per org per month | 2,000 (Free org), 3,000 (Pro or Team) per month, private repos only |
| Linux x64, 2 vCPU | $0.004/min | $0.006/min |
| Linux arm64, 2 vCPU | $0.0025/min | $0.005/min |
| macOS, Apple silicon | $0.08/min (M4, 6 vCPU, 24 GB) | $0.102/min (M2 Pro, 5 cores, a larger runner) |

GitHub's standard macOS runner ($0.062/min) is a 3-core M1 or 4-core Intel
machine, so it isn't the like-for-like comparison; GitHub's 12-core Intel
larger runner is $0.077/min. GitHub's included minutes don't cover larger
runners. Blacksmith's free minutes do cover macOS, at 20 Linux minutes per
macOS minute (150 macOS minutes a month).

Both bill by the minute, so a faster job is also a cheaper one.

### Estimating a repo's saving

Check the Actions usage report by SKU first, and compare each SKU with the
Blacksmith machine that matches it. A macOS job on GitHub's M2 Pro runner
costs about a fifth less per minute on Blacksmith's faster M4. A job on
GitHub's standard macOS runner costs about 1.3× more per minute on
Blacksmith for twice the cores, so it breaks even only if it runs at least
1.3× faster.

For Linux 2-vCPU jobs, with *m* minutes a month on GitHub and a speed-up
*s*:

- GitHub: max(0, *m* − 3,000) × $0.006
- Blacksmith: max(0, *m* / *s* − 3,000) × $0.004, plus $4 per user per month for
  Team

Worked example: $60 a month of Linux overage is about 10,000 paid plus
3,000 included minutes. On Blacksmith that is $40 at the same speed, about
$23 if jobs run 1.5× faster and $14 at the vendor's claimed 2×, plus $4 for
Team. Rust compiles and cache restores gain the most from faster machines;
jobs that mostly wait on the network or on fixed setup gain little, so
measure rather than assume 2×.

## Moving private repos into an organization

Creating an organization and transferring repos takes minutes, but four
things change:

1. **Choose Team, not Free** ($4 per user per month). On a Free
   organization, private repos lose protected branches and rulesets,
   required reviewers, code owners and GitHub Pages, and can't read
   organization-level variables or secrets. The templates rely on a
   required `ci` status check, which needs branch protection or a ruleset.
2. **Reinstall GitHub apps on the organization.** An app installed on the
   personal account doesn't cover the organization's repos: Graphite,
   Linear, Cloudflare, Claude and the like each need installing there.
   Fine-grained tokens are scoped to one owner, so make new ones for the
   organization.
3. **Update remotes.** Web links and `git` URLs redirect, but run
   `git remote set-url origin <new URL>` in each clone (worktrees share one
   config, so once per repo). Never create a repo with the old name under
   the personal account: that deletes the redirects.
4. **Check settings after the transfer.** Issues, pull requests, the wiki,
   secrets, webhooks and deploy keys move with the repo. GitHub's docs don't
   say whether variables, environments and rulesets do, so check them.

## Pilot

1. Create the organization on Team and transfer the private repo with the
   most CI minutes.
2. Install Blacksmith's app on **selected repositories** only, starting with
   that one.
3. Set the repo variable `CI_RUNNER` to `blacksmith-2vcpu-ubuntu-2404`.
4. After a week, compare minutes, wall-clock time and cost with the week
   before.
5. If it holds up, move the other private repos, add each to Blacksmith's
   app, and set `CI_RUNNER` once as an organization variable for those same
   selected repositories. A repo with the variable but not the app has no
   runner for its jobs. Public repos in the organization stay on GitHub's
   free runners.

## Risks

- **A third party runs CI with your secrets.** It is SOC 2 Type 2, isolates
  each job in its own VM, and doesn't request access to secrets. Its app
  does ask for read/write on contents, workflows, pull requests, checks and
  actions (for its migration wizard and agent features), so install it on
  selected repos only. It also gets organization-wide read/write on
  self-hosted runners, which is how jobs reach its runners; repo selection
  doesn't limit that.
- **Ubuntu 24.04 only**, while the templates default to 26.04. Toolchains
  come from mise and `rustup`, not the image, so this rarely matters;
  Playwright's `--with-deps` supports 24.04.
- If GitHub brings back its proposed per-minute charge for self-hosted
  runners, it would likely apply here too.

## Same space, briefly

| Service | Price for 2 vCPU Linux | Positioning |
|---|---|---|
| Namespace | $0.002–0.003/min, pay as you go | Cheapest managed option; concurrency caps on the free tier |
| Ubicloud | about $0.0012/min, 1,250 free minutes | Open source |
| Depot | $20/month for 2,000 min, then $0.006/min | Strongest on Docker builds |
| WarpBuild | $0.004/min ($0.002 in your own cloud) | Similar to Blacksmith |
| RunsOn | About $0.0009/min on AWS spot, plus a license | Runs in your own AWS account |

`CI_RUNNER` works the same way for any of these.

## Replacing GitHub Actions entirely

Checked on 2026-10-21; prices normalized to 2-vCPU Linux minutes.

| Platform | Cost for one person | Gap for these projects |
|---|---|---|
| Buildkite | Free tier about 1,000 min; Pro $30 per user plus $0.008/min; self-hosted agents free | Seat fee; macOS on Pro only |
| CircleCI | Free 30k credits (about 3,000 min), then $0.006/min | No cheaper than GitHub; a second config format |
| GitLab CI on a GitHub repo | Premium $29 per user, then about $0.01/min | Mirror project; ignores fork PRs |
| Semaphore | $15 free credit a month, then $0.0075/min; open source since 2025 | Dearer per minute |
| Harness CI | 2,000 credits, about 1,000 min on its smallest 4-vCPU machine | Quote-based pricing |
| Depot CI (GA 2026-03) | $20 a month for 2,000 min, then $0.006/min | Linux only, no fork PRs, its own copy of the workflows |
| Dagger Cloud Checks | $20 a month plus per-CPU-minute | Pre-release |

None beats GitHub Actions plus Blacksmith here: each is dearer per minute,
adds a seat fee or has a blocking gap, and GitHub is the only one where
public repos are free. Revisit **Depot CI** for a private, Linux-only repo
where an agent's loop matters most: it runs CI against uncommitted changes
and has `depot ci logs`, `retry --failed`, `diagnose` and `ssh`. Buildkite's
free tier or Semaphore's open-source edition fit only if CI moves onto your
own machines.
