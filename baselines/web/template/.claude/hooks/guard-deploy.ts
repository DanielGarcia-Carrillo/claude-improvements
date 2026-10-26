/**
 * PreToolUse on Bash: refuses any command that would change what the
 * production Worker serves, or its secrets. CI deploys `main`
 * (.github/workflows/ci.yml); a session never does.
 *
 * It is the only guard: settings.json has no wrangler deny rules, because a
 * Bash rule matches a prefix. `wrangler deploy *` would refuse a dry run or a
 * staging deploy as well, and still miss `pnpm dlx wrangler deploy`,
 * `"./node_modules/.bin/wrangler" deploy` or `wrangler --config x deploy`.
 * This matches `wrangler` anywhere on a line, quoted or not, with any global
 * options, followed by a subcommand that changes production. Each such call
 * is checked on its own, up to the next `;`, `&` or `|` (or a `#` comment),
 * so a `--dry-run` or `--env` on one doesn't excuse another on the same line.
 * A line that only quotes such a command is blocked too: a false block costs
 * a rephrase, a missed one a production deploy.
 *
 * Allowed: `--dry-run` (not `--dry-run=false`), `--env <name>` on either side
 * of the subcommand for a non-production environment spelled out on the line
 * (not `$VAR` or anything else only the shell resolves), and the preview
 * commands (`wrangler preview`, `wrangler versions upload`).
 *
 * It reads the line as text, not as Bash would, so it stops an agent's
 * mistake, not someone set on deploying: a variable holding `deploy`, `eval`,
 * a script or a direct API call gets past it.
 * Exit 2 blocks the call and sends stderr back to Claude.
 */
import { readFileSync } from 'node:fs'

/** A quote Bash drops, so `"wrangler" 'deploy'` is still a deploy. */
const Q = `["']?`
/** `wrangler` however it is invoked (npx, pnpm dlx, a quoted path, `@4`), then its global options. */
const WRANGLER = String.raw`\bwrangler(?:@\S+)?(?:\.\w+)?${Q}((?:\s+-{1,2}[\w-]+(?:=\S+|\s+(?!-)\S+)?)*)\s+`
const CHANGES_PRODUCTION = new RegExp(
  `${WRANGLER}${Q}(deploy|publish|versions${Q}\\s+${Q}deploy|triggers${Q}\\s+${Q}deploy|rollback|delete|secret${Q}\\s+${Q}(?:put|delete|bulk))\\b${Q}([^;&|]*)`,
  'g',
)
/** Names a production environment is plausibly given. */
const PRODUCTION = new Set(['main', 'master', 'production', 'prod', 'release'])

/** The Bash command from the hook payload. */
function bashCommand(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('tool_input' in payload)) return ''
  const input = payload.tool_input
  if (typeof input !== 'object' || input === null || !('command' in input)) return ''
  return typeof input.command === 'string' ? input.command : ''
}

/**
 * Whether the call is a dry run. Wrangler parses flags with yargs, which reads
 * `--dry-run=false`, `--dry-run false` (quoted or not) and a later
 * `--no-dry-run` as off, so only the last such flag counts and only an
 * unqualified or `true` one is on.
 */
function isDryRun(args: string): boolean {
  const flags = [
    ...args.matchAll(/(?:^|\s)(--no-dry-run|--dry-run(?:=(\S*)|\s+(["']?)(true|false)\3(?=\s|$))?)(?=\s|$)/g),
  ]
  const last = flags.at(-1)
  if (last === undefined || last[1] === '--no-dry-run') return false
  return (last[2] ?? last[4] ?? 'true') === 'true'
}

/** Every value given to `--env`/`-e` in `args`, as written. */
function environments(args: string): string[] {
  return [...args.matchAll(/(?:^|\s)(?:--env|-e)(?:=|\s+)(?!-)([^\s)]+)/g)].flatMap((match) => match[1] ?? [])
}

function refuse(why: string): never {
  process.stderr.write(
    `Blocked: ${why}\n` +
      'Production deploys come from CI on main, never from a session. Instead:\n' +
      '  wrangler preview                     a branch preview with its own bindings\n' +
      '  wrangler versions upload --preview-alias <branch>   a version that serves no traffic\n' +
      '  --env <name>  a non-production environment;  --dry-run  check the build only\n',
  )
  process.exit(2)
}

// Bash joins a line ending in a backslash to the next, so `wrangler \` then
// `deploy` is one call.
const command = bashCommand(JSON.parse(readFileSync(0, 'utf8'))).replaceAll(/\\\r?\n/g, '')
for (const line of command.split('\n')) {
  for (const match of line.matchAll(CHANGES_PRODUCTION)) {
    const subcommand = (match[2] ?? '').replaceAll(/["'\s]+/g, ' ')
    // yargs reads options on either side of the subcommand, and Bash ignores
    // the rest of the line from a word that starts with `#`.
    const args = `${match[1] ?? ''} ${match[3] ?? ''}`.replace(/(?:^|\s)#.*/, '')
    if (isDryRun(args)) continue
    const envs = environments(args)
    for (const env of envs) {
      // Bash drops quotes, so `p"rod"uction` is `production`. Anything else it
      // would expand or unescape isn't a plain name.
      const name = env.replaceAll(/["']/g, '')
      if (!/^[\w-]+$/.test(name)) refuse(`\`--env ${env}\` is only known when the shell runs it; name the environment.`)
      if (PRODUCTION.has(name)) refuse(`\`--env ${name}\` is a production environment.`)
    }
    if (envs.length === 0) refuse(`\`wrangler ${subcommand}\` changes the production Worker.`)
  }
}
