/**
 * Stop: before Claude reports back, typecheck and lint the project if the
 * working tree has changes. A failure blocks the stop (exit 2) and its output
 * goes back to Claude. Tests stay in `pnpm verify`; this is the fast part.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

readFileSync(0) // The event payload; nothing in it changes what we check.
const root = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })

if (run('git', ['status', '--porcelain']).stdout.trim() === '') process.exit(0)

for (const script of ['typecheck', 'lint']) {
  const result = run('pnpm', ['-s', script])
  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim().split('\n').slice(-80).join('\n')
    process.stderr.write(`\`pnpm ${script}\` failed. Fix these before finishing:\n${output}\n`)
    process.exit(2)
  }
}
