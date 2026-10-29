/**
 * A throwaway git checkout for the hook tests, which run each hook as Claude
 * Code does: `node <hook>` with the payload on stdin. `pnpm` on PATH is a stub
 * that logs each call as `<cwd>|<args>`, and fails, printing $STUB_OUTPUT, when
 * one of its arguments is $STUB_FAIL. No test waits on the real tools.
 *
 * Make one per test file and `reset()` it between tests: macOS vets each new
 * executable on its first run, which costs a few hundred milliseconds.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

const PNPM_STUB = `#!/bin/sh
printf '%s|%s\\n' "$(pwd -P)" "$*" >> "$STUB_LOG"
for arg in "$@"; do
  if [ "$arg" = "$STUB_FAIL" ]; then printf '%s\\n' "$STUB_OUTPUT" >&2; exit 1; fi
done
`

export interface HookRun {
  status: number | null
  stderr: string
  /** Each pnpm call, as `<cwd>|<args>`. */
  calls: string[]
}

export interface ScratchCheckout {
  /** The directory holding the checkout, the stubs and the call log; not itself a checkout. */
  base: string
  /** The checkout's top level, symlinks resolved, as git reports it. */
  root: string
  /** A PATH with git on it and no pnpm. */
  pathWithoutPnpm: string
  /** Creates `path` (relative to the checkout) and returns its absolute path. */
  write(path: string): string
  /**
   * Runs `hook` with `payload` on stdin, in `cwd` (the checkout by default);
   * `env` is added to the stubbed environment.
   */
  run(hook: string, payload: object, env?: Record<string, string>, cwd?: string): HookRun
  /** Deletes every file in the checkout, so the next test starts clean. */
  reset(): void
  remove(): void
}

export function scratchCheckout(): ScratchCheckout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'hook-test-')))
  const root = join(base, 'repo')
  const stubs = join(base, 'stubs')
  const pathWithoutPnpm = join(base, 'git-only')
  const log = join(base, 'pnpm.log')
  for (const dir of [root, stubs, pathWithoutPnpm]) mkdirSync(dir)
  spawnSync('git', ['init', '-q'], { cwd: root })
  writeFileSync(join(stubs, 'pnpm'), PNPM_STUB)
  chmodSync(join(stubs, 'pnpm'), 0o755)
  const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  symlinkSync(git, join(pathWithoutPnpm, 'git'))

  return {
    base,
    root,
    pathWithoutPnpm,
    write(path) {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, '')
      return file
    },
    run(hook, payload, env = {}, cwd = root) {
      rmSync(log, { force: true })
      const result = spawnSync(process.execPath, [hook], {
        cwd,
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${stubs}${delimiter}${process.env['PATH'] ?? ''}`,
          CLAUDE_PROJECT_DIR: root,
          STUB_LOG: log,
          STUB_FAIL: '',
          STUB_OUTPUT: '',
          ...env,
        },
      })
      const calls = existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : []
      return { status: result.status, stderr: result.stderr, calls }
    },
    reset() {
      spawnSync('git', ['clean', '-fdxq'], { cwd: root })
    },
    remove() {
      rmSync(base, { recursive: true, force: true })
    },
  }
}
