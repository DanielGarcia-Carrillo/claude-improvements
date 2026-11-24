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
import { delimiter, join, resolve } from 'node:path'
import { after, test } from 'node:test'

import type { Stack } from '../scripts/compose.ts'
import { PLACEHOLDER, PLACEHOLDER_EXEMPT } from '../scripts/compose.ts'
import { answersFor as answersForStack } from './answers.ts'

const SCRIPT = resolve(import.meta.dirname, '../scripts/new-project.ts')
const BASELINES = resolve(import.meta.dirname, '../../../baselines')
const scratch = mkdtempSync(join(tmpdir(), 'new-project-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
// Git and tools such as typos must see fixture inputs independently of the
// developer's global excludes. This environment lives only in this test process.
const gitConfig = join(scratch, 'gitconfig')
writeFileSync(gitConfig, '')
process.env['GIT_CONFIG_GLOBAL'] = gitConfig
process.env['GIT_CONFIG_NOSYSTEM'] = '1'

const run = (command: string, args: readonly string[], cwd: string) =>
  spawnSync(command, args, { cwd, encoding: 'utf8' })

/** Swaps the composite action fixture's Bash test for one ShellCheck's options reject. */
const badTest = (text: string) => text.replace('[[ -e $TARGET ]]', '[ -e $TARGET ]')
const crlf = (text: string) => text.replaceAll('\n', '\r\n')

const answersFor = (stack: Stack) => answersForStack(stack, BASELINES)

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
  // Fixtures must not inherit global ignores such as .claude/.
  const excludes = join(target, '.git/test-excludes')
  writeFileSync(excludes, '')
  assert.equal(run('git', ['config', 'core.excludesFile', excludes], target).status, 0)
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
const realGit = run('sh', ['-c', 'command -v git'], scratch).stdout.trim()

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
  test(`${stack} shell checks cover hidden and extensionless files before the first commit`, () => {
    const repo = scaffold(stack, `${stack}-shell`)
    const check = (...args: string[]) => run('bash', ['scripts/check-shell.sh', ...args], repo)
    const clean = check()
    assert.equal(clean.status, 0, clean.stdout + clean.stderr)

    const hidden = '.claude/quality check'
    // Default ShellCheck would permit [, so this also checks the optional policy.
    writeFileSync(join(repo, hidden), '#!/usr/bin/env bash\n[ -e README.md ]\n')
    const bad = check()
    assert.equal(bad.status, 1, bad.stdout + bad.stderr)
    assert.match(bad.stdout, /SC2292/)
    writeFileSync(join(repo, hidden), '#!/usr/bin/env bash\n[[ -e README.md ]]\n')
    assert.equal(check().status, 0)

    writeFileSync(join(repo, 'scripts/-a b.sh'), '#!/usr/bin/env bash\nif true; then\necho ok\nfi\n')
    assert.equal(check('scripts/-a b.sh').status, 1)
    assert.equal(check('--fix', 'scripts/-a b.sh').status, 0)
    assert.equal(check().status, 0)
    assert.equal(check('README.md').status, 0, 'an explicit set with no shell inputs must not hang')
    const workflowPath = '.github/workflows/shell-test.yml'
    const workflow =
      'name: fixture\non: push\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: "[ -e README.md ]"\n'
    writeFileSync(join(repo, workflowPath), workflow)
    const workflowBad = check()
    assert.equal(workflowBad.status, 1)
    assert.match(workflowBad.stdout + workflowBad.stderr, /SC2292/)
    writeFileSync(join(repo, workflowPath), workflow.replace('[ -e README.md ]', '[[ -e README.md ]]'))
    assert.equal(check().status, 0)
    rmSync(join(repo, workflowPath))

    // actionlint reads only workflows, so composite actions go through a
    // generated one. Its expressions must not trip ShellCheck, and each step
    // keeps its own shell.
    const composites = stack === 'web' ? 1 : 0
    const actionPath = '.github/actions/shell-test/action.yml'
    const action = `name: fixture
description: A composite action fixture.
inputs:
  target:
    description: The file to look for.
    default: README.md
runs:
  using: composite
  steps:
    # A comment between the steps.
    - id: look
      name: Look for the target
      shell: bash
      env:
        TARGET: \${{ inputs.target }}
      run: |
        echo "Looking in \${{ github.action_path }}"
        [[ -e $TARGET ]]
    - shell: sh
      name: 'Look again in sh'
      run: test -e "\${{ inputs.target }}" && echo \${{ steps.look.outcome }}
`
    mkdirSync(join(repo, '.github/actions/shell-test'), { recursive: true })
    mkdirSync(join(repo, '.github/actions/javascript'), { recursive: true })
    writeFileSync(
      join(repo, '.github/actions/javascript/action.yml'),
      "name: fixture\ndescription: Not composite.\nruns:\n  using: 'node24'\n  main: index.js\n",
    )
    writeFileSync(join(repo, actionPath), action)
    const actionClean = check()
    assert.equal(actionClean.status, 0, actionClean.stdout + actionClean.stderr)
    assert.match(actionClean.stdout, new RegExp(`, ${composites + 1} composite actions\\.`))
    assert.match(check(actionPath).stdout, /, 1 composite actions\./)

    const broken = (from: string, to: string) => {
      writeFileSync(join(repo, actionPath), action.replace(from, to))
      const result = check(actionPath)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.doesNotMatch(result.stdout, /Shell quality passed/)
      // A failure must say where, not just exit.
      assert.match(result.stdout, /^\.\/\.github\/actions\/shell-test\/action\.yml:\d+:\d+: step \d/m)
      return result.stdout + result.stderr
    }
    assert.match(
      broken('[[ -e $TARGET ]]', '[ -e $TARGET ]'),
      /^\.\/\.github\/actions\/shell-test\/action\.yml:18:9: step 1 "Look for the target": .*SC2292/m,
    )
    assert.match(
      broken('run: test -e', 'run: test -e x && [[ -e x ]] && test -e'),
      /action\.yml:21:25: step 2 "Look again in sh": .*SC3010/,
      "a step's shell must decide the ShellCheck dialect",
    )
    assert.match(
      broken('inputs.target }}"', 'inputs.destination }}"'),
      /step 2 .*property "destination" is not defined/,
    )
    writeFileSync(join(repo, actionPath), action.replace(/ {2}steps:\n[^]*/, '  steps: []\n'))
    const empty = check(actionPath)
    assert.equal(empty.status, 2)
    assert.match(empty.stderr, /action\.yml: runs\.steps has no steps/)

    const checkAction = (text: string) => {
      writeFileSync(join(repo, actionPath), text)
      const result = check(actionPath)
      return { ...result, output: result.stdout + result.stderr }
    }
    // A step for another platform keeps its own shell: the generated job's
    // runner names no platform, so cmd and pwsh are valid there.
    const windows = action.replace(
      '    - shell: sh\n',
      "    - if: runner.os == 'Windows'\n      shell: cmd\n      run: if exist README.md echo found\n" +
        '    - shell: pwsh\n      run: Test-Path README.md\n    - shell: sh\n',
    )
    const windowsClean = checkAction(windows)
    assert.equal(windowsClean.status, 0, windowsClean.output)
    assert.match(windowsClean.stdout, /, 1 composite actions \(2 steps in other shells skipped by ShellCheck\)\./)
    const windowsBad = checkAction(badTest(windows))
    assert.equal(windowsBad.status, 1, windowsBad.output)
    assert.match(windowsBad.output, /action\.yml:18:9: step 1 .*SC2292/)
    // CRLF line endings must not turn the action into a skipped one.
    const crlfClean = checkAction(crlf(action))
    assert.equal(crlfClean.status, 0, crlfClean.output)
    assert.match(crlfClean.stdout, /, 1 composite actions\./)
    const crlfBad = checkAction(crlf(badTest(action)))
    assert.equal(crlfBad.status, 1, crlfBad.output)
    assert.match(crlfBad.output, /action\.yml:18:9: step 1 "Look for the target": .*SC2292/)
    // Quoted keys are still keys, and an entry that is not one fails.
    const quoted = action
      .replace('\nruns:', '\n"runs":')
      .replace('  using: composite', '  \'using\': "composite"')
      .replace('  steps:', '  "steps":')
      .replace('      name: Look for the target', '      "name": Look for the target')
    const quotedClean = checkAction(quoted)
    assert.equal(quotedClean.status, 0, quotedClean.output)
    assert.match(quotedClean.stdout, /, 1 composite actions\./)
    const quotedBad = checkAction(badTest(quoted))
    assert.equal(quotedBad.status, 1, quotedBad.output)
    assert.match(quotedBad.output, /action\.yml:18:9: step 1 "Look for the target": .*SC2292/)
    const unreadable = checkAction(`${action}[not, a, key]\n`)
    assert.equal(unreadable.status, 2, unreadable.output)
    assert.match(unreadable.stderr, /action\.yml: yq cannot read this YAML:\nError: .*action\.yml/)
    const noRuns = checkAction(action.replace(/\nruns:[^]*/, '\n'))
    assert.equal(noRuns.status, 2, noRuns.output)
    assert.match(noRuns.stderr, /cannot find runs in this action/)
    // Inputs written as a flow mapping are declared too, so only undeclared
    // names fail.
    const flowInputs = action.replace(
      /\ninputs:\n[^]*?\nruns:/,
      "\ninputs: {target: {description: 'The file, to look for', default: README.md},\n  other: {}}\nruns:",
    )
    const flowInputsClean = checkAction(flowInputs)
    assert.equal(flowInputsClean.status, 0, flowInputsClean.output)
    const flowInputsBad = checkAction(flowInputs.replace('inputs.target }}"', 'inputs.destination }}"'))
    assert.equal(flowInputsBad.status, 1, flowInputsBad.output)
    assert.match(
      flowInputsBad.output,
      /property "destination" is not defined in object type \{other: string; target: string\}/,
    )
    // A # inside a quoted value and a comment on a continuation line.
    const commentedInputs = checkAction(
      action.replace(
        /\ninputs:\n[^]*?\nruns:/,
        "\ninputs: {target: {description: 'The # file', default: README.md}, # note\n  other: {}}\nruns:",
      ),
    )
    assert.equal(commentedInputs.status, 0, commentedInputs.output)
    // A flow mapping on the line after inputs: is the inputs, not a key.
    const nextLineInputs = checkAction(
      action.replace(/\ninputs:\n[^]*?\nruns:/, '\ninputs:\n  {target: {default: README.md}}\nruns:'),
    )
    assert.equal(nextLineInputs.status, 0, nextLineInputs.output)
    // A value that is only a comment opens a block, at every level.
    const comments = checkAction(
      action
        .replace('\ninputs:\n', '\ninputs: # what to check\n')
        .replace('\nruns:\n', '\nruns: # how\n')
        .replace('  steps:\n', '  steps: # in order\n'),
    )
    assert.equal(comments.status, 0, comments.output)
    // A quoted scalar may continue at column 0.
    const continued = checkAction(
      action.replace('description: A composite action fixture.', 'description: "A composite\naction fixture."'),
    )
    assert.equal(continued.status, 0, continued.output)
    // The caller's matrix, the runner and env are not known here, so any of
    // their properties is accepted. Inputs stay strict, as tested above.
    const contexts = checkAction(
      action.replace(
        '    - shell: sh\n',
        "    - if: matrix.os == 'windows-latest' && runner.os == 'Windows' && env.CI == 'true'\n" +
          '      shell: bash\n      run: echo "${{ matrix.node }} ${{ env.CI }} ${{ runner.temp }}"\n    - shell: sh\n',
      ),
    )
    assert.equal(contexts.status, 0, contexts.output)
    // GitHub compares the runtime without case; an unknown one fails.
    const capitalized = checkAction(badTest(action).replace('using: composite', 'using: Composite'))
    assert.equal(capitalized.status, 1, capitalized.output)
    assert.match(capitalized.output, /action\.yml:18:9: step 1 "Look for the target": .*SC2292/)
    const typo = checkAction(action.replace('using: composite', 'using: compose'))
    assert.equal(typo.status, 2, typo.output)
    assert.match(typo.stderr, /action\.yml: runs\.using is 'compose', not composite, docker or a node runtime/)
    const docker = checkAction(action.replace('using: composite', 'using: docker\n  image: Dockerfile'))
    assert.equal(docker.status, 0, docker.output)
    assert.match(docker.stdout, /, 0 composite actions\./)
    // ShellCheck columns count from the block's own indentation, so an
    // indented script line keeps its place, with or without an indentation
    // indicator.
    const indented = '        if true; then\n          [ -e $TARGET ]\n        fi'
    assert.match(
      broken('        [[ -e $TARGET ]]', indented),
      /action\.yml:19:11: step 1 "Look for the target": .*SC2292:style:3:3:/,
    )
    writeFileSync(
      join(repo, actionPath),
      action.replace(
        '      run: |\n        echo "Looking in ${{ github.action_path }}"\n        [[ -e $TARGET ]]',
        '      run: |2\n          [ -e $TARGET ]',
      ),
    )
    const indicator = check(actionPath)
    assert.equal(indicator.status, 1, indicator.stdout + indicator.stderr)
    assert.match(indicator.stdout, /action\.yml:17:11: step 1 "Look for the target": .*SC2292:style:1:3:/)
    // An anchor outside runs.steps is resolved before the steps are read.
    const anchored = (script: string) =>
      action.replace('\nruns:', '\nx-common: &common\n  shell: bash\nruns:') +
      `    - <<: *common\n      name: Anchored\n      run: ${script}\n`
    const anchoredClean = checkAction(anchored('"[[ -e README.md ]]"'))
    assert.equal(anchoredClean.status, 0, anchoredClean.output)
    const anchoredBad = checkAction(anchored('"[ -e README.md ]"'))
    assert.equal(anchoredBad.status, 1, anchoredBad.output)
    assert.match(anchoredBad.output, /action\.yml:26:12: step 3 "Anchored": .*SC2292/)
    // GitHub rejects a composite run step without a shell.
    const noShell = checkAction(action.replace('      shell: bash\n', ''))
    assert.equal(noShell.status, 1, noShell.output)
    assert.match(
      noShell.output,
      /^\.\/\.github\/actions\/shell-test\/action\.yml:11:7: step 1 "Look for the target": a composite run step needs shell/m,
    )
    rmSync(join(repo, '.github/actions'), { recursive: true })

    const ignored = join(repo, 'ignored-shell')
    mkdirSync(ignored)
    writeFileSync(join(ignored, 'invalid.sh'), 'this is not shell syntax (\n')
    writeFileSync(join(repo, '.git/info/exclude'), 'ignored-shell/\n')
    assert.equal(check().status, 0, 'Git ignores must exclude unrelated files')
  })

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
    // Reject direct calls without removing shared PATH directories (for example jq's).
    const located = run('mise', ['which', 'typos'], resolve(BASELINES, '..'))
    assert.equal(located.status, 0, located.stderr)
    writeFileSync(join(bin, 'typos'), '#!/bin/sh\necho "Use mise exec for typos" >&2\nexit 98\n', { mode: 0o755 })
    writeFileSync(
      join(bin, 'mise'),
      `#!/bin/sh
[ "$1" = exec ] && [ "$2" = -- ] && [ "$3" = typos ] || exit 99
shift 3
exec "$PINNED_TYPOS" "$@"
`,
      { mode: 0o755 },
    )
    const nested = join(repo, 'nested')
    mkdirSync(nested)
    const file = join(repo, 'README.md')
    writeFileSync(file, ['col', 'our'].join('') + '\n')
    const hook = (name: string, retry = false, payloadCwd = nested) =>
      spawnSync('bash', [join(repo, `.claude/hooks/${name}.sh`)], {
        cwd: nested,
        input: JSON.stringify({ cwd: payloadCwd, tool_input: { file_path: file }, stop_hook_active: retry }),
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
          PINNED_TYPOS: located.stdout.trim(),
          REAL_GIT: realGit,
          CLAUDE_PROJECT_DIR: scratch,
        },
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
    const missing = hook('before-stop', false, join(repo, 'missing-checkout'))
    assert.equal(missing.status, 2)
    assert.match(missing.stderr, /Cannot enter the hook checkout/)
    assert.doesNotMatch(missing.stderr, /No such file or directory/)
    assert.equal(hook('before-stop', true, join(repo, 'missing-checkout')).status, 1)

    writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = status ]; then exit 128; fi\nexec "$REAL_GIT" "$@"\n', {
      mode: 0o755,
    })
    const failedStatus = hook('before-stop')
    assert.equal(failedStatus.status, 2, failedStatus.stderr)
    assert.match(failedStatus.stderr, /git status failed/)
    assert.equal(hook('before-stop', true).status, 1, 'an inspection failure must not block retries forever')
    if (stack === 'python') {
      writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = ls-files ]; then exit 128; fi\nexec "$REAL_GIT" "$@"\n', {
        mode: 0o755,
      })
      const failedListing = hook('before-stop')
      assert.equal(failedListing.status, 2, failedListing.stderr)
      assert.match(failedListing.stderr, /Cannot list Python projects/)
      assert.equal(hook('before-stop', true).status, 1)
    }
  })
}

test('shell discovery reports a failed Git listing instead of checking an empty set', () => {
  const repo = scaffold('python', 'shell-discovery-failure')
  const bin = join(scratch, 'shell-discovery-bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = ls-files ]; then exit 128; fi\nexec "$REAL_GIT" "$@"\n', {
    mode: 0o755,
  })
  const result = spawnSync('bash', ['scripts/check-shell.sh'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`, REAL_GIT: realGit },
  })
  assert.equal(result.status, 128)
  assert.doesNotMatch(result.stdout, /Shell quality passed/)
})

test('workflow checks fail when ShellCheck is missing instead of silently omitting inline shell', () => {
  const repo = scaffold('web', 'workflow-missing-shellcheck')
  const bin = join(scratch, 'workflow-tools-bin')
  mkdirSync(bin)
  symlinkSync(realGit, join(bin, 'git'))
  const result = spawnSync('/bin/bash', ['scripts/check-shell.sh', '.github/workflows/ci.yml'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing shellcheck/)
  assert.doesNotMatch(result.stdout, /Shell quality passed/)
})

test('composite action checks fail when actionlint is missing', () => {
  const repo = scaffold('web', 'action-missing-actionlint')
  const bin = join(scratch, 'action-tools-bin')
  mkdirSync(bin)
  symlinkSync(realGit, join(bin, 'git'))
  const shellcheck = run('mise', ['which', 'shellcheck'], resolve(BASELINES, '..'))
  assert.equal(shellcheck.status, 0, shellcheck.stderr)
  symlinkSync(shellcheck.stdout.trim(), join(bin, 'shellcheck'))
  const result = spawnSync('/bin/bash', ['scripts/check-shell.sh', '.github/actions/playwright/action.yml'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing actionlint/)
  assert.doesNotMatch(result.stdout, /Shell quality passed/)
})

test('composite action checks fail when yq is missing', () => {
  const repo = scaffold('web', 'action-missing-yq')
  const bin = join(scratch, 'action-yq-bin')
  mkdirSync(bin)
  symlinkSync(realGit, join(bin, 'git'))
  for (const tool of ['shellcheck', 'actionlint']) {
    const located = run('mise', ['which', tool], resolve(BASELINES, '..'))
    assert.equal(located.status, 0, located.stderr)
    symlinkSync(located.stdout.trim(), join(bin, tool))
  }
  const result = spawnSync('/bin/bash', ['scripts/check-shell.sh', '.github/actions/playwright/action.yml'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing yq/)
  assert.doesNotMatch(result.stdout, /Shell quality passed/)
  // The Python yq wrapper has the same name and another language.
  writeFileSync(join(bin, 'yq'), '#!/bin/sh\necho "yq 3.4.3"\n', { mode: 0o755 })
  const wrapper = spawnSync('/bin/bash', ['scripts/check-shell.sh', '.github/actions/playwright/action.yml'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: bin },
  })
  assert.equal(wrapper.status, 1)
  assert.match(wrapper.stderr, /yq is not mikefarah\/yq/)
  assert.doesNotMatch(wrapper.stdout, /Shell quality passed/)
})

test('setup installs Git hooks in every stack before verify, including --keep-versions', () => {
  const bin = join(scratch, 'setup-hooks-bin')
  mkdirSync(bin)
  const calls = join(scratch, 'setup-hooks-calls')
  writeFileSync(join(bin, 'mise'), `#!/bin/sh\necho "$*" >> '${calls}'\n`, { mode: 0o755 })
  for (const [stack, manifest] of [
    ['web', 'package.json'],
    ['rust', 'Cargo.toml'],
    ['python', 'pyproject.toml'],
  ] as const) {
    const repo = join(scratch, `setup-hooks-${stack}`)
    mkdirSync(repo)
    writeFileSync(join(repo, manifest), '')
    const result = spawnSync(process.execPath, [SCRIPT, 'setup', repo, '--keep-versions'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    })
    assert.equal(result.status, 0, result.stderr)
    const steps = readFileSync(calls, 'utf8').trim().split('\n')
    const install = steps.indexOf(stack === 'web' ? 'exec -- pnpm install' : 'exec -- just bootstrap')
    assert.ok(install > steps.indexOf('install'), `${stack}: hooks need installed tools`)
    assert.ok(install < steps.length - 1, `${stack}: hooks must be installed before verify`)
    rmSync(calls)
  }
})
