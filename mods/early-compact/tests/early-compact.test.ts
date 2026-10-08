import type { On, SessionMessage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const note: SessionMessage = { role: 'user', text: 'summary', toolUses: [] }

type World = {
  percent: number
  tokens: number
  prompts: string[]
  compacts: string[]
  toasts: string[]
  statuses: (string | undefined)[]
  files: Map<string, string>
}

// Stands in for the engine beneath the plugin: context fill, the prompt it
// submits, the /compact it runs, and the lines it shows.
function world(engine: Engine, on: On): World {
  const w: World = { percent: 0, tokens: 0, prompts: [], compacts: [], toasts: [], statuses: [], files: new Map() }

  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, percent: w.percent, tokens: w.tokens },
      rateLimits: [],
    },
  }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', (_$, e) => {
    w.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    w.statuses.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    w.prompts.push(e.text)

    return { text: e.text }
  })
  on('command.run', { command: 'compact' }, async (_$, e) => {
    w.compacts.push(e.args)
    await engine.session.compact({ trigger: 'manual', instructions: e.args, messages: [note] })

    return { text: '' }
  })
  on('session.compact', () => ({ messages: [note], tokensBefore: 130_000, tokensAfter: 9_000 }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  return w
}

const answered = (turnId: string, answer = 'done') =>
  ({ turnId, answer, reason: 'answer', durationMs: 1, isAborted: false }) as const

test('respects the token floor and /early-compact off', async ($, on) => {
  const clock = mock.clock(on)
  const w = world($, on)
  const presentation = { isFullscreen: false, columns: 80 }
  const origin = { kind: 'composer' } as const

  w.percent = 65
  w.tokens = 30_000
  await $.turn.complete(answered('t1'))
  await clock.advance(10)
  expect(w.prompts).toEqual([])

  await $.command.run({ command: 'early-compact', args: 'off', origin, presentation })
  w.tokens = 130_000
  await $.turn.complete(answered('t2'))
  await clock.advance(10)
  expect(w.prompts).toEqual([])

  await $.command.run({ command: 'early-compact', args: 'on', origin, presentation })
  await $.turn.complete(answered('t3'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(1)

  const status = await $.command.run({ command: 'early-compact', args: '', origin, presentation })
  expect(status.text).toContain('at 60%')
  expect(status.text).toContain('checkpointing')
})

test('checkpoints, compacts with the checkpoint as the brief, then resumes', async ($, on) => {
  const clock = mock.clock(on)
  const w = world($, on)

  w.percent = 40
  w.tokens = 80_000
  await $.turn.complete(answered('t1'))
  await clock.advance(10)
  expect(w.prompts).toEqual([])

  w.percent = 65
  w.tokens = 130_000
  await $.turn.complete(answered('t2'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('checkpoint')

  // A turn that is not the checkpoint's does not compact or trigger again.
  await $.turn.start({ text: 'unrelated', turnId: 't3' })
  await $.turn.complete(answered('t3'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(1)
  expect(w.compacts).toEqual([])

  await $.turn.start({ text: w.prompts[0] ?? '', turnId: 't4' })
  await $.turn.complete(answered('t4', '**Goal**: ship PER-7'))
  await clock.advance(10)
  expect(w.compacts.length).toBe(1)
  const saved = '/repo/.claude/early-compact/sess-1/checkpoint-1.md'
  expect(w.files.get(saved)).toContain('**Goal**: ship PER-7')
  expect(w.files.get('/repo/.claude/early-compact/.gitignore')).toBe('*\n')
  expect(w.compacts[0]).toContain('**Goal**: ship PER-7')
  expect(w.compacts[0]).toContain(saved)
  expect(w.toasts.at(-1)).toContain('130,000')
  expect(w.statuses.at(-1)).toBeUndefined()

  // The session carries on by itself.
  expect(w.prompts.length).toBe(2)
  expect(w.prompts[1]).toContain('compacted early')
  expect(w.prompts[1]).toContain(saved)

  // A fresh window: the watch starts over.
  w.percent = 20
  await $.turn.complete(answered('t5'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(2)
})

test('a prompt sent while compacting replaces the resume', async ($, on) => {
  const clock = mock.clock(on)
  const w = world($, on)
  w.percent = 65
  w.tokens = 130_000

  await $.turn.complete(answered('t1'))
  await clock.advance(10)
  await $.turn.start({ text: w.prompts[0] ?? '', turnId: 't2' })
  await $.turn.complete(answered('t2', '**Goal**: ship PER-7'))
  await $.prompt.submit({ text: 'actually, do Y', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(w.compacts.length).toBe(1)
  expect(w.prompts.at(-1)).toBe('actually, do Y')
  expect(w.prompts.some(text => text.includes('compacted early'))).toBe(false)
})

test('an interrupted checkpoint snoozes for ten points', async ($, on) => {
  const clock = mock.clock(on)
  const w = world($, on)
  w.percent = 62
  w.tokens = 120_000

  await $.turn.complete(answered('t1'))
  await clock.advance(10)
  await $.turn.start({ text: w.prompts[0] ?? '', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', answer: '', reason: 'aborted', durationMs: 1, isAborted: true })
  await clock.advance(10)
  expect(w.compacts).toEqual([])
  expect(w.toasts.at(-1)).toContain('72%')

  w.percent = 68
  await $.turn.complete(answered('t3'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(1)

  w.percent = 73
  await $.turn.complete(answered('t4'))
  await clock.advance(10)
  expect(w.prompts.length).toBe(2)
})
