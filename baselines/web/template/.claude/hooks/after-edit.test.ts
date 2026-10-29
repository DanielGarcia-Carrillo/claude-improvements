import { symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { scratchCheckout, type ScratchCheckout } from './scratch-checkout.ts'

const HOOK = fileURLToPath(new URL('after-edit.ts', import.meta.url))

let repo: ScratchCheckout
beforeAll(() => {
  repo = scratchCheckout()
})
beforeEach(() => {
  repo.reset()
})
afterAll(() => {
  repo.remove()
})

/** Runs the hook after an edit of `file`, with Claude in `cwd`. */
function edit(file: string, env: Record<string, string> = {}, cwd = repo.root) {
  return repo.run(
    HOOK,
    { hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: file } },
    env,
  )
}

describe('after-edit', () => {
  it('fixes, formats and lints a script', () => {
    const file = repo.write('src/app.ts')
    expect(edit(file)).toEqual({
      status: 0,
      stderr: '',
      calls: [
        `${repo.root}|exec oxlint --fix ${file}`,
        `${repo.root}|exec oxfmt --no-error-on-unmatched-pattern ${file}`,
        `${repo.root}|exec oxlint ${file}`,
        `${repo.root}|-s spellcheck --force-exclude -- ${file}`,
      ],
    })
  })

  it.each(['package.json', 'README.md', 'src/index.css', '.github/workflows/ci.yml', 'index.html'])(
    'formats %s without linting it',
    (path) => {
      const file = repo.write(path)
      expect(edit(file).calls).toEqual([
        `${repo.root}|exec oxfmt --no-error-on-unmatched-pattern ${file}`,
        `${repo.root}|-s spellcheck --force-exclude -- ${file}`,
      ])
    },
  )

  it.each(['public/icon.png', 'public/logo.svg', 'notes.txt', '.gitignore'])(
    'spellchecks %s without formatting or linting',
    (path) => {
      const file = repo.write(path)
      expect(edit(file)).toEqual({
        status: 0,
        stderr: '',
        calls: [`${repo.root}|-s spellcheck --force-exclude -- ${file}`],
      })
    },
  )

  it('leaves a file outside the checkout alone', () => {
    const file = join(repo.base, 'elsewhere.ts')
    writeFileSync(file, '')
    expect(edit(file)).toEqual({ status: 0, stderr: '', calls: [] })
  })

  it('hands back a file oxfmt cannot parse, before linting it', () => {
    const file = repo.write('src/app.ts')
    const { status, stderr, calls } = edit(file, { STUB_FAIL: 'oxfmt', STUB_OUTPUT: 'Unexpected token' })
    expect(status).toBe(2)
    expect(stderr).toBe("oxfmt: couldn't format src/app.ts:\nUnexpected token\n")
    expect(calls).toHaveLength(2)
  })

  it('hands back what lint --fix left', () => {
    const file = repo.write('src/app.ts')
    const { status, stderr } = edit(file, { STUB_FAIL: 'oxlint', STUB_OUTPUT: 'no-debugger' })
    expect(status).toBe(2)
    expect(stderr).toBe('oxlint: problems in src/app.ts that --fix could not resolve:\nno-debugger\n')
  })

  it('says why when pnpm cannot run', () => {
    const file = repo.write('src/app.ts')
    const { status, stderr } = edit(file, { PATH: repo.pathWithoutPnpm })
    expect(status).toBe(2)
    expect(stderr).toBe("oxfmt: couldn't format src/app.ts:\nspawnSync pnpm ENOENT\n")
  })

  // The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays on the main checkout.
  it('runs the tools at the top of the checkout Claude is in', () => {
    const file = repo.write('src/app.ts')
    const { calls } = edit(file, { CLAUDE_PROJECT_DIR: repo.base }, join(repo.root, 'src'))
    expect(calls[0]).toBe(`${repo.root}|exec oxlint --fix ${file}`)
  })

  it('falls back to CLAUDE_PROJECT_DIR without a cwd', () => {
    const file = repo.write('src/app.ts')
    const { calls } = repo.run(
      HOOK,
      { tool_input: { file_path: file } },
      { CLAUDE_PROJECT_DIR: join(repo.root, 'src') },
    )
    expect(calls[0]).toBe(`${repo.root}|exec oxlint --fix ${file}`)
  })

  it('follows a symlink into the checkout', () => {
    const file = repo.write('src/app.ts')
    const link = join(repo.base, 'link')
    symlinkSync(repo.root, link)
    const { calls } = edit(join(link, 'src/app.ts'), {}, link)
    expect(calls[0]).toBe(`${repo.root}|exec oxlint --fix ${file}`)
  })

  it('hands spelling failures back to Claude', () => {
    const file = repo.write('notes.txt')
    const result = edit(file, { STUB_FAIL: 'spellcheck', STUB_OUTPUT: 'Use American English' })
    expect(result.status).toBe(2)
    expect(result.stderr).toBe('typos: problems in notes.txt:\nUse American English\n')
  })

  it('ignores a payload without a file', () => {
    expect(repo.run(HOOK, { cwd: repo.root, tool_input: {} })).toEqual({ status: 0, stderr: '', calls: [] })
  })
})
