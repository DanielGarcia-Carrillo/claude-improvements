import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Answers } from '../scripts/compose.ts'
import {
  AnswersError,
  kickoffFor,
  missingKickoff,
  parseAnswers,
  parseKickoff,
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
