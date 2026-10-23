/**
 * Shows the screenshots a PR changes in its description, as before/after
 * pairs. CI runs it after `pnpm verify` has captured every story and screen
 * (SCREENSHOT_DIR; see .storybook/vitest.setup.ts and tests/e2e/screens.spec.ts).
 *
 * Images live on an orphan `screenshots` branch of this repo, so they keep the
 * repo's access rules: `main/` holds main's latest captures and
 * `pr/<number>/<sha>/` the ones a PR changed. Links name the branch's commit,
 * so an old description keeps showing what it showed.
 *
 *   node scripts/pr-screenshots.ts --captures screenshots          on main: refresh main/
 *   node scripts/pr-screenshots.ts --captures screenshots --pr 12 --sha <head sha>
 *
 * Needs git, and gh for --pr. It imports nothing outside Node, so no package
 * code runs with the write token CI gives it.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const BRANCH = 'screenshots'
const MAX_ROWS = 20
const START = '<!-- screenshots:start -->'
const END = '<!-- screenshots:end -->'
const BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
]

const { values } = parseArgs({
  options: { captures: { type: 'string' }, pr: { type: 'string' }, sha: { type: 'string' } },
})
const captures = resolve(values.captures ?? 'screenshots')
const pr = values.pr
const sha = (values.sha ?? process.env['GITHUB_SHA'] ?? 'local').slice(0, 7)
const repo = process.env['GITHUB_REPOSITORY'] ?? ''
const server = process.env['GITHUB_SERVER_URL'] ?? 'https://github.com'
// SCREENSHOTS_REMOTE points at another repository, for trying this out locally.
const remote = process.env['SCREENSHOTS_REMOTE'] ?? `${server}/${repo}.git`
const token = process.env['GH_TOKEN']
const auth = token
  ? ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`]
  : []

function fail(message: string): never {
  process.stderr.write(`pr-screenshots: ${message}\n`)
  process.exit(1)
}

function git(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('git', [...auth, ...BOT, ...args], { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() }
}

function mustGit(cwd: string, ...args: string[]): string {
  const result = git(cwd, ...args)
  if (!result.ok) fail(`git ${args.join(' ')} failed:\n${result.out}`)
  return result.out
}

/** Every PNG under `dir`, as paths relative to it, sorted. */
function pngs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.png'))
    .toSorted()
}

/** Checks out the branch's latest commit, or starts it if it doesn't exist yet. */
function checkoutLatest(store: string): void {
  if (git(store, 'fetch', '-q', '--depth', '1', 'origin', BRANCH).ok) {
    mustGit(store, 'checkout', '-q', '--force', '-B', BRANCH, 'FETCH_HEAD')
    mustGit(store, 'clean', '-q', '-fdx')
  } else if (!git(store, 'rev-parse', '-q', '--verify', 'HEAD').ok) {
    mustGit(store, 'switch', '-q', '--orphan', BRANCH)
  } else {
    fail(`can't fetch the ${BRANCH} branch from ${remote}`)
  }
}

interface Change {
  capture: string
  before: string | undefined
  after: string
}

/** Copies this run's captures into the store and returns what changed against main. */
function stage(store: string): { changes: Change[]; removed: string[]; mainExists: boolean } {
  const current = pngs(captures)
  const main = join(store, 'main')
  const mainExists = existsSync(main)
  if (pr === undefined) {
    rmSync(main, { recursive: true, force: true })
    cpSync(captures, main, { recursive: true })
    return { changes: [], removed: [], mainExists }
  }
  const changes: Change[] = []
  for (const capture of current) {
    const before = join('main', capture)
    const beforeExists = existsSync(join(store, before))
    if (beforeExists && readFileSync(join(store, before)).equals(readFileSync(join(captures, capture)))) continue
    const after = join('pr', pr, sha, capture)
    mkdirSync(dirname(join(store, after)), { recursive: true })
    cpSync(join(captures, capture), join(store, after))
    changes.push({ capture, before: beforeExists ? before : undefined, after })
  }
  const removed = pngs(main).filter((capture) => !current.includes(capture))
  return { changes, removed, mainExists }
}

/** Commits and pushes the captures, retrying when another run pushed first. Returns the commit. */
function publish(store: string): ReturnType<typeof stage> & { commit: string } {
  let lastPush = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    checkoutLatest(store)
    const staged = stage(store)
    mustGit(store, 'add', '-A')
    if (git(store, 'diff', '--cached', '--quiet').ok) {
      const head = git(store, 'rev-parse', 'HEAD')
      return { ...staged, commit: head.ok ? head.out : '' }
    }
    mustGit(store, 'commit', '-q', '-m', pr === undefined ? `main at ${sha}` : `PR #${pr} at ${sha}`)
    const push = git(store, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)
    if (push.ok) return { ...staged, commit: mustGit(store, 'rev-parse', 'HEAD') }
    lastPush = push.out
  }
  return fail(`couldn't push to the ${BRANCH} branch after three attempts:\n${lastPush}`)
}

function section({ changes, removed, mainExists, commit }: ReturnType<typeof publish>): string {
  const image = (path: string, alt: string) =>
    `<img src="${server}/${repo}/blob/${commit}/${path}?raw=true" alt="${alt}" width="360">`
  const lines = ['## Screenshots', '']
  if (changes.length === 0) {
    lines.push(
      removed.length > 0
        ? `No remaining capture differs from \`main\` at \`${sha}\`.`
        : `No visual changes against \`main\` at \`${sha}\`.`,
    )
  } else {
    lines.push(
      `${changes.length} ${changes.length === 1 ? 'capture differs' : 'captures differ'} from \`main\` at \`${sha}\` ` +
        '(Storybook stories and Playwright screens, captured by CI).',
    )
    if (!mainExists) lines.push('', 'There are no captures of `main` yet, so everything shows as new.')
    lines.push('', '| Capture | Before (`main`) | After |', '|---|---|---|')
    for (const { capture, before, after } of changes.slice(0, MAX_ROWS)) {
      lines.push(`| \`${capture}\` | ${before ? image(before, 'before') : 'new'} | ${image(after, 'after')} |`)
    }
    if (changes.length > MAX_ROWS) {
      lines.push('', `And ${changes.length - MAX_ROWS} more in this run's \`screenshots\` artifact.`)
    }
  }
  if (removed.length > 0)
    lines.push('', `No longer captured: ${removed.map((capture) => `\`${capture}\``).join(', ')}.`)
  return lines.join('\n')
}

/** `body` with the screenshots block replaced, or appended if it has none. */
function splice(body: string, content: string): string {
  const block = `${START}\n${content}\n${END}`
  const start = body.indexOf(START)
  const end = body.indexOf(END)
  if (start !== -1 && end > start) return `${body.slice(0, start)}${block}${body.slice(end + END.length)}`
  return `${body.trimEnd()}\n\n${block}\n`
}

function gh(args: string[], input?: string): string {
  const result = spawnSync('gh', args, { encoding: 'utf8', ...(input === undefined ? {} : { input }) })
  if (result.status !== 0) fail(`gh ${args.join(' ')} failed:\n${result.stderr}`)
  return result.stdout
}

if (!existsSync(captures)) fail(`no captures at ${captures}; run with SCREENSHOT_DIR set first`)
if (repo === '' && process.env['SCREENSHOTS_REMOTE'] === undefined) fail('GITHUB_REPOSITORY is not set')

const store = mkdtempSync(join(tmpdir(), 'pr-screenshots-'))
mustGit(store, 'init', '-q')
mustGit(store, 'remote', 'add', 'origin', remote)
const published = publish(store)

if (pr !== undefined) {
  const content = section(published)
  process.stdout.write(`${content}\n`)
  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) appendFileSync(summary, `${content}\n`)
  if (repo !== '') {
    const body = gh(['pr', 'view', pr, '--repo', repo, '--json', 'body', '--jq', '.body'])
    gh(['pr', 'edit', pr, '--repo', repo, '--body-file', '-'], splice(body, content))
  }
}
