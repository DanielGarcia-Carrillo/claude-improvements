import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { scratchCheckout, type ScratchCheckout } from './scratch-checkout.ts'

const HOOK = fileURLToPath(new URL('before-stop.ts', import.meta.url))

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

/** Runs the hook as Claude stops in `cwd`; `retry` is a stop after one this hook blocked. */
function stop(env: Record<string, string> = {}, { cwd = repo.root, retry = false } = {}) {
  return repo.run(HOOK, { hook_event_name: 'Stop', cwd, stop_hook_active: retry }, env)
}

describe('before-stop', () => {
  it('lets Claude stop without checks when nothing changed', () => {
    expect(stop()).toEqual({ status: 0, stderr: '', calls: [] })
  })

  it('typechecks and lints a changed checkout', () => {
    repo.write('src/app.ts')
    expect(stop()).toEqual({
      status: 0,
      stderr: '',
      calls: [`${repo.root}|-s typecheck`, `${repo.root}|-s lint`],
    })
  })

  it('blocks the stop with the typecheck errors, before linting', () => {
    repo.write('src/app.ts')
    const { status, stderr, calls } = stop({ STUB_FAIL: 'typecheck', STUB_OUTPUT: 'src/app.ts(1,1): error TS2304' })
    expect(status).toBe(2)
    expect(stderr).toBe('`pnpm typecheck` failed. Fix these before finishing:\nsrc/app.ts(1,1): error TS2304\n')
    expect(calls).toEqual([`${repo.root}|-s typecheck`])
  })

  it('blocks the stop with the lint errors', () => {
    repo.write('src/app.ts')
    const { status, stderr } = stop({ STUB_FAIL: 'lint', STUB_OUTPUT: 'no-debugger' })
    expect(status).toBe(2)
    expect(stderr).toBe('`pnpm lint` failed. Fix these before finishing:\nno-debugger\n')
  })

  it('reports without blocking again on the stop after a block', () => {
    repo.write('src/app.ts')
    const { status, stderr } = stop({ STUB_FAIL: 'lint', STUB_OUTPUT: 'no-debugger' }, { retry: true })
    expect(status).toBe(1)
    expect(stderr).toBe('`pnpm lint` still fails:\nno-debugger\n')
  })

  it('sends back only the last 80 lines', () => {
    repo.write('src/app.ts')
    const lines = Array.from({ length: 100 }, (_, i) => `error ${i + 1}`)
    const { stderr } = stop({ STUB_FAIL: 'typecheck', STUB_OUTPUT: lines.join('\n') })
    expect(stderr).toBe(`\`pnpm typecheck\` failed. Fix these before finishing:\n${lines.slice(20).join('\n')}\n`)
  })

  it('says why when pnpm cannot run', () => {
    repo.write('src/app.ts')
    const { status, stderr } = stop({ PATH: repo.pathWithoutPnpm })
    expect(status).toBe(2)
    expect(stderr).toBe('`pnpm typecheck` failed. Fix these before finishing:\nspawnSync pnpm ENOENT\n')
  })

  // The payload's cwd follows Claude into a worktree; CLAUDE_PROJECT_DIR stays on the main checkout.
  it('checks the checkout Claude is in, from its top level', () => {
    repo.write('src/app.ts')
    const { calls } = stop({ CLAUDE_PROJECT_DIR: repo.base }, { cwd: join(repo.root, 'src') })
    expect(calls).toEqual([`${repo.root}|-s typecheck`, `${repo.root}|-s lint`])
  })
})
