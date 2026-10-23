/**
 * PostToolUse on Edit|Write: apply safe lint fixes and format the file, then
 * hand whatever lint could not fix, or a file oxfmt can't parse, back to
 * Claude (exit 2) while the edit is still fresh. Type-aware rules run in the
 * Stop hook and in `pnpm lint`.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, relative } from 'node:path'

const FORMATTED = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.jsonc', '.css', '.md', '.yaml', '.yml', '.html'])
const LINTED = new Set(['.ts', '.tsx', '.js', '.mjs'])

/** The edited file's path from the hook payload, if it has one. */
function editedFile(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || !('tool_input' in payload)) return undefined
  const input = payload.tool_input
  if (typeof input !== 'object' || input === null || !('file_path' in input)) return undefined
  return typeof input.file_path === 'string' ? input.file_path : undefined
}

const file = editedFile(JSON.parse(readFileSync(0, 'utf8')))
const root = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
if (!file || relative(root, file).startsWith('..')) process.exit(0)

const run = (args: string[]) => spawnSync('pnpm', ['exec', ...args], { cwd: root, encoding: 'utf8' })
const ext = extname(file)

if (LINTED.has(ext)) run(['oxlint', '--fix', file])
if (FORMATTED.has(ext)) {
  // A file .oxfmtrc.json ignores is an unmatched pattern, not an error.
  const format = run(['oxfmt', '--no-error-on-unmatched-pattern', file])
  if (format.status !== 0) {
    process.stderr.write(`oxfmt: couldn't format ${relative(root, file)}:\n${format.stdout}${format.stderr}`)
    process.exit(2)
  }
}
if (LINTED.has(ext)) {
  const lint = run(['oxlint', file])
  if (lint.status !== 0) {
    process.stderr.write(
      `oxlint: problems in ${relative(root, file)} that --fix could not resolve:\n${lint.stdout}${lint.stderr}`,
    )
    process.exit(2)
  }
}
