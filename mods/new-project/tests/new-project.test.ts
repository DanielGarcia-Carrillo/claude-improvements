import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Answers, Step } from '../scripts/compose.ts'
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
  rustStableVersion,
  STACKS,
  tsString,
  unknownAreas,
} from '../scripts/compose.ts'

const SKILL_BODY = '# Bootstrap a new project'

// Stands in for the engine beneath the hook: a file system that holds the
// baselines only at `disk.baselinesAt`, and the skill's own expansion.
function engine(on: On) {
  const disk = { baselinesAt: '', asked: [] as string[] }
  on('fs.exists', (_$, e) => {
    disk.asked.push(e.path)
    return { value: e.path === `${disk.baselinesAt}/general/kickoff.md` }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/Users/someone' : undefined }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  return disk
}

test('names the baselines folder beside the mod', async ($, on) => {
  const disk = engine(on)
  await $.skill.prompt({ skill: 'new-project', text: SKILL_BODY })
  const dir = (disk.asked[0] ?? '').replace(/\/general\/kickoff\.md$/, '')
  expect(dir.endsWith('/baselines')).toBe(true)
  expect(dir.includes('..')).toBe(false)

  disk.baselinesAt = dir
  const result = await $.skill.prompt({ skill: 'new-project:new-project', text: SKILL_BODY })
  expect(result.text).toBe(`Baselines folder: ${dir}\n\n${SKILL_BODY}`)
})

test(
  'the baselines option wins, with ~ expanded',
  { options: { baselines: '~/src/claude-improvements/baselines' } },
  async ($, on) => {
    engine(on).baselinesAt = '/Users/someone/src/claude-improvements/baselines'
    const result = await $.skill.prompt({ skill: 'new-project', text: SKILL_BODY })
    expect(result.text.startsWith('Baselines folder: /Users/someone/src/claude-improvements/baselines\n')).toBe(true)
  },
)

test('a relative baselines option is refused', { options: { baselines: 'src/baselines' } }, async ($, on) => {
  const disk = engine(on)
  disk.baselinesAt = 'src/baselines'
  const result = await $.skill.prompt({ skill: 'new-project', text: SKILL_BODY })
  expect(result.text).toContain('cannot find the project baselines')
  expect(result.text).toContain('must be absolute')
  expect(disk.asked).toEqual([])
})

test('missing baselines replace the skill with how to fix it', { options: { baselines: '/nowhere' } }, async ($, on) => {
  engine(on)
  const result = await $.skill.prompt({ skill: 'new-project', text: SKILL_BODY })
  expect(result.text).toContain('cannot find the project baselines')
  expect(result.text).toContain('`baselines` option')
  expect(result.text).toContain('/nowhere')
  expect(result.text.includes(SKILL_BODY)).toBe(false)
})

test("leaves other skills, and another plugin's new-project, alone", async ($, on) => {
  const { asked } = engine(on)
  const other = await $.skill.prompt({ skill: 'commit', text: 'Commit it.' })
  const elsewhere = await $.skill.prompt({
    skill: 'new-project',
    text: SKILL_BODY,
    path: '/elsewhere/skills/new-project/SKILL.md',
  })
  // Another plugin's skill with no file path, such as an inline command.
  const namesake = await $.skill.prompt({ skill: 'other:new-project', text: SKILL_BODY })
  expect(other.text).toBe('Commit it.')
  expect(elsewhere.text).toBe(SKILL_BODY)
  expect(namesake.text).toBe(SKILL_BODY)
  expect(asked).toEqual([])
})

const KICKOFF = `# Kickoff questions

## Every project

| Question | Decides |
|---|---|
| What is it, in one sentence, and who uses it? | README opening |
| Public or private repo? | CI minutes |

## Web apps

| Question | Decides |
|---|---|
| Does it need to work offline? | Service worker strategy |

## Rust tools

| Question | Decides |
|---|---|
| CLI, library, or both? | Workspace shape |

## After the answers

1. Pick the baseline.
`

const README = `# Web baseline

## The stack

| Area | Default | Why | Instead, when |
|---|---|---|---|
| Styling | StyleX | Build-time atomic CSS | vanilla-extract |
| Hosting | Cloudflare Workers static assets | Free static hosting | See [infra.md](../general/infra.md) |
`

function webAnswers(overrides: Record<string, unknown> = {}): Answers {
  return parseAnswers({
    stack: 'web',
    name: "Dan's Trips",
    slug: 'dans-trips',
    description: 'Plans trips offline.',
    summary: 'Plans trips offline for travellers.',
    issues: 'GitHub Issues',
    merging: 'Daniel merges',
    kickoff: [
      { question: 'What is it, in one sentence, and who uses it?', answer: 'A trip planner' },
      { question: 'public or private   repo?', answer: 'Private', assumed: true },
      { question: 'Does it need to work offline?', answer: 'Yes' },
    ],
    architecture: [{ choice: 'Styling', line: 'StyleX' }],
    alternatives: [{ option: 'SSR', why: 'No SEO' }],
    consequences: 'Nothing to host.',
    ...overrides,
  })
}

function problemsOf(raw: unknown): readonly string[] {
  try {
    parseAnswers(raw)
  } catch (error) {
    if (error instanceof AnswersError) return error.problems
    throw error
  }
  return []
}

test('reports every answer problem at once', async () => {
  const problems = problemsOf({ stack: 'rust', name: 'Fn', slug: 'fn', kickoff: [] })
  expect(problems.some(p => p.includes('Rust keyword'))).toBe(true)
  expect(problems.some(p => p.startsWith('`repository`'))).toBe(true)
  expect(problems.some(p => p.startsWith('`summary`'))).toBe(true)
  expect(problems.some(p => p.startsWith('`kickoff`'))).toBe(true)
  expect(problemsOf({ ...webAnswers(), slug: 'Trip_Planner' }).some(p => p.startsWith('`slug`'))).toBe(true)
  expect(problemsOf({ ...webAnswers(), name: 'A <b>' }).some(p => p.startsWith('`name`'))).toBe(true)
  // A carriage return would break the generated TypeScript string literal.
  expect(problemsOf({ ...webAnswers(), name: 'A\rB' }).some(p => p.startsWith('`name`'))).toBe(true)
  expect(problemsOf({ ...webAnswers(), description: 'One\rtwo.' }).some(p => p.startsWith('`description`'))).toBe(true)
  // A quote or backslash would break Cargo.toml's quoted `repository`.
  for (const repository of ['https://github.com/o/r"bad', 'https://github.com/o/r\\x'])
    expect(problemsOf({ ...webAnswers(), repository }).some(p => p.startsWith('`repository`'))).toBe(true)
  // URL characters that spell no URL with a host.
  for (const repository of ['https://?', 'https://'])
    expect(problemsOf({ ...webAnswers(), repository }).some(p => p.startsWith('`repository`'))).toBe(true)
  expect(problemsOf({ ...webAnswers(), repository: 'https://github.com/owner/name' })).toEqual([])
  expect(problemsOf(webAnswers())).toEqual([])
})

test('every kickoff question of the stack needs an answer', async () => {
  const sections = kickoffFor(parseKickoff(KICKOFF), 'web')
  expect(sections.map(s => s.title)).toEqual(['Every project', 'Web apps'])
  expect(missingKickoff(webAnswers(), sections)).toEqual([])

  const short = webAnswers({ kickoff: [{ question: 'Public or private repo?', answer: 'Public' }] })
  const missing = missingKickoff(short, sections)
  expect(missing.length).toBe(2)
  expect(missing[0]).toContain('"What is it, in one sentence, and who uses it?" (Every project)')
})

test('string literals take the quote oxfmt would', async () => {
  expect(tsString('Trips')).toBe("'Trips'")
  expect(tsString("Dan's Trips")).toBe(`"Dan's Trips"`)
  expect(tsString(`Dan's "best"`)).toBe(`'Dan\\'s "best"'`)
  expect(tsString(`Dan's trip's "pick"`)).toBe(`'Dan\\'s trip\\'s "pick"'`)
  expect(tsString(`Dan's trip's "pick`)).toBe(`"Dan's trip's \\"pick"`)
})

test('renames the web placeholders for each kind of file', async () => {
  const answers = webAnswers({ name: 'Trips & Tours', shortName: 'Trips', description: 'Plans "real" trips.' })
  const rename = (path: string, text: string) => renameFile({ path, text }, answers).text

  expect(
    rename(
      'vite.config.ts',
      "name: 'Replace Me',\nshort_name: 'ReplaceMe',\ndescription: 'Replace me: a one-line description',",
    ),
  ).toBe(`name: 'Trips & Tours',\nshort_name: 'Trips',\ndescription: 'Plans "real" trips.',`)
  expect(rename('src/routes/index.tsx', '<h1>Replace Me</h1>')).toBe('<h1>Trips &amp; Tours</h1>')
  expect(
    rename(
      'index.html',
      '<meta name="description" content="Replace me: a one-line description" />\n<title>Replace Me</title>',
    ),
  ).toBe('<meta name="description" content="Plans &quot;real&quot; trips." />\n<title>Trips &amp; Tours</title>')
  expect(rename('package.json', '{ "name": "replace-me" }')).toBe('{ "name": "dans-trips" }')
  expect(rename('wrangler.jsonc', '{ "name": "replace-me" }')).toBe('{ "name": "dans-trips" }')
  expect(rename('tests/e2e/app.spec.ts', "toHaveText('Replace Me')")).toBe("toHaveText('Trips & Tours')")
  // Without a short name, a long display name gives its first word.
  const long = webAnswers({ name: 'Weekend Trip Planner' })
  expect(renameFile({ path: 'vite.config.ts', text: "short_name: 'ReplaceMe'," }, long).text).toBe(
    "short_name: 'Weekend',",
  )
})

test('renames the Rust crates, folders and identifiers', async () => {
  const answers = parseAnswers({
    ...webAnswers(),
    stack: 'rust',
    slug: 'line-width',
    repository: 'https://github.com/someone/line-width',
  })

  const cli = renameFile(
    {
      path: 'crates/replace-me/tests/cli.rs',
      text: 'fn replace_me() -> Command {\n    get_cargo_bin("replace-me")\n}\nreplace_me().args([])',
    },
    answers,
  )
  expect(cli.path).toBe('crates/line-width/tests/cli.rs')
  expect(cli.text).toBe('fn line_width() -> Command {\n    get_cargo_bin("line-width")\n}\nline_width().args([])')

  const core = renameFile({ path: 'crates/replace-me-core/src/lib.rs', text: 'use replace_me_core::check;' }, answers)
  expect(core).toEqual({ path: 'crates/line-width-core/src/lib.rs', text: 'use line_width_core::check;' })

  const snapshot = renameFile(
    { path: 'crates/replace-me/tests/snapshots/cli__findings.snap', text: 'source: crates/replace-me/tests/cli.rs' },
    answers,
  )
  expect(snapshot).toEqual({
    path: 'crates/line-width/tests/snapshots/cli__findings.snap',
    text: 'source: crates/line-width/tests/cli.rs',
  })

  const manifest = renameFile(
    {
      path: 'Cargo.toml',
      text: 'repository = "https://github.com/replace-me-owner/replace-me"\nreplace-me-core = { path = "crates/replace-me-core" }',
    },
    answers,
  )
  expect(manifest.text).toBe(
    'repository = "https://github.com/someone/line-width"\nline-width-core = { path = "crates/line-width-core" }',
  )
  expect(leftoverPlaceholders([cli, core, snapshot, manifest])).toEqual([])
})

test('answers holding $ patterns land as written', async () => {
  // A replacement string would turn these into `$`, the match, or the text before or after it.
  const name = "Save $$ $& $` $'"
  const description = "Costs $$, $& or $` and $' at most."
  const web = webAnswers({ name, shortName: "$' $$", description })
  const vite = renameFile(
    {
      path: 'vite.config.ts',
      text: "name: 'Replace Me',\nshort_name: 'ReplaceMe',\ndescription: 'Replace me: a one-line description',",
    },
    web,
  )
  // Each holds a single quote, so takes double quotes.
  expect(vite.text).toBe(`name: "${name}",\nshort_name: "$' $$",\ndescription: "${description}",`)
  const html = renameFile(
    {
      path: 'index.html',
      text: '<meta name="description" content="Replace me: a one-line description" />\n<title>Replace Me</title>',
    },
    web,
  )
  expect(html.text).toBe(
    "<meta name=\"description\" content=\"Costs $$, $&amp; or $` and $' at most.\" />\n<title>Save $$ $&amp; $` $'</title>",
  )
  expect(leftoverPlaceholders([vite, html])).toEqual([])

  for (const repository of ['https://example.com/r/$$-tool', 'https://example.com/r/$&-tool', "https://example.com/r/$'-tool"]) {
    const rust = parseAnswers({ ...webAnswers(), stack: 'rust', slug: 'line-width', repository })
    const manifest = renameFile(
      { path: 'Cargo.toml', text: 'repository = "https://github.com/replace-me-owner/replace-me"\nname = "replace-me"' },
      rust,
    )
    expect(manifest.text).toBe(`repository = "${repository}"\nname = "line-width"`)
    expect(leftoverPlaceholders([manifest])).toEqual([])
  }
})

test('flags every spelling of the placeholder that no rename covers', async () => {
  const answers = webAnswers()
  const files = [
    renameFile({ path: 'docs/notes.md', text: 'Welcome.\nWelcome to Replace Me.' }, answers),
    { path: 'src/replace_me.ts', text: 'export const replaceMe = 1' },
    // The comment on the CI step that looks for placeholders spells one; only that line is exempt.
    {
      path: '.github/workflows/ci.yml',
      text: `# Template placeholders all spell "replace me"; fail until they're filled.\nrun: git grep -niE 'replace[-_ ]?me([^a-z]|$)'\nrun: cargo build -p replace-me`,
    },
    // Neither "replacement" nor "replace memory" is a placeholder.
    { path: 'README.md', text: 'The replacement. Replace memory.' },
  ]
  expect(leftoverPlaceholders(files)).toEqual([
    'docs/notes.md:2 still holds a template placeholder: Welcome to Replace Me. (teach renameFile in compose.ts this use)',
    'src/replace_me.ts: the path still holds a template placeholder; teach renameFile in compose.ts this use.',
    'src/replace_me.ts:1 still holds a template placeholder: export const replaceMe = 1 (teach renameFile in compose.ts this use)',
    '.github/workflows/ci.yml:3 still holds a template placeholder: run: cargo build -p replace-me (teach renameFile in compose.ts this use)',
  ])
})

test("refuses answers the new repo's placeholder check would fail on", async () => {
  const problems = problemsOf({
    ...webAnswers(),
    name: 'Replace Me Later',
    followUps: ['Replace-me tokens in docs'],
    kickoff: [{ question: 'Public or private repo?', answer: 'replace_me' }],
  })
  expect(problems).toEqual([
    '`name` "Replace Me Later" reads as a template placeholder to the new repo\'s CI; reword it.',
    '`kickoff[0].answer` "replace_me" reads as a template placeholder to the new repo\'s CI; reword it.',
    '`followUps[0]` "Replace-me tokens in docs" reads as a template placeholder to the new repo\'s CI; reword it.',
  ])
})

test('pins Rust to the current stable and reports what a bump changed', async () => {
  const manifest = '[pkg.cargo]\nversion = "0.100.0 (abc 2026-10-13)"\n\n[pkg.rust]\nversion = "1.100.2 (58cf8f9c3 2026-10-13)"\n'
  expect(rustStableVersion(manifest)).toBe('1.100.2')
  expect(() => rustStableVersion('[pkg.cargo]\nversion = "1"')).toThrow('no [pkg.rust] version')

  const toolchain = '[toolchain]\nchannel = "1.99.1"\ncomponents = ["rustfmt", "clippy"]\n'
  const cargo = '[workspace.package]\nedition = "2024"\nrust-version = "1.99"\n'
  const pinned = pinRust({ toolchain, cargo }, '1.100.2')
  expect(pinned.toolchain).toBe('[toolchain]\nchannel = "1.100.2"\ncomponents = ["rustfmt", "clippy"]\n')
  expect(pinned.cargo).toBe('[workspace.package]\nedition = "2024"\nrust-version = "1.100"\n')
  // An MSRV behind the channel was chosen, as a published library's is, so it stays.
  const library = cargo.replace('"1.99"', '"1.96"')
  const kept = pinRust({ toolchain, cargo: library }, '1.100.2')
  expect(kept.toolchain).toBe(pinned.toolchain)
  expect(kept.cargo).toBe(library)
  expect(() => pinRust({ toolchain: '[toolchain]\n', cargo }, '1.100.2')).toThrow('no `channel = "…"` line')
  expect(() => pinRust({ toolchain, cargo: '[workspace.package]\n' }, '1.100.2')).toThrow('no `rust-version = "…"` line')

  expect(changedLines(cargo, pinned.cargo)).toEqual(['- rust-version = "1.99"', '+ rust-version = "1.100"'])
  expect(changedLines(cargo, cargo)).toEqual([])
})

test("bumps mise.toml's pins at their own precision, and nothing else", async () => {
  const toml = [
    '# Tools.',
    '[tools]',
    'node = "26" # LTS',
    '"aqua:nextest-rs/nextest/cargo-nextest" = "0.9.148"',
    'rust = "stable"',
    '',
    '[settings]',
    'jobs = "4"',
  ].join('\n')
  expect(misePins(toml)).toEqual([
    { tool: 'node', version: '26' },
    { tool: 'aqua:nextest-rs/nextest/cargo-nextest', version: '0.9.148' },
  ])
  const bumped = bumpMiseToml(toml, { node: '28.1.0', 'aqua:nextest-rs/nextest/cargo-nextest': '0.10.2', jobs: '9' })
  expect(bumped).toBe(toml.replace('"26"', '"28"').replace('"0.9.148"', '"0.10.2"'))
  expect(bumpMiseToml(toml, {})).toBe(toml)
})

test('setup takes majors only in the steps marked so', async () => {
  const label = (step: Step) => ('run' in step ? step.run.join(' ') : step.bump)
  for (const stack of ['web', 'rust'] as const) {
    const steps: readonly Step[] = STACKS[stack].steps
    const majors = steps.filter(step => step.isMajor === true).map(label)
    const kept = steps.filter(step => step.isMajor !== true).map(label)
    expect(majors.length).toBe(2)
    expect(kept[0]).toBe('mise trust')
    expect(kept.at(-1)?.endsWith(STACKS[stack].verify)).toBe(true)
    // `mise up` reaches the global config's tools and uninstalls old versions.
    expect(steps.map(label).some(step => step.startsWith('mise up'))).toBe(false)
  }
  const web = (STACKS.web.steps as readonly Step[]).map(label)
  // Each pair must be present, in this order.
  const order = (...picks: ((step: string) => boolean)[]) => web.filter(step => picks.some(pick => pick(step)))
  expect(order(s => s === 'mise-tools', s => s === 'mise exec -- pnpm install')).toEqual([
    'mise-tools',
    'mise exec -- pnpm install',
  ])
  // Browsers come after the majors, so they match the Playwright that stays.
  expect(order(s => s === 'mise exec -- pnpm up --latest', s => s.includes('playwright install'))).toEqual([
    'mise exec -- pnpm up --latest',
    'mise exec -- pnpm exec playwright install chromium webkit',
  ])
})

const TEMPLATE = `<!--
Skeleton instructions.
-->

# <Project name>

<One paragraph: what it is, who it is for, the one thing it must do well.>

## Commands

<!-- stack fragment: Commands -->

\`<verify command>\` is the gate.

- **Issues** live in <Linear team "X", project "Y" | GitHub Issues>.
- **Branches**: \`<track>/per-<n>-<slug>\`.
- Open as draft. <Who may push, mark ready and merge.>

## Architecture

<!-- One line per key choice, each linking its ADR. -->

- <Choice>: <one line>. [ADR 0001](docs/adr/0001-stack.md)

## Traps

<!-- stack fragment: Traps -->
`

const FRAGMENT = `<!--
Fragment instructions.
-->

## Commands

\`\`\`bash
pnpm verify   # the gate
\`\`\`

## Traps

- **A trap.** Avoid it.
`

test('builds CLAUDE.md from the skeleton and the stack fragment', async () => {
  const text = composeAgentFile(TEMPLATE, FRAGMENT, webAnswers())
  expect(text.startsWith("# Dan's Trips\n\nPlans trips offline for travellers.\n")).toBe(true)
  expect(text).toContain('```bash\npnpm verify   # the gate\n```\n\n`pnpm verify` is the gate.')
  expect(text).toContain('- **Issues** live in GitHub Issues.')
  expect(text).toContain('Open as draft. Daniel merges.')
  expect(text).toContain('- Styling: StyleX. [ADR 0001](docs/adr/0001-stack.md)')
  expect(text).toContain('<!-- One line per key choice, each linking its ADR. -->')
  expect(text.endsWith('- **A trap.** Avoid it.\n')).toBe(true)
  expect(text.includes('Skeleton instructions')).toBe(false)
  expect(text.includes('Fragment instructions')).toBe(false)
})

test('a skeleton or fragment that drifted fails loudly', async () => {
  const noTraps = FRAGMENT.replace(/## Traps[\s\S]*$/, '')
  expect(() => composeAgentFile(TEMPLATE, noTraps, webAnswers())).toThrow('no "## Traps" section')
  expect(() => composeAgentFile(TEMPLATE, `${FRAGMENT}\n## Commands\n\nMore.\n`, webAnswers())).toThrow(
    'two "## Commands" sections',
  )
  expect(() => composeAgentFile(`${TEMPLATE}\n<New placeholder>\n`, FRAGMENT, webAnswers())).toThrow('<New placeholder>')
  expect(() => composeAgentFile(TEMPLATE.replace('<Project name>', 'X'), FRAGMENT, webAnswers())).toThrow(
    'no longer holds <Project name>',
  )
})

test('the ADR records the answers and each default kept or changed', async () => {
  const defaults = parseDefaults(README)
  expect(defaults[1]?.why).toBe('Free static hosting')

  const answers = webAnswers({ changed: [{ area: 'Styling', to: 'vanilla-extract', why: 'Semantic class names' }] })
  expect(unknownAreas(answers, defaults)).toEqual([])
  expect(unknownAreas(webAnswers({ changed: [{ area: 'Style', to: 'x', why: 'y' }] }), defaults)[0]).toContain(
    'not one of: Styling, Hosting',
  )

  const adr = renderAdr(answers, {
    date: '2026-10-20',
    kickoff: kickoffFor(parseKickoff(KICKOFF), 'web'),
    defaults,
    baseline: { sha: 'e12caf4', isDirty: false },
  })
  expect(adr).toContain('- Date: 2026-10-20')
  expect(adr).toContain('| Public or private repo? | Private (assumed) |')
  expect(adr).toContain('(`baselines/web` at `e12caf4`)')
  expect(adr).toContain('| Styling | StyleX | Build-time atomic CSS | Changed: vanilla-extract. Semantic class names. |')
  expect(adr).toContain('| Hosting | Cloudflare Workers static assets | Free static hosting | Kept |')
  expect(adr).toContain('- **SSR**: No SEO.')
})
