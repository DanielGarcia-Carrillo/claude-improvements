import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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
  expect(other.text).toBe('Commit it.')
  expect(elsewhere.text).toBe(SKILL_BODY)
  expect(asked).toEqual([])
})
