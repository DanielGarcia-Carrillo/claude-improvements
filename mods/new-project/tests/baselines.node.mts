/**
 * The scaffold over the real baselines, which the plugin test kit cannot
 * read (it offers no file system). Run it with Node, not `claude plugin test`:
 *
 *   node --test mods/new-project/tests/baselines.node.mts
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
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'

import type { Stack } from '../scripts/compose.ts'
import { kickoffFor, PLACEHOLDER, PLACEHOLDER_EXEMPT, parseKickoff } from '../scripts/compose.ts'

const SCRIPT = resolve(import.meta.dirname, '../scripts/new-project.ts')
const BASELINES = resolve(import.meta.dirname, '../../../baselines')
const scratch = mkdtempSync(join(tmpdir(), 'new-project-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

const run = (command: string, args: readonly string[], cwd: string) => spawnSync(command, args, { cwd, encoding: 'utf8' })

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
    kickoff: sections.flatMap(s => s.questions.map(question => ({ question, answer: 'Default', assumed: true }))),
    changed: [],
    architecture: [{ choice: 'Shape', line: 'The baseline as is' }],
    alternatives: [{ option: 'Nothing else', why: 'This is a test' }],
    consequences: 'None.',
    followUps: [],
  }
}

function scaffold(stack: Stack): string {
  const answers = join(scratch, `${stack}.json`)
  writeFileSync(answers, JSON.stringify(answersFor(stack)))
  const target = join(scratch, stack)
  const result = run('node', [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--baselines', BASELINES], scratch)
  assert.equal(result.status, 0, result.stderr)
  return target
}

/** What the template CI's "No template placeholders left" step finds, plus paths, which it does not read. */
function leftovers(repo: string): string {
  assert.equal(run('git', ['add', '-A'], repo).status, 0)
  const grep = run('git', ['grep', '-niE', 'replace[-_ ]?me([^a-z]|$)', '--', `:!${PLACEHOLDER_EXEMPT}`], repo)
  assert.notEqual(grep.status, 2, grep.stderr)
  const paths = run('git', ['ls-files'], repo).stdout.split('\n').filter(path => PLACEHOLDER.test(path))
  return [grep.stdout, ...paths].join('\n').trim()
}

const read = (repo: string, path: string) => readFileSync(join(repo, path), 'utf8')

/** A copy of the baselines to alter, without build output. */
function baselinesCopy(name: string): string {
  const copy = join(scratch, name)
  cpSync(BASELINES, copy, { recursive: true, filter: source => !/\/(node_modules|target|dist)(\/|$)/.test(source) })
  return copy
}

/** Scaffold's dry run of the web stack into `target`. */
function dryRun(target: string, baselines: string) {
  const answers = join(scratch, 'web.json')
  writeFileSync(answers, JSON.stringify(answersFor('web')))
  return run('node', [SCRIPT, 'scaffold', '--answers', answers, '--target', target, '--baselines', baselines, '--dry-run'], scratch)
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
    spawnSync(process.execPath, [SCRIPT, 'setup', repo, ...options], { encoding: 'utf8', env: { ...process.env, PATH: bin } })

  const inferred = setup()
  assert.equal(inferred.status, 1)
  assert.match(inferred.stderr, /holds both package\.json and Cargo\.toml; pass --stack rust or --stack web/)
  assert.ok(!existsSync(calls), 'setup ran mise before it knew the stack')

  // --keep-versions skips the toolchain bump, which would fetch the stable release.
  const rust = setup('--stack', 'rust', '--keep-versions')
  assert.equal(rust.status, 1)
  assert.match(rust.stderr, /`mise exec -- cargo generate-lockfile` failed/)
  assert.equal(read(scratch, 'mise-calls'), 'trust\ninstall\nexec -- cargo generate-lockfile\n')

  assert.match(setup('--stack', 'go').stderr, /--stack must be web or rust, not "go"/)
  rmSync(join(repo, 'package.json'))
  assert.match(setup('--stack', 'web').stderr, /--stack web needs package\.json/)
})
