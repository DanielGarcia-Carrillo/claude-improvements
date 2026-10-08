# claude-improvements

This project exists to improve the UX of the Claude desktop app (the Code
tab), mainly through Claude Code mods: plugins, hooks, skills, status lines,
panes and similar customisations, plus any settings or tooling that support
them.

## Repository

- Remote: `origin` is the public GitHub repo
  [DanielGarcia-Carrillo/claude-improvements](https://github.com/DanielGarcia-Carrillo/claude-improvements).
  It is public, so never commit secrets, tokens or personal data.
- Default branch: `main`. Work goes on a branch and lands through a PR.
- Push or open a PR only when Daniel asks. Never push to `main` directly.
- Mods live under `mods/<name>/`. Before opening a PR, run
  `claude plugin validate mods/<name>` and `claude plugin test mods/<name>`.
