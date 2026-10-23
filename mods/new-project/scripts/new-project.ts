/**
 * /new-project's hands. Node 23.6 or later runs it as is.
 *
 *   node new-project.ts scaffold --answers FILE --target DIR [--baselines DIR] [--dry-run]
 *   node new-project.ts setup DIR [--keep-versions]
 *
 * `scaffold` checks the answers against the baselines, then copies
 * `general/files/` and the stack's `template/` into DIR (new, or empty but
 * for `.git`, and outside any other git repository), renames the placeholders, writes CLAUDE.md with AGENTS.md
 * linked to it, `docs/adr/0001-stack.md` and README.md, and runs `git init`.
 * Nothing is written until every check passes; `--dry-run` stops there.
 *
 * `setup` installs the stack's toolchain and dependencies in DIR, takes new
 * majors (`--keep-versions` skips that, after reverting one that broke), and
 * runs its verify command, stopping at the first step that fails.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import type { Answers, Baseline, Stack, Step, TemplateFile } from './compose.ts'
import {
  AnswersError,
  bumpMiseToml,
  changedLines,
  composeAgentFile,
  kickoffFor,
  leftoverPlaceholders,
  misePins,
  missingKickoff,
  parseAnswers,
  parseDefaults,
  parseKickoff,
  pinRust,
  renameFile,
  renderAdr,
  renderReadme,
  RUST_STABLE_MANIFEST,
  rustStableVersion,
  STACKS,
  unknownAreas,
} from './compose.ts'

type SourceFile = TemplateFile & { bytes: Buffer; mode: number; link?: string }

const HERE = import.meta.dirname
// The mod sits at claude-improvements/mods/new-project; the baselines are
// two folders up from it.
const BESIDE_THE_MOD = resolve(HERE, '../../../baselines')
// A target may already hold these: a fresh `git clone` of an empty repo.
const ALLOWED_IN_TARGET = new Set(['.git', '.DS_Store'])
// Skipped when the baselines are not in a git checkout to ask what is tracked.
const BUILD_OUTPUT = new Set(['node_modules', 'target', 'dist', 'storybook-static', 'test-results', '.DS_Store'])

class UsageError extends Error {}

const expandHome = (path: string) => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path)

function run(argv: readonly string[], cwd: string) {
  const [command = '', ...args] = argv
  return spawnSync(command, args, { cwd, encoding: 'utf8' })
}

/** Paths under `dir`, relative to it: what git tracks or would track there, else a walk. */
function listFiles(dir: string): string[] {
  const listed = run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '.'], dir)
  if (listed.status === 0) {
    // --cached keeps a tracked file deleted from the working tree.
    return listed.stdout.split('\0').filter(path => path !== '' && existsSync(join(dir, path)))
  }
  const walk = (folder: string): string[] =>
    readdirSync(join(dir, folder), { withFileTypes: true })
      .filter(entry => !BUILD_OUTPUT.has(entry.name))
      .flatMap(entry => {
        const path = folder === '' ? entry.name : `${folder}/${entry.name}`
        return entry.isDirectory() ? walk(path) : [path]
      })
  return walk('')
}

function readTree(dir: string): SourceFile[] {
  if (!existsSync(dir)) throw new UsageError(`${dir} does not exist; is --baselines the claude-improvements baselines folder?`)
  return listFiles(dir).map(path => {
    const full = join(dir, path)
    const stat = lstatSync(full)
    if (stat.isSymbolicLink()) return { path, bytes: Buffer.alloc(0), mode: stat.mode, link: readlinkSync(full) }
    const bytes = readFileSync(full)
    const text = bytes.includes(0) ? undefined : bytes.toString('utf8')
    return { path, text, bytes, mode: stat.mode }
  })
}

function baselineState(dir: string): Baseline {
  const sha = run(['git', 'rev-parse', '--short', 'HEAD'], dir)
  if (sha.status !== 0) return { isDirty: false }
  const status = run(['git', 'status', '--porcelain', '--', '.'], dir)
  return { sha: sha.stdout.trim(), isDirty: status.stdout.trim() !== '' }
}

function checkTarget(target: string) {
  // Inside another repository the project would get no repo of its own, and a
  // first commit would land in the outer one. An empty clone is its own top.
  let existing = target
  while (!existsSync(existing)) existing = dirname(existing)
  const top = run(['git', 'rev-parse', '--show-toplevel'], existing)
  if (top.status === 0 && realpathSync(top.stdout.trim()) !== (existsSync(target) ? realpathSync(target) : ''))
    throw new UsageError(`${target} is inside the git repository at ${top.stdout.trim()}; name a folder outside it.`)

  if (!existsSync(target)) return
  if (!lstatSync(target).isDirectory()) throw new UsageError(`${target} is a file; name a new or empty folder.`)
  const extra = readdirSync(target).filter(name => !ALLOWED_IN_TARGET.has(name))
  if (extra.length > 0)
    throw new UsageError(
      `${target} already holds ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', …' : ''}; name a new or empty folder.`,
    )
}

/** `path` quoted for a POSIX shell, for a command the user may paste. */
const shellQuote = (path: string) => `'${path.replaceAll("'", "'\\''")}'`

const today = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function scaffold(options: { answers: string; target: string; baselines: string; isDryRun: boolean }) {
  const target = resolve(expandHome(options.target))
  const baselines = resolve(expandHome(options.baselines))
  checkTarget(target)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(expandHome(options.answers), 'utf8'))
  } catch (error) {
    throw new UsageError(`Cannot read the answers file ${options.answers}: ${(error as Error).message}`)
  }
  const answers: Answers = parseAnswers(raw)
  const stack: Stack = answers.stack

  const read = (path: string) => {
    const full = join(baselines, path)
    if (!existsSync(full)) throw new UsageError(`${full} is missing; is --baselines the claude-improvements baselines folder?`)
    // A Windows checkout may hold CRLF; the parsers match whole lines.
    return readFileSync(full, 'utf8').replaceAll('\r\n', '\n')
  }
  const kickoff = kickoffFor(parseKickoff(read('general/kickoff.md')), stack)
  const defaults = parseDefaults(read(`${stack}/README.md`))
  const problems = [...missingKickoff(answers, kickoff), ...unknownAreas(answers, defaults)]
  if (problems.length > 0) throw new AnswersError(problems)

  // The stack's template wins where both folders hold a path.
  const byPath = new Map<string, SourceFile>()
  for (const file of [...readTree(join(baselines, 'general/files')), ...readTree(join(baselines, `${stack}/template`))]) {
    const renamed = file.link === undefined ? renameFile(file, answers) : { path: file.path }
    byPath.set(renamed.path, { ...file, ...renamed })
  }
  const files = [...byPath.values()]

  const generated: TemplateFile[] = [
    { path: 'CLAUDE.md', text: composeAgentFile(read('general/CLAUDE.template.md'), read(`${stack}/CLAUDE.stack.md`), answers) },
    {
      path: 'docs/adr/0001-stack.md',
      text: renderAdr(answers, { date: today(), kickoff, defaults, baseline: baselineState(join(baselines, stack)) }),
    },
    { path: 'README.md', text: renderReadme(answers) },
  ]
  const overwritten = [...generated.map(file => file.path), 'AGENTS.md'].filter(path => byPath.has(path))
  if (overwritten.length > 0) throw new Error(`The baseline already ships ${overwritten.join(', ')}; scaffold would overwrite it.`)
  const leftovers = leftoverPlaceholders([...files, ...generated])
  if (leftovers.length > 0) throw new Error(leftovers.join('\n'))

  const plan = [...files.map(file => file.path), ...generated.map(file => file.path), 'AGENTS.md -> CLAUDE.md'].sort()
  if (options.isDryRun) {
    console.log(`Checks passed. Would write ${plan.length} paths into ${target}:\n${plan.map(p => `  ${p}`).join('\n')}`)
    return
  }

  mkdirSync(target, { recursive: true })
  for (const file of files) {
    const path = join(target, file.path)
    mkdirSync(dirname(path), { recursive: true })
    if (file.link !== undefined) {
      symlinkSync(file.link, path)
      continue
    }
    writeFileSync(path, file.text ?? file.bytes)
    chmodSync(path, file.mode & 0o777)
  }
  for (const file of generated) {
    mkdirSync(dirname(join(target, file.path)), { recursive: true })
    writeFileSync(join(target, file.path), file.text ?? '')
  }
  symlinkSync('CLAUDE.md', join(target, 'AGENTS.md'))

  const insideRepo = run(['git', 'rev-parse', '--show-toplevel'], target)
  const git =
    insideRepo.status === 0
      ? `already inside the git repository at ${insideRepo.stdout.trim()}`
      : run(['git', 'init', '-q', '-b', 'main'], target).status === 0
        ? 'git initialised on main'
        : 'git init failed; run it by hand'

  console.log(
    [
      `Scaffolded the ${stack} baseline into ${target}: ${plan.length} paths, ${git}.`,
      `Next: node ${shellQuote(join(HERE, 'new-project.ts'))} setup ${shellQuote(target)}`,
    ].join('\n'),
  )
}

function stackOf(dir: string): Stack {
  const found = (Object.keys(STACKS) as Stack[]).filter(stack => existsSync(join(dir, STACKS[stack].marker)))
  if (found.length !== 1)
    throw new UsageError(`${dir} holds ${found.length === 0 ? 'neither' : 'both'} package.json and Cargo.toml; which baseline is it?`)
  return found[0] as Stack
}

/**
 * Moves mise.toml's pins to their tools' latest releases and installs them.
 * Returns what went wrong, if anything.
 */
function bumpMiseTools(dir: string): string | undefined {
  const path = join(dir, 'mise.toml')
  const text = readFileSync(path, 'utf8')
  const latest: Record<string, string> = {}
  for (const { tool } of misePins(text)) {
    const found = run(['mise', 'latest', tool], dir)
    if (found.status !== 0 || found.stdout.trim() === '') return `\`mise latest ${tool}\` failed: ${found.stderr.trim()}`
    latest[tool] = found.stdout.trim()
  }
  writeFileSync(path, bumpMiseToml(text, latest))
  const installed = spawnSync('mise', ['install'], { cwd: dir, stdio: 'inherit' })
  return installed.status === 0 ? undefined : `\`mise install\` failed (exit ${installed.status})`
}

/**
 * Pins rust-toolchain.toml and `rust-version` to the current stable, then
 * installs it as CI does. Resolves with what went wrong, if anything.
 */
async function bumpRustToolchain(dir: string): Promise<string | undefined> {
  let version: string
  try {
    const response = await fetch(RUST_STABLE_MANIFEST, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) return `${RUST_STABLE_MANIFEST} answered ${response.status}`
    version = rustStableVersion(await response.text())
    const toolchainPath = join(dir, 'rust-toolchain.toml')
    const cargoPath = join(dir, 'Cargo.toml')
    const pinned = pinRust({ toolchain: readFileSync(toolchainPath, 'utf8'), cargo: readFileSync(cargoPath, 'utf8') }, version)
    writeFileSync(toolchainPath, pinned.toolchain)
    writeFileSync(cargoPath, pinned.cargo)
  } catch (error) {
    // fetch hides the network reason, such as a refused connection, in `cause`.
    const { message, cause } = error as Error
    return `Could not pin the current stable Rust: ${message}${cause instanceof Error ? ` (${cause.message})` : ''}`
  }
  console.log(`Rust ${version} is the current stable.`)
  // With no toolchain named, rustup installs the one rust-toolchain.toml
  // names, unless RUSTUP_TOOLCHAIN (a global mise `rust` exports it) names
  // another. It must not update itself either: that is the user's call.
  const env = { ...process.env }
  delete env['RUSTUP_TOOLCHAIN']
  const installed = spawnSync('rustup', ['toolchain', 'install', '--no-self-update'], { cwd: dir, env, stdio: 'inherit' })
  return installed.status === 0 ? undefined : `\`rustup toolchain install\` failed (exit ${installed.status})`
}

const BUMPS = {
  'mise-tools': "pin mise.toml's tools to their latest releases",
  'rust-toolchain': 'pin rust-toolchain.toml to the current stable',
} as const

async function setup(dirArgument: string, keepVersions: boolean): Promise<number> {
  const dir = resolve(expandHome(dirArgument))
  const stack = stackOf(dir)
  const { manifests, verify } = STACKS[stack]
  const steps: readonly Step[] = STACKS[stack].steps
  const readManifests = () => manifests.map(path => readFileSync(join(dir, path), 'utf8'))
  let before: string[] | undefined
  const majors = (): string[] => {
    if (before === undefined) return []
    const after = readManifests()
    return manifests.flatMap((path, i) => {
      const lines = changedLines(before?.[i] ?? '', after[i] ?? '')
      return lines.length === 0 ? [] : [`${path}:`, ...lines.map(line => `  ${line}`)]
    })
  }
  const reportMajors = (hasFailed: boolean) => {
    const lines = majors()
    if (lines.length === 0) return
    const hint = hasFailed ? ' (if one broke the step, revert it by hand and rerun setup with --keep-versions)' : ''
    console.log(`\nNew versions taken${hint}:\n${lines.join('\n')}`)
  }

  for (const step of steps) {
    if (step.isMajor === true && keepVersions) continue
    if (step.isMajor === true && before === undefined) before = readManifests()
    const label = 'run' in step ? step.run.join(' ') : BUMPS[step.bump]
    console.log(`\n▶ ${label}`)

    let failure: string | undefined
    if ('run' in step) {
      const [command = '', ...args] = step.run
      const result = spawnSync(command, args, { cwd: dir, stdio: 'inherit' })
      if (result.error !== undefined) failure = `Could not start ${command}: ${result.error.message}. Install it`
      else if (result.status !== 0) failure = `\`${label}\` failed (exit ${result.status})`
    } else {
      failure = step.bump === 'mise-tools' ? bumpMiseTools(dir) : await bumpRustToolchain(dir)
    }
    if (failure !== undefined) {
      reportMajors(true)
      console.error(`\n✗ ${failure}. Fix the cause in ${dir}, then rerun setup.`)
      return 1
    }
  }
  reportMajors(false)
  console.log(`\n✓ ${verify} passed in ${dir}.`)
  return 0
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      answers: { type: 'string' },
      target: { type: 'string' },
      baselines: { type: 'string', default: BESIDE_THE_MOD },
      'dry-run': { type: 'boolean', default: false },
      'keep-versions': { type: 'boolean', default: false },
    },
  })
  if (command === 'scaffold') {
    if (values.answers === undefined || values.target === undefined)
      throw new UsageError('scaffold needs --answers FILE and --target DIR.')
    scaffold({
      answers: values.answers,
      target: values.target,
      baselines: values.baselines,
      isDryRun: values['dry-run'],
    })
    return 0
  }
  if (command === 'setup') {
    const [dir] = positionals
    if (dir === undefined) throw new UsageError('setup needs the new repo folder: setup DIR.')
    return setup(dir, values['keep-versions'])
  }
  throw new UsageError('Usage: new-project.ts scaffold --answers FILE --target DIR [--baselines DIR] [--dry-run] | setup DIR [--keep-versions]')
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof AnswersError || error instanceof UsageError ? error.message : String(error))
  process.exitCode = 1
}
