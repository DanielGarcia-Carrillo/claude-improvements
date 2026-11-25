/**
 * Fixture kickoff answers for scaffolding a stack from the real baselines,
 * shared by the scaffold tests and the scaffold verify. They take every
 * default, with names that test the escaping.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Stack } from '../scripts/compose.ts'
import { kickoffFor, parseKickoff } from '../scripts/compose.ts'

/** Answers that take every default for `stack`, read against the kickoff in `baselines`. */
export function answersFor(stack: Stack, baselines: string) {
  const sections = kickoffFor(parseKickoff(readFileSync(join(baselines, 'general/kickoff.md'), 'utf8')), stack)
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
