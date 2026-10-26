/**
 * Stop: before Claude reports back, typecheck and lint the project if the
 * working tree has changes. A failure blocks the stop (exit 2) and its output
 * goes back to Claude. If it still fails on the stop after that, it reports
 * without blocking again: the cause may be one Claude can't fix (offline, or
 * the user's own work in progress). Tests stay in `pnpm verify`; this is the
 * fast part.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** Whether this stop follows one this hook already blocked. */
function isRetry(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'stop_hook_active' in payload &&
    payload.stop_hook_active === true
  )
}

/**
 * The checkout Claude is working in. The payload's `cwd` follows Claude into a
 * worktree; `CLAUDE_PROJECT_DIR` stays on the main checkout.
 */
function checkout(payload: unknown): string {
  const cwd =
    typeof payload === 'object' && payload !== null && 'cwd' in payload && typeof payload.cwd === 'string'
      ? payload.cwd
      : (process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd())
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  return top.status === 0 ? top.stdout.trim() : cwd
}

/** What a command printed, or why it didn't start. */
function printed(result: SpawnSyncReturns<string>): string {
  return result.error ? result.error.message : `${result.stdout}${result.stderr}`
}

const payload: unknown = JSON.parse(readFileSync(0, 'utf8'))
const retry = isRetry(payload)
const root = checkout(payload)
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })

if (run('git', ['status', '--porcelain']).stdout.trim() === '') process.exit(0)

for (const script of ['typecheck', 'lint']) {
  const result = run('pnpm', ['-s', script])
  if (result.status !== 0) {
    const output = printed(result).trim().split('\n').slice(-80).join('\n')
    if (retry) {
      process.stderr.write(`\`pnpm ${script}\` still fails:\n${output}\n`)
      process.exit(1)
    }
    process.stderr.write(`\`pnpm ${script}\` failed. Fix these before finishing:\n${output}\n`)
    process.exit(2)
  }
}
