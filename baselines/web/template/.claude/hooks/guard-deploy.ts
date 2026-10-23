/**
 * PreToolUse on Bash: refuses any command that would change what the
 * production Worker serves, or its secrets. CI deploys `main`
 * (.github/workflows/ci.yml); a session never does.
 *
 * permissions.deny can't express this on its own: a Bash rule matches a
 * prefix, so `pnpm dlx wrangler deploy`, `./node_modules/.bin/wrangler deploy`
 * or `wrangler --config x deploy` would slip past it. This matches `wrangler`
 * anywhere on a line, with any global options, followed by a subcommand that
 * changes production. Each such call is checked on its own, up to the next
 * `;`, `&` or `|`, so a `--dry-run` or `--env` on one doesn't excuse another
 * on the same line. A line that only quotes such a command is blocked too: a
 * false block costs a rephrase, a missed one a production deploy.
 *
 * Allowed: `--dry-run` (not `--dry-run=false`), `--env <name>` for a
 * non-production environment named on the line (not `$VAR`, which only the
 * shell resolves), and the preview commands (`wrangler preview`,
 * `wrangler versions upload`).
 * Exit 2 blocks the call and sends stderr back to Claude.
 */
import { readFileSync } from 'node:fs'

/** `wrangler` however it is invoked (npx, pnpm dlx, a path, `@4`), then its global options. */
const WRANGLER = String.raw`\bwrangler(?:@\S+)?(?:\.\w+)?(?:\s+-{1,2}[\w-]+(?:=\S+|\s+(?!-)\S+)?)*\s+`
const CHANGES_PRODUCTION = new RegExp(
  `${WRANGLER}(deploy|publish|versions\\s+deploy|triggers\\s+deploy|rollback|delete|secret\\s+(?:put|delete|bulk))\\b([^;&|]*)`,
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
 * `--dry-run=false`, `--dry-run false` and a later `--no-dry-run` as off, so
 * only the last such flag counts and only an unqualified or `true` one is on.
 */
function isDryRun(args: string): boolean {
  const flags = [...args.matchAll(/(?:^|\s)(--no-dry-run|--dry-run(?:=(\S*)|\s+(true|false)(?=\s|$))?)(?=\s|$)/g)]
  const last = flags.at(-1)
  if (last === undefined || last[1] === '--no-dry-run') return false
  return (last[2] ?? last[3] ?? 'true') === 'true'
}

/** Every value given to `--env`/`-e` in `args`. */
function environments(args: string): string[] {
  return [...args.matchAll(/(?:^|\s)(?:--env|-e)(?:=|\s+)(["']?)([^\s"']+)\1/g)].flatMap((match) => match[2] ?? [])
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

for (const line of bashCommand(JSON.parse(readFileSync(0, 'utf8'))).split('\n')) {
  for (const match of line.matchAll(CHANGES_PRODUCTION)) {
    const subcommand = (match[1] ?? '').replace(/\s+/g, ' ')
    const args = match[2] ?? ''
    if (isDryRun(args)) continue
    const envs = environments(args)
    const unresolved = envs.find((env) => /[$`]/.test(env))
    if (unresolved) refuse(`\`--env ${unresolved}\` is only known when the shell runs it; name the environment.`)
    const production = envs.find((env) => PRODUCTION.has(env))
    if (production) refuse(`\`--env ${production}\` is a production environment.`)
    if (envs.length === 0) refuse(`\`wrangler ${subcommand}\` changes the production Worker.`)
  }
}
