import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { scratchCheckout, type ScratchCheckout } from '../.claude/hooks/scratch-checkout.ts'

const SCRIPT = fileURLToPath(new URL('verify-changed.ts', import.meta.url))

let repo: ScratchCheckout
/** The merge base of `feature` with `main`: the commit both start from. */
let mainHead: string

function git(...args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd: repo.root,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

function commit(...paths: string[]): void {
  for (const path of paths) writeFileSync(repo.write(path), `// ${path} ${Math.random()}\n`)
  git('add', '-A')
  git('commit', '-qm', paths.join(' '))
}

/** Runs the script in the checkout; pnpm is the logging stub. */
function verifyChanged(env: Record<string, string> = {}) {
  return repo.run(SCRIPT, {}, env)
}

beforeAll(() => {
  repo = scratchCheckout()
  git('checkout', '-qb', 'main')
  commit('src/a.ts', 'src/b.ts', 'src/gone.ts', 'README.md')
  mainHead = git('rev-parse', 'HEAD')
  git('checkout', '-qb', 'feature')
  // A non-ASCII name, which git quotes unless asked for NUL-separated output.
  commit('src/a.ts', 'src/über.ts')
})
beforeEach(() => {
  git('checkout', '-qf', 'feature')
  repo.reset()
})
afterAll(() => {
  repo.remove()
})

describe('verify:changed', () => {
  it('checks committed, unstaged and untracked changes since the merge base, skipping deletions', () => {
    writeFileSync(join(repo.root, 'src/b.ts'), '// edited\n')
    writeFileSync(join(repo.root, 'README.md'), 'edited\n')
    rmSync(join(repo.root, 'src/gone.ts'))
    repo.write('src/new.tsx')
    repo.write('src/naïve.ts')
    repo.write('notes.txt')
    const { status, calls } = verifyChanged()
    expect(status).toBe(0)
    const files = 'src/a.ts src/b.ts src/naïve.ts src/new.tsx src/über.ts'
    expect(calls).toEqual([
      `${repo.root}|-s typecheck`,
      `${repo.root}|-s lint ${files}`,
      `${repo.root}|exec oxfmt --check --no-error-on-unmatched-pattern README.md ${files}`,
      `${repo.root}|exec vitest run --changed ${mainHead}`,
    ])
  })

  it('fails rather than passing when git cannot list the changes', () => {
    const index = join(repo.base, 'corrupt-index')
    writeFileSync(index, 'not an index')
    const { status, stderr, calls } = verifyChanged({ GIT_INDEX_FILE: index })
    expect(status).toBe(1)
    expect(stderr).toContain('could not list the changed files')
    expect(calls).toEqual([])
  })

  it('skips lint and format when no file of theirs changed', () => {
    const { status, calls } = verifyChanged({ VERIFY_BASE: 'HEAD' })
    expect(status).toBe(0)
    const head = git('rev-parse', 'HEAD')
    expect(calls).toEqual([`${repo.root}|-s typecheck`, `${repo.root}|exec vitest run --changed ${head}`])
  })

  it('compares against the Graphite parent when there is one', () => {
    const gtDir = join(repo.base, 'gt-stub')
    mkdirSync(gtDir, { recursive: true })
    writeFileSync(join(gtDir, 'gt'), '#!/bin/sh\necho parent\n')
    chmodSync(join(gtDir, 'gt'), 0o755)
    const path = `${join(repo.base, 'stubs')}${delimiter}${gtDir}${delimiter}${process.env['PATH'] ?? ''}`
    git('branch', '-f', 'parent', 'feature')
    const { calls } = verifyChanged({ PATH: path })
    expect(calls.at(-1)).toBe(`${repo.root}|exec vitest run --changed ${git('rev-parse', 'parent')}`)
  })

  it('stops at the first failing step', () => {
    repo.write('src/new.ts')
    const { status, stderr, calls } = verifyChanged({ STUB_FAIL: 'typecheck', STUB_OUTPUT: 'error TS2304' })
    expect(status).toBe(1)
    expect(stderr).toBe('error TS2304\n')
    expect(calls).toEqual([`${repo.root}|-s typecheck`])
  })

  it('fails with a hint when there is no base', () => {
    const { status, stderr, calls } = verifyChanged({ VERIFY_BASE: 'no-such-branch' })
    expect(status).toBe(1)
    expect(stderr).toContain('Set VERIFY_BASE')
    expect(calls).toEqual([])
  })
})
