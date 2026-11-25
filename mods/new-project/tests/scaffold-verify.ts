/**
 * Does each template still scaffold into a project that passes its own
 * verify? Scaffolds every stack (or the ones named) through this mod with
 * the test answers, puts in that stack's pinned lockfile from
 * baselines/scaffold-check/, and runs the mod's setup with frozen installs
 * and no version bumps, which ends in the project's real verify.
 *
 *   node mods/new-project/tests/scaffold-verify.ts [web] [rust] [python]
 *     [--target DIR] [--phase all|scaffold|install|verify] [--refresh] [--keep]
 *
 * `mise run scaffold:verify` runs it, and CI runs it a phase at a time
 * (.github/workflows/scaffold.yml) so actions can run between them:
 *
 * - scaffold: scaffold into the target, check that the pinned manifests are
 *   still the ones the scaffold writes, and copy the lockfile in;
 * - install: the setup steps up to the frozen install (`pnpm install
 *   --frozen-lockfile`, `cargo fetch --locked`, `uv lock --locked`);
 * - verify: the rest of setup, which ends in the stack's verify.
 *
 * `--refresh` installs without freezing instead, then writes the lockfile
 * and manifests back to baselines/scaffold-check/<stack>/: run it after
 * changing a template's dependencies. Without `--target`, each stack goes in
 * a temporary folder, removed after it passes unless `--keep` is given.
 */
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import type { Stack, Step } from '../scripts/compose.ts'
import { isStack, STACKS } from '../scripts/compose.ts'
import { answersFor } from './answers.ts'

const SCRIPT = resolve(import.meta.dirname, '../scripts/new-project.ts')
const ROOT = resolve(import.meta.dirname, '../../..')
const BASELINES = join(ROOT, 'baselines')
const PINS = join(BASELINES, 'scaffold-check')
const PHASES = ['all', 'scaffold', 'install', 'verify'] as const
type Phase = (typeof PHASES)[number]

/**
 * Per stack: the lockfile, how to list the manifests it pins, and the setup
 * step that resolves versions, with its frozen and refreshing replacements.
 */
const PINNED: Record<
  Stack,
  { lockfile: string; manifests: (dir: string) => string[]; resolves: string; locked: string[]; refresh: string[] }
> = {
  web: {
    lockfile: 'pnpm-lock.yaml',
    manifests: () => ['package.json', 'pnpm-workspace.yaml'],
    resolves: 'pnpm install',
    locked: ['pnpm', 'install', '--frozen-lockfile'],
    refresh: ['pnpm', 'install', '--no-frozen-lockfile'],
  },
  rust: {
    lockfile: 'Cargo.lock',
    manifests: (dir) => [
      'Cargo.toml',
      ...readdirSync(join(dir, 'crates'))
        .map((crate) => `crates/${crate}/Cargo.toml`)
        .filter((path) => existsSync(join(dir, path))),
    ],
    resolves: 'cargo generate-lockfile',
    locked: ['cargo', 'fetch', '--locked'],
    refresh: ['cargo', 'fetch'],
  },
  python: {
    lockfile: 'uv.lock',
    manifests: () => ['pyproject.toml'],
    resolves: 'uv lock',
    locked: ['uv', 'lock', '--locked'],
    refresh: ['uv', 'lock'],
  },
}

class CheckError extends Error {}

const isGitHub = process.env['GITHUB_ACTIONS'] === 'true'

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string, folder = ''): string[] {
  if (!existsSync(join(dir, folder))) return []
  return readdirSync(join(dir, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder === '' ? entry.name : `${folder}/${entry.name}`
    return entry.isDirectory() ? filesUnder(dir, path) : [path]
  })
}

/** The mod's setup steps for `stack` without the version bumps, split at the one that resolves versions. */
function stepsFor(stack: Stack, isRefresh: boolean): { install: string[][]; verify: string[][] } {
  const pinned = PINNED[stack]
  const steps: readonly Step[] = STACKS[stack].steps
  const runs = steps.flatMap((step) => ('run' in step && step.isMajor !== true ? [[...step.run]] : []))
  const isResolve = (run: string[]) =>
    run.slice(0, 3).join(' ') === 'mise exec --' && run.slice(3).join(' ') === pinned.resolves
  const at = runs.findIndex(isResolve)
  if (at === -1)
    throw new CheckError(
      `The mod's ${stack} setup no longer runs \`mise exec -- ${pinned.resolves}\`, the step this check freezes. Update PINNED in ${relative(ROOT, import.meta.filename)}.`,
    )
  const resolving = ['mise', 'exec', '--', ...(isRefresh ? pinned.refresh : pinned.locked)]
  return { install: [...runs.slice(0, at), resolving], verify: runs.slice(at + 1) }
}

/** The environment every step runs in: no global or system Git config, as the scaffold tests run. */
function stepEnv(scratch: string): NodeJS.ProcessEnv {
  const gitConfig = join(scratch, 'gitconfig')
  writeFileSync(gitConfig, '')
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' }
  // `mise run` describes its own task in these; the project's mise must not see them.
  for (const name of Object.keys(env))
    if (/^MISE_(TASK_|CONFIG_ROOT$|PROJECT_ROOT$|ORIGINAL_CWD$)/.test(name)) delete env[name]
  return env
}

function runSteps(stack: Stack, steps: string[][], target: string, env: NodeJS.ProcessEnv) {
  for (const argv of steps) {
    const label = argv.join(' ')
    process.stdout.write(`\n▶ ${stack}: ${label}\n`)
    const [command = '', ...args] = argv
    const result = spawnSync(command, args, { cwd: target, env, stdio: 'inherit' })
    if (result.error !== undefined) throw new CheckError(`Could not start ${command}: ${result.error.message}`)
    if (result.status !== 0) throw new CheckError(`\`${label}\` failed (exit ${result.status ?? result.signal})`)
  }
}

/** Scaffolds `stack` into `target` with the test answers, and puts its pinned lockfile in. */
function scaffold(stack: Stack, target: string, scratch: string, isRefresh: boolean) {
  const answers = join(scratch, `${stack}.json`)
  writeFileSync(answers, JSON.stringify(answersFor(stack, BASELINES)))
  process.stdout.write(`\n▶ ${stack}: scaffold into ${target}\n`)
  const result = spawnSync(
    process.execPath,
    [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--baselines', BASELINES],
    { stdio: 'inherit', env: stepEnv(scratch) },
  )
  if (result.status !== 0) throw new CheckError(`The scaffold failed (exit ${result.status ?? result.signal})`)

  const pins = join(PINS, stack)
  const { lockfile } = PINNED[stack]
  const refresh = `mise run scaffold:verify --refresh ${stack}`
  if (!isRefresh) {
    const pinned = filesUnder(pins).filter((path) => path !== lockfile)
    const written = PINNED[stack].manifests(target)
    const stale = [...new Set([...pinned, ...written])].filter((path) => {
      const [a, b] = [join(pins, path), join(target, path)]
      return !existsSync(a) || !existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')
    })
    if (stale.length > 0)
      throw new CheckError(
        `The ${stack} template's ${stale.join(', ')} no longer match the copies pinned in ${relative(ROOT, pins)}. Run \`${refresh}\` to resolve the lockfile again, and commit what it writes.`,
      )
    if (!existsSync(join(pins, lockfile)))
      throw new CheckError(`${relative(ROOT, join(pins, lockfile))} is missing. Run \`${refresh}\` to create it.`)
  }
  if (existsSync(join(pins, lockfile))) copyFileSync(join(pins, lockfile), join(target, lockfile))
}

/** Writes the lockfile and the manifests it was resolved from back to baselines/scaffold-check/<stack>/. */
function writePins(stack: Stack, target: string) {
  const pins = join(PINS, stack)
  rmSync(pins, { recursive: true, force: true })
  for (const path of [...PINNED[stack].manifests(target), PINNED[stack].lockfile]) {
    mkdirSync(dirname(join(pins, path)), { recursive: true })
    copyFileSync(join(target, path), join(pins, path))
  }
  process.stdout.write(`\n✓ ${stack}: wrote ${relative(ROOT, pins)}; review and commit it.\n`)
}

function check(stack: Stack, options: { target: string; phase: Phase; isRefresh: boolean }) {
  const { target, phase, isRefresh } = options
  const scratch = mkdtempSync(join(tmpdir(), 'scaffold-verify-env-'))
  try {
    const env = stepEnv(scratch)
    const steps = stepsFor(stack, isRefresh)
    if (phase === 'all' || phase === 'scaffold') scaffold(stack, target, scratch, isRefresh)
    if (phase === 'all' || phase === 'install') {
      runSteps(stack, steps.install, target, env)
      if (isRefresh) writePins(stack, target)
    }
    if (phase === 'all' || phase === 'verify') runSteps(stack, steps.verify, target, env)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: 'string' },
      phase: { type: 'string', default: 'all' },
      refresh: { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
    },
  })
  const stacks = positionals.length === 0 ? Object.keys(STACKS).filter(isStack) : positionals
  const unknown = stacks.filter((stack) => !isStack(stack))
  if (unknown.length > 0) throw new CheckError(`Unknown stack ${unknown.join(', ')}: name web, rust or python.`)
  const phase = PHASES.find((p) => p === values.phase)
  if (phase === undefined) throw new CheckError(`--phase must be ${PHASES.join(', ')}, not "${values.phase}".`)
  if (values.target !== undefined && stacks.length !== 1) throw new CheckError('--target takes exactly one stack.')
  if (phase !== 'all' && values.target === undefined)
    throw new CheckError(`--phase ${phase} needs --target, so the phases share one project.`)

  const results: string[] = []
  let failed = 0
  for (const stack of stacks.filter(isStack)) {
    const target =
      values.target === undefined ? mkdtempSync(join(tmpdir(), `scaffold-verify-${stack}-`)) : resolve(values.target)
    const started = performance.now()
    const seconds = () => Math.round((performance.now() - started) / 1000)
    try {
      check(stack, { target, phase, isRefresh: values.refresh })
      results.push(`✓ ${stack}: passed in ${seconds()} s`)
      if (values.target === undefined && !values.keep) rmSync(target, { recursive: true, force: true })
      else results.push(`  kept in ${target}`)
    } catch (error) {
      if (!(error instanceof CheckError)) throw error
      failed += 1
      results.push(`✗ ${stack}: ${error.message} (after ${seconds()} s)`, `  kept in ${target}`)
      if (isGitHub) process.stdout.write(`::error title=Scaffold verify (${stack})::${error.message}\n`)
    }
  }
  process.stdout.write(`\n${results.join('\n')}\n`)
  return failed === 0 ? 0 : 1
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error instanceof CheckError ? error.message : String(error)}\n`)
  process.exitCode = 1
}
