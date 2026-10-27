/**
 * `pnpm verify:changed`: the quick check while iterating. Typechecks the
 * project (`tsc -b` is incremental), lints and format-checks only the files
 * changed since the base, and runs only the Vitest tests those changes reach
 * through the module graph. End-to-end tests don't run; `pnpm verify` and CI
 * run everything.
 *
 * The base is $VERIFY_BASE if set, else the Graphite parent branch, else
 * `origin/main` or `main`. Changes are counted from its merge base with HEAD
 * and include uncommitted and untracked files.
 */
import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'

const FORMATTED = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.jsonc', '.css', '.md', '.yaml', '.yml', '.html'])
const LINTED = new Set(['.ts', '.tsx', '.js', '.mjs'])

/** A git command's output, or undefined if it failed. */
function git(args: string[]): string | undefined {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}

/** The branch to compare against, as described above. */
function baseBranch(): string | undefined {
  const fromEnv = process.env['VERIFY_BASE']
  if (fromEnv) return fromEnv
  const parent = spawnSync('gt', ['parent'], { encoding: 'utf8' })
  const name = parent.status === 0 ? parent.stdout.trim().split('\n').at(-1)?.trim() : undefined
  for (const candidate of [name, 'origin/main', 'main']) {
    if (candidate && git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]) !== undefined) return candidate
  }
  return undefined
}

/** Runs a step with its output on the terminal, and exits if it fails. */
function step(args: string[]): void {
  process.stdout.write(`\n$ pnpm ${args.join(' ')}\n`)
  const result = spawnSync('pnpm', args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const branch = baseBranch()
const base = branch === undefined ? undefined : git(['merge-base', 'HEAD', branch])
if (base === undefined) {
  process.stderr.write('verify:changed: no base to compare against. Set VERIFY_BASE, or run `pnpm verify`.\n')
  process.exit(1)
}

// Committed, staged and unstaged changes against the merge base, minus
// deletions, plus untracked files.
const changed = [
  ...(git(['diff', '--name-only', '--diff-filter=d', base]) ?? '').split('\n'),
  ...(git(['ls-files', '--others', '--exclude-standard']) ?? '').split('\n'),
]
const files = [...new Set(changed.filter(Boolean))].toSorted()
const linted = files.filter((file) => LINTED.has(extname(file)))
const formatted = files.filter((file) => FORMATTED.has(extname(file)))

process.stdout.write(`verify:changed: ${files.length} changed since ${branch} (${base.slice(0, 7)})\n`)
step(['-s', 'typecheck'])
if (linted.length > 0) step(['-s', 'lint', ...linted])
// A file .oxfmtrc.json ignores is an unmatched pattern, not an error.
if (formatted.length > 0) step(['exec', 'oxfmt', '--check', '--no-error-on-unmatched-pattern', ...formatted])
step(['exec', 'vitest', 'run', '--changed', base])
process.stdout.write('\nverify:changed passed. End-to-end tests were skipped; `pnpm verify` and CI run them.\n')
