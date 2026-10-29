/**
 * The scaffold over the real baselines, which the plugin test kit cannot
 * read (it offers no file system). Run it with Node, not `claude plugin test`:
 *
 *   mise exec -- node --test mods/new-project/tests/baselines.node.mts
 *
 * Each stack is scaffolded into a temporary folder, then checked with the
 * template CI's own placeholder step, so a placeholder the baselines gain
 * without a rename rule fails here first. Setup runs only against a
 * stand-in mise, so nothing is installed.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'

import type { Stack } from '../scripts/compose.ts'
import { kickoffFor, PLACEHOLDER, PLACEHOLDER_EXEMPT, parseKickoff } from '../scripts/compose.ts'

const SCRIPT = resolve(import.meta.dirname, '../scripts/new-project.ts')
const BASELINES = resolve(import.meta.dirname, '../../../baselines')
const scratch = mkdtempSync(join(tmpdir(), 'new-project-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const run = (command: string, args: readonly string[], cwd: string) =>
  spawnSync(command, args, { cwd, encoding: 'utf8' })

/** Answers that take every default, with names that test the escaping. */
function answersFor(stack: Stack) {
  const sections = kickoffFor(parseKickoff(readFileSync(join(BASELINES, 'general/kickoff.md'), 'utf8')), stack)
  const isWeb = stack === 'web'
  return {
    stack,
    name: isWeb ? "Dan's Trips & Tours" : "Dan's Line Width",
    slug: isWeb ? 'dans-trips' : 'line-width',
    ...(isWeb ? { shortName: 'Trips' } : { repository: 'https://github.com/someone/line-width' }),
    description: 'Checks the "real" thing for people in a hurry.',
    summary: 'A scaffold check.',
    issues: 'GitHub Issues',
    merging: 'The owner merges',
    kickoff: sections.flatMap((s) =>
      s.questions.map((question) => ({ question, answer: 'Default', source: 'default' })),
    ),
    changed: [],
    architecture: [{ choice: 'Shape', line: 'The baseline as is' }],
    alternatives: [{ option: 'Nothing else', why: 'This is a test' }],
    consequences: 'None.',
    followUps: [],
  }
}

/** Generates a named scratch project from the real baseline without installing dependencies. */
function scaffold(stack: Stack, name: string = stack): string {
  const answers = join(scratch, `${name}.json`)
  writeFileSync(answers, JSON.stringify(answersFor(stack)))
  const target = join(scratch, name)
  const result = run(
    'node',
    [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--baselines', BASELINES],
    scratch,
  )
  assert.equal(result.status, 0, result.stderr)
  return target
}

/** What the template CI's "No template placeholders left" step finds, plus paths, which it does not read. */
function leftovers(repo: string): string {
  assert.equal(run('git', ['add', '-A'], repo).status, 0)
  const grep = run('git', ['grep', '-niE', 'replace[-_ ]?me([^a-z]|$)', '--', `:!${PLACEHOLDER_EXEMPT}`], repo)
  assert.notEqual(grep.status, 2, grep.stderr)
  const paths = run('git', ['ls-files'], repo)
    .stdout.split('\n')
    .filter((path) => PLACEHOLDER.test(path))
  return [grep.stdout, ...paths].join('\n').trim()
}

const read = (repo: string, path: string) => readFileSync(join(repo, path), 'utf8')

/** A copy of the baselines to alter, without build output. */
function baselinesCopy(name: string): string {
  const copy = join(scratch, name)
  cpSync(BASELINES, copy, {
    recursive: true,
    filter: (source) => !/\/(node_modules|target|dist|\.venv)(\/|$)/.test(source),
  })
  return copy
}

/** Scaffold's dry run of the web stack into `target`. */
function dryRun(target: string, baselines: string) {
  const answers = join(scratch, 'web.json')
  writeFileSync(answers, JSON.stringify(answersFor('web')))
  return run(
    'node',
    [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--baselines', baselines, '--dry-run'],
    scratch,
  )
}

test('the web template scaffolds with no placeholder left', () => {
  const repo = scaffold('web')
  assert.equal(leftovers(repo), '')
  assert.match(read(repo, 'package.json'), /"name": "dans-trips"/)
  assert.match(read(repo, 'wrangler.jsonc'), /"name": "dans-trips"/)
  assert.match(read(repo, 'index.html'), /<title>Dan's Trips &amp; Tours<\/title>/)
  assert.match(read(repo, 'index.html'), /content="Checks the &quot;real&quot; thing for people in a hurry\."/)
  assert.match(read(repo, 'vite.config.ts'), /short_name: 'Trips'/)
  assert.match(read(repo, 'src/routes/index.tsx'), /<h1>Dan's Trips &amp; Tours<\/h1>/)
  assert.match(read(repo, 'tests/e2e/app.spec.ts'), /toHaveText\("Dan's Trips & Tours"\)/)
})

test('the Rust template scaffolds with no placeholder left', () => {
  const repo = scaffold('rust')
  assert.equal(leftovers(repo), '')
  assert.ok(existsSync(join(repo, 'crates/line-width/Cargo.toml')))
  assert.ok(existsSync(join(repo, 'crates/line-width-core/Cargo.toml')))
  assert.match(read(repo, 'Cargo.toml'), /repository = "https:\/\/github.com\/someone\/line-width"/)
  assert.match(read(repo, 'crates/line-width/src/cli.rs'), /use line_width_core::/)
  assert.match(read(repo, 'crates/line-width/tests/cli.rs'), /fn line_width\(\) -> Command/)
  assert.match(read(repo, 'CLAUDE.md'), /cargo nextest run -p line-width-core/)
})

test('the Python template scaffolds with no placeholder left', () => {
  const repo = scaffold('python')
  assert.equal(leftovers(repo), '')
  assert.ok(existsSync(join(repo, 'src/line_width/cli.py')))
  const pyproject = read(repo, 'pyproject.toml')
  assert.match(pyproject, /^name = "line-width"$/m)
  assert.match(pyproject, /^Repository = "https:\/\/github.com\/someone\/line-width"$/m)
  assert.match(pyproject, /^line-width = "line_width.cli:main"$/m)
  assert.match(pyproject, /^"src\/line_width\/_output.py" = /m)
  assert.match(read(repo, 'tests/test_cli.py'), /^def line_width\(/m)
  assert.match(read(repo, 'CLAUDE.md'), /uv run line-width check FILE --json/)
})

test('baselines checked out with CRLF line endings scaffold too', () => {
  const copy = baselinesCopy('crlf')
  for (const path of ['general/kickoff.md', 'general/CLAUDE.template.md', 'web/README.md', 'web/CLAUDE.stack.md'])
    writeFileSync(join(copy, path), read(copy, path).replaceAll('\n', '\r\n'))
  const result = dryRun(join(scratch, 'crlf-target'), copy)
  assert.equal(result.status, 0, result.stderr)
})

test('a baseline that ships AGENTS.md is refused before anything is written', () => {
  const copy = baselinesCopy('agents')
  writeFileSync(join(copy, 'general/files/AGENTS.md'), '# Agents\n')
  const result = dryRun(join(scratch, 'agents-target'), copy)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /already ships AGENTS\.md/)
})

test('a target inside another git repository is refused', () => {
  const outer = join(scratch, 'outer')
  mkdirSync(outer)
  assert.equal(run('git', ['init', '-q'], outer).status, 0)
  const result = dryRun(join(outer, 'nested'), BASELINES)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /inside the git repository/)
})

test('a baseline folder that is a link is refused before anything is written', () => {
  const copy = baselinesCopy('linked')
  const outside = join(scratch, 'outside')
  mkdirSync(outside)
  rmSync(join(copy, 'general/files/docs'), { recursive: true })
  symlinkSync(outside, join(copy, 'general/files/docs'))
  const result = dryRun(join(scratch, 'linked-target'), copy)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /links docs; scaffold would write docs\/adr\/0001-stack\.md through it/)
})

/** A folder for PATH holding stand-ins that print a version: git and mise, not gh. */
function toolsBin(): string {
  const bin = join(scratch, 'doctor-bin')
  if (existsSync(bin)) return bin
  mkdirSync(bin)
  writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "git version 9.9.9"\n', { mode: 0o755 })
  writeFileSync(join(bin, 'mise'), '#!/bin/sh\necho "2026.10.0 macos-arm64"\n', { mode: 0o755 })
  return bin
}

const doctor = (script: string, options: readonly string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script, 'doctor', ...options], {
    encoding: 'utf8',
    env: { PATH: toolsBin(), ...env },
  })

test('doctor finds the checkout through a skill folder linked into an agent', () => {
  // How Codex (~/.agents/skills) or a plain Claude Code skill installs it.
  const skills = join(scratch, 'agent-skills')
  mkdirSync(skills)
  symlinkSync(resolve(import.meta.dirname, '../skills/new-project'), join(skills, 'new-project'))
  const result = doctor(join(skills, 'new-project/scripts/new-project.ts'), [])
  assert.equal(result.status, 0, result.stdout)
  assert.ok(result.stdout.includes(`✓ Baselines: ${BASELINES} (from the checkout this script is in)`), result.stdout)
  assert.match(result.stdout, /✓ git: git version 9\.9\.9\n✓ mise: 2026\.10\.0/)
  assert.match(result.stdout, /- gh: not found \(optional/)
})

test('doctor takes --baselines over $NEW_PROJECT_BASELINES over the checkout, and fails on a wrong one', () => {
  const copy = baselinesCopy('doctor')
  const env = { NEW_PROJECT_BASELINES: copy }
  assert.match(doctor(SCRIPT, [], env).stdout, new RegExp(`Baselines: ${copy} \\(from \\$NEW_PROJECT_BASELINES\\)`))
  assert.match(doctor(SCRIPT, ['--baselines', BASELINES], env).stdout, /\(from --baselines\)/)

  const wrong = doctor(SCRIPT, [], { NEW_PROJECT_BASELINES: scratch })
  assert.equal(wrong.status, 1)
  assert.match(
    wrong.stdout,
    /✗ Baselines: .*has no general\/kickoff\.md\. Pass --baselines or set NEW_PROJECT_BASELINES/,
  )

  const noMise = spawnSync(process.execPath, [SCRIPT, 'doctor'], { encoding: 'utf8', env: { PATH: scratch } })
  assert.equal(noMise.status, 1)
  assert.match(noMise.stdout, /✗ mise: missing\. Install it/)
})

test('scaffold finds the baselines the way doctor does', () => {
  const answers = join(scratch, 'env-web.json')
  writeFileSync(answers, JSON.stringify(answersFor('web')))
  const dryRunWith = (target: string, env: Record<string, string>) =>
    spawnSync(process.execPath, [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--dry-run'], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

  const fromEnv = dryRunWith(join(scratch, 'env-target'), { NEW_PROJECT_BASELINES: baselinesCopy('env') })
  assert.equal(fromEnv.status, 0, fromEnv.stderr)
  const wrong = dryRunWith(join(scratch, 'env-wrong-target'), { NEW_PROJECT_BASELINES: scratch })
  assert.equal(wrong.status, 1)
  assert.match(wrong.stderr, /from \$NEW_PROJECT_BASELINES is .*, which has no general\/kickoff\.md/)
})

test('setup needs --stack for a folder holding both manifests, and runs the stack named', () => {
  // A Rust tool with an npm wrapper holds both.
  const repo = join(scratch, 'both')
  mkdirSync(repo)
  writeFileSync(join(repo, 'package.json'), '{}\n')
  writeFileSync(join(repo, 'Cargo.toml'), '[workspace]\n')
  // The only mise on PATH logs its calls and fails `mise exec`, the first
  // step that differs between the stacks.
  const bin = join(scratch, 'bin')
  const calls = join(scratch, 'mise-calls')
  mkdirSync(bin)
  writeFileSync(join(bin, 'mise'), `#!/bin/sh\necho "$*" >> '${calls}'\n[ "$1" != exec ]\n`, { mode: 0o755 })
  const setup = (...options: string[]) =>
    spawnSync(process.execPath, [SCRIPT, 'setup', repo, ...options], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    })

  const inferred = setup()
  assert.equal(inferred.status, 1)
  assert.match(inferred.stderr, /holds package\.json and Cargo\.toml; pass --stack web or --stack rust/)
  assert.ok(!existsSync(calls), 'setup ran mise before it knew the stack')

  // --keep-versions skips the toolchain bump, which would fetch the stable release.
  const rust = setup('--stack', 'rust', '--keep-versions')
  assert.equal(rust.status, 1)
  assert.match(rust.stderr, /`mise exec -- cargo generate-lockfile` failed/)
  assert.equal(read(scratch, 'mise-calls'), 'trust\ninstall\nexec -- cargo generate-lockfile\n')

  assert.match(setup('--stack', 'go').stderr, /--stack must be web, rust or python, not "go"/)

  // Python bindings for a Rust tool hold pyproject.toml beside Cargo.toml.
  writeFileSync(join(repo, 'pyproject.toml'), '[project]\n')
  assert.match(
    setup().stderr,
    /holds package\.json, Cargo\.toml and pyproject\.toml; pass --stack web, --stack rust or --stack python/,
  )
  rmSync(calls)
  const python = setup('--stack', 'python', '--keep-versions')
  assert.equal(python.status, 1)
  assert.match(python.stderr, /`mise exec -- uv lock` failed/)
  assert.equal(read(scratch, 'mise-calls'), 'trust\ninstall\nexec -- uv lock\n')

  rmSync(join(repo, 'package.json'))
  assert.match(setup('--stack', 'web').stderr, /--stack web needs package\.json/)
  rmSync(join(repo, 'Cargo.toml'))
  rmSync(join(repo, 'pyproject.toml'))
  assert.match(setup().stderr, /holds no package\.json, Cargo\.toml or pyproject\.toml/)
})

for (const stack of ['web', 'rust', 'python'] as const) {
  test(`${stack} scaffolds enforce American English, including hidden agent files`, () => {
    const repo = scaffold(stack, `${stack}-spelling`)
    assert.match(read(repo, 'mise.toml'), /typos = "1\.51\.1"/)
    const clean = run('typos', [], repo)
    assert.equal(clean.status, 0, clean.stdout + clean.stderr)
    for (const path of ['README.md', '.claude/spelling.md']) {
      writeFileSync(join(repo, path), ['col', 'our'].join('') + '\n')
      const checked = run('typos', [], repo)
      assert.equal(checked.status, 2, checked.stdout + checked.stderr)
      assert.match(checked.stdout, /color/)
      writeFileSync(join(repo, path), 'color\n')
    }
    assert.equal(run('typos', [], repo).status, 0)
  })
}

for (const stack of ['rust', 'python'] as const) {
  test(`${stack} hooks return spelling errors from the payload checkout`, () => {
    const repo = scaffold(stack, `${stack}-hooks`)
    const bin = join(scratch, `${stack}-hook-tools`)
    mkdirSync(bin)
    for (const tool of ['rustfmt', 'cargo', 'uv'])
      writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    // Model mise exposing the pinned binary to a process with no typos on PATH.
    const located = run('mise', ['which', 'typos'], resolve(BASELINES, '..'))
    assert.equal(located.status, 0, located.stderr)
    const typosDir = dirname(located.stdout.trim())
    const path = (process.env['PATH'] ?? '')
      .split(delimiter)
      .filter((dir) => !existsSync(join(dir, 'typos')))
      .join(delimiter)
    writeFileSync(
      join(bin, 'mise'),
      `#!/bin/sh
[ "$1" = exec ] && [ "$2" = -- ] && [ "$3" = typos ] || exit 99
shift 2
PATH=${JSON.stringify(typosDir)}:"$PATH" exec "$@"
`,
      { mode: 0o755 },
    )
    const nested = join(repo, 'nested')
    mkdirSync(nested)
    const file = join(repo, 'README.md')
    writeFileSync(file, ['col', 'our'].join('') + '\n')
    const hook = (name: string, retry = false) =>
      spawnSync('bash', [join(repo, `.claude/hooks/${name}.sh`)], {
        cwd: nested,
        input: JSON.stringify({ cwd: nested, tool_input: { file_path: file }, stop_hook_active: retry }),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${delimiter}${path}`, CLAUDE_PROJECT_DIR: scratch },
      })
    const edited = hook('after-edit')
    assert.equal(edited.status, 2, edited.stderr)
    assert.match(edited.stderr, /color/)
    const stopped = hook('before-stop')
    assert.equal(stopped.status, 2, stopped.stderr)
    assert.match(stopped.stderr, /color/)
    assert.equal(hook('before-stop', true).status, 1)
    writeFileSync(file, 'color\n')
    assert.equal(hook('after-edit').status, 0)
    assert.equal(hook('before-stop').status, 0)
  })
}
