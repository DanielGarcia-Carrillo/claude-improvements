---
name: pr-titles
description: Use when choosing a title for a new or draft pull request, or when reviewing or rewriting an existing PR title.
---

Write a concise, imperative title that tells someone scanning the PR list why this change is worth making. Ground it in what this PR delivers. Use the linked issue and PR description to check the motivation and the diff to check the scope.

- For a behavior change, make the direction clear. Could someone mistake the title for a report of the current bug?
- For maintenance work, name the problem and the operation it affects. Include an implementation detail when it makes the title more precise.
- For a refactor or stacked PR, name this slice’s contribution. If the payoff comes after a later change, make that timing clear.
- Follow the repository’s issue-key and visibility conventions.

### Behavior change

- Bad — Map tab always present
- Good — Show the Map tab for festivals that have a map
- Best — Show the Map tab by default at festivals that have a map

“Always present” could describe a bug. “Show” gives the direction. “By default” captures what changed for someone who previously had to enable the tab.

### Infrastructure

- Bad — Add a Chromium cache and timeout
- Good — Limit how long CI waits for Chromium on slow Ubuntu mirrors
- Best — Limit how long CI waits for Chromium installation on slow Ubuntu mirrors

“Installation” earns its place. Without it, a reader could reasonably think the browser stalled during a test.

### Preparatory refactor

- Bad — Refactor baseline lookup
- Good — Prepare to reuse each suite’s existing baseline when its key changes
- Best — Refactor baseline lookup so each suite can reuse its baseline after the key switch

The last title identifies the work a reviewer will see and explains why it matters. “After the key switch” puts the benefit in the later PR where it becomes available.
