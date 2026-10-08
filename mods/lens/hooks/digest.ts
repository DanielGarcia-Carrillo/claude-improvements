import type { Bucket, Digest, Purpose, Turn } from '../types'
import type { Hue } from './heading'

export const PURPOSES: { id: Purpose; label: string; hotkey: string }[] = [
  { id: 'all', label: 'all', hotkey: 'a' },
  { id: 'progress', label: 'in progress', hotkey: '1' },
  { id: 'blocked', label: 'needs you', hotkey: '2' },
  { id: 'done', label: 'done', hotkey: '3' },
]

export const BUCKETS: { id: Bucket; label: string; mark: string; hue: Hue; empty: string }[] = [
  { id: 'progress', label: 'In progress', mark: '◐', hue: 'blue', empty: 'nothing in progress' },
  { id: 'blocked', label: 'Needs you', mark: '✋', hue: 'amber', empty: 'nothing waiting on you' },
  { id: 'done', label: 'Done', mark: '✓', hue: 'green', empty: 'nothing finished' },
]

// Who every digest is written for: someone following along, not doing the work.
const READER =
  'someone following the work who wants to know where it stands: what is underway, what needs their input, and what got finished'

// Keeps the head and the tail: an answer's asks of the person usually close it.
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max * 0.6)}\n…[middle cut]…\n${text.slice(-max * 0.4)}` : text

const SYSTEM =
  `You sort an AI coding assistant's work for one reader: ${READER}. ` +
  'Use only facts present in the material; never invent progress, asks or results.'

const FORMAT =
  'Reply with JSON only, no code fence: {"headline": string, "progress": string[], "blocked": string[], "done": string[]}\n' +
  '- headline: at most 15 words, what this means for the reader.\n' +
  '- progress: work started but not finished, or next steps the assistant said it would take.\n' +
  '- blocked: anything waiting on the user: questions asked, choices offered, approvals or actions requested.\n' +
  '- done: things completed: changes made, checks run, questions answered.\n' +
  'Each item at most 15 words, written for this reader, most important first; at most 5 per list. ' +
  'Leave out what this reader would not care about; empty lists are fine.'

export function turnRequest(turn: Turn, context: string[]) {
  const before = context.length ? `Earlier in the session (oldest first):\n${context.map(c => `- ${c}`).join('\n')}\n\n` : ''
  const files = turn.files.length ? `Files touched: ${turn.files.join(', ')}\n` : ''

  return {
    system: SYSTEM,
    maxTokens: 700,
    prompt:
      `${before}The user asked:\n<ask>\n${clip(turn.prompt, 4000)}\n</ask>\n\n` +
      `${files}Tool calls: ${turn.tools}\n\n` +
      `The assistant answered:\n<answer>\n${clip(turn.answer, 12000)}\n</answer>\n\n` +
      `Sort this one turn. "done" is only what this turn completed.\n${FORMAT}`,
  }
}

export function overviewRequest(turns: Turn[]) {
  const lines = turns.map((t, i) => `${i + 1}. Asked: ${clip(t.prompt, 300)}\n   Answered: ${clip(t.answer, 900)}`)

  return {
    system: SYSTEM,
    maxTokens: 700,
    prompt:
      `The session so far, turn by turn:\n${lines.join('\n')}\n\n` +
      'Sort where the session stands now. "progress" and "blocked" are what is still open after the latest turn: ' +
      `drop anything a later turn finished or the user answered. "done" is what was finished across the session.\n${FORMAT}`,
  }
}

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 5) : []

export function parseDigest(text: string): Digest | undefined {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const raw = JSON.parse(body) as Record<string, unknown>
    if (typeof raw.headline !== 'string') return undefined

    return { headline: raw.headline.trim(), progress: strings(raw.progress), blocked: strings(raw.blocked), done: strings(raw.done) }
  } catch {
    return undefined
  }
}

export const titleOf = (turn: Turn) => {
  const line = turn.prompt.split('\n').find(l => l.trim()) ?? '(no prompt)'

  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
