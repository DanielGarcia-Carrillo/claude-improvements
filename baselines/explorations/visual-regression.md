# Visual regression (exploration)

Status: **PR screenshots for now; a dedicated in-house tool is planned.**
Checked on 2026-10-20.

## The plan

A dedicated visual regression tool built for agent workflows is in
development, and it is meant to become the default for pixel diffs in these
baselines: deterministic comparisons, `main` commits as baselines, a compact
per-PR summary. Until it reaches a usable release, the template has no
screenshot assertions: agents attach screenshots of what changed to their
PRs (below). Adopting the tool replaces any screenshot assertions a project
has added, but not the PR screenshots: whatever does the diffing, a PR that
changes the UI shows representative screenshots in its description. Agents
keep attaching them unless the tool's PR summary includes them.

## Until then

- **PR screenshots** (already in the web template): `pnpm screenshots`
  captures every story and screen, and the agent puts the ones that show its
  change, before and after, in the PR description. It shows changes; it
  doesn't fail the build, and it catches only what the agent thinks to look
  at.
- **Playwright `toHaveScreenshot`** for whole screens, and **Vitest
  `toMatchScreenshot`** for stories in browser mode.
- Generate and update baselines only in one pinned environment (CI, or the
  Playwright Docker image for its version). Fonts and anti-aliasing differ
  across machines, so a baseline from a laptop fails in CI.
- Mask anything that changes on its own (dates, live data) and keep reduced
  motion on, as the template's Playwright config does.
- Prefer aria snapshots (`toMatchAriaSnapshot`) for structure: they catch
  structure and content regressions without pixel noise, but not layout or
  styling.

## Hosted alternatives

| Service | Fit | Note |
|---|---|---|
| Chromatic | Storybook-first, review UI | Paid beyond its free snapshots; the Playwright integration reached 1.0 in 2026-09 |
| Argos | Playwright, Storybook and Vitest integrations | Separate allowance from Chromatic; a review UI for Vitest's screenshots |
| Lost Pixel | — | Archived 2026-04; don't adopt |

## Revisit when

The in-house tool has a release that covers Playwright captures and stories;
then make it the pixel-diff check in place of any screenshot assertions.
Keep attaching PR screenshots unless the tool's PR summary shows them
itself.
