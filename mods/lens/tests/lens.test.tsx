import type { On, SessionMessage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { turnContaining } from '../hooks/match'
import { timeOf } from '../hooks/time'
import { parseDigest } from '../hooks/digest'

// Stand in for the engine beneath the plugin: a turn starts and ends, a pane opens,
// the transcript holds what the test puts in it, a message draws as its text, and
// the clock stands still until the test moves it.
const engine = (on: On, transcript: SessionMessage[] = [], now = 0) => {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.messages', () => ({ value: transcript }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{e.props.text}</Text>
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  return mock.clock(on, { now })
}

// The model: a digest naming the ask, so a test can tell turns apart.
const model = (on: On, lists: { progress?: string[]; blocked?: string[]; done?: string[] } = {}) => {
  const asked: string[] = []
  on('model.complete', ($, e) => {
    asked.push(e.prompt)
    const ask = /<ask>\n(.*)\n/.exec(e.prompt)?.[1] ?? 'session'
    const text = JSON.stringify({ headline: `Lens headline for ${ask}`, progress: [], blocked: [], done: [], ...lists })

    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  return asked
}

const PANE = {
  plugin: 'lens',
  component: 'Pane',
  requestId: 'lens',
  props: { title: 'Lens', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const answerTurn = async ($: Engine, id: string, ask: string, answer: string) => {
  await $.turn.start({ text: ask, turnId: id })
  await $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId: id, reason: 'answer' })
}

// Text as drawn: a Text or Markdown, or a heading the desktop draws as an Svg (by its alt).
type Drawing = { find: (q: { text: RegExp }) => Promise<unknown>; findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }
const shows = async (ui: Drawing, text: RegExp) =>
  (await ui.find({ text })) !== undefined || (await ui.findAll({ type: 'Svg' })).some(svg => text.test(String(svg.props.alt)))

const lens = ($: Engine, args: string) => $.command.run({ ...RUN, command: 'lens', args })

test('shows the latest turn and the session in the pane', async ($, on) => {
  engine(on)
  model(on)

  await answerTurn($, 't1', 'Add a dark mode toggle', 'Added a toggle in Settings.tsx.')
  await lens($, '')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await shows(ui, /Lens headline for Add a dark mode toggle/)).toBe(true)
    expect(await shows(ui, /^Session so far$/)).toBe(true)
    await ui.unmount()
  }
})
test('the purpose filter shows one list, or every list that has items', async ($, on) => {
  engine(on)
  model(on, { progress: ['wire the flag'], blocked: ['pick a default theme'] })

  await answerTurn($, 't1', 'Add a dark mode toggle', 'Added a toggle; which default?')
  await lens($, 'all')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await shows(ui, /◐ In progress/)).toBe(true)
  expect(await shows(ui, /pick a default theme/)).toBe(true)
  expect(await shows(ui, /✓ Done/)).toBe(false) // empty, so left out under `all`
  expect(await shows(ui, /✋ Needs you/)).toBe(true)
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(0) // headings at a real size on the desktop

  await ui.press({ key: 'u-blocked' })
  expect(await shows(ui, /wire the flag/)).toBe(false)
  expect(await shows(ui, /pick a default theme/)).toBe(true)

  await ui.press({ key: 'u-done' })
  expect(await shows(ui, /nothing finished/)).toBe(true)
})

test('switching purpose costs no model call', async ($, on) => {
  engine(on)
  const asked = model(on, { done: ['shipped'] })

  await answerTurn($, 't1', 'Ship it', 'Shipped.')
  await lens($, '')
  const before = asked.length
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const key of ['u-progress', 'u-blocked', 'u-done', 'u-all']) await ui.press({ key })
  expect(asked.length).toBe(before)
})

test('callout: the headline under the answer, with what needs the person or the chosen list', async ($, on) => {
  const clock = engine(on)
  model(on, { blocked: ['pick a default theme'], done: ['toggle added'] })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await answerTurn($, 't1', 'Explain the cache', 'The cache keys on the route.')
  await answerTurn($, 't2', 'Now the router', 'The router reads the table.')

  for (const surface of ['terminal', 'desktop'] as const) {
    await lens($, 'all')
    const draw = (n: number) =>
      $.ui.mount({ plugin: 'lens', surface, component: 'AssistantMessage', requestId: `m${n}-${surface}`, props: { text: 'The cache keys on the route.', isFirstOfReply: true } })

    const reply = await draw(1)
    await clock.advance(1000)
    expect(await shows(reply, /Lens headline for Explain the cache/)).toBe(true)
    expect(await shows(reply, /✋ pick a default theme/)).toBe(true)
    expect(await shows(reply, /The cache keys on the route/)).toBe(true)
    await reply.unmount()

    await lens($, 'done')
    const done = await draw(2)
    expect(await shows(done, /• toggle added/)).toBe(true)
    expect(await shows(done, /pick a default theme/)).toBe(false)

    await done.press({ key: 'lens-t1' })
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await shows(pane, /^1\. Explain the cache$/)).toBe(true)
    for (const one of [done, pane]) await one.unmount()
  }

  // A block that is not the end of an answer is left as the engine draws it.
  const step = await $.ui.mount({ plugin: 'lens', surface: 'desktop', component: 'AssistantMessage', requestId: 'm3', props: { text: 'Let me look at the router first.', isFirstOfReply: true } })
  expect(await step.find({ key: 'lens-t2' })).toBeUndefined()
})

test('replace mode swaps the answer for the lists, folds the steps, and expands on demand', async ($, on) => {
  const transcript: SessionMessage[] = []
  const clock = engine(on, transcript)
  model(on, { progress: ['wire the flag'], blocked: ['pick a default theme'] })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  transcript.push({ role: 'user', text: 'Ship the toggle', toolUses: [] })
  transcript.push({ role: 'assistant', text: 'Reading Settings.tsx first.\nThen the tests.', toolUses: [] })
  transcript.push({ role: 'assistant', text: 'The toggle ships behind a flag.', toolUses: [] })
  await answerTurn($, 't1', 'Ship the toggle', 'The toggle ships behind a flag.')

  // callout → replace, showing what needs the person
  await lens($, 'blocked')
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'inline' })
  expect(await pane.find({ key: 'inline', text: /replace/ })).toBeDefined()

  const draw = (requestId: string, text: string) =>
    $.ui.mount({ plugin: 'lens', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: requestId === 'a' } })

  const step = await draw('a', 'Reading Settings.tsx first.\nThen the tests.')
  expect(await shows(step, /^· Reading Settings\.tsx first\.$/)).toBe(true)

  await clock.advance(1000)
  const answer = await draw('b', 'The toggle ships behind a flag.')
  expect(await shows(answer, /Lens · needs you/)).toBe(true)
  expect(await shows(answer, /pick a default theme/)).toBe(true)
  expect(await shows(answer, /wire the flag/)).toBe(false)
  expect(await shows(answer, /ships behind a flag/)).toBe(false)

  expect(await shows(answer, /Lens headline for Ship the toggle/)).toBe(true)

  // Flipping keeps the box and its header; only the body and the button's label change.
  await answer.press({ key: 'orig-t1' })
  const opened = await draw('c', 'The toggle ships behind a flag.')
  expect(await shows(opened, /Lens · original/)).toBe(true)
  expect(await shows(opened, /ships behind a flag/)).toBe(true)
  expect(await shows(opened, /pick a default theme/)).toBe(false)
  expect(await opened.find({ key: 'orig-t1', text: /show lens view/ })).toBeDefined()
  expect(await opened.find({ key: 'lens-t1' })).toBeDefined()

  // The pane's purpose buttons, in the box: they refilter every reply, the chosen one primary.
  await opened.press({ key: 'orig-t1' })
  await opened.press({ key: 'ru-t1-progress' })
  const progress = await draw('d', 'The toggle ships behind a flag.')
  expect(await shows(progress, /Lens · in progress/)).toBe(true)
  expect(await shows(progress, /wire the flag/)).toBe(true)
  expect((await progress.find({ key: 'ru-t1-progress' }))?.props.variant).toBe('primary')
  expect((await progress.find({ key: 'ru-t1-all' }))?.props.variant).toBe('secondary')
})

test('reads a digest even when the model fences it, and refuses one with no headline', () => {
  const fenced = '```json\n{"headline": "Done", "progress": [], "blocked": ["ok?"], "done": ["a", 3]}\n```'
  expect(parseDigest(fenced)).toEqual({ headline: 'Done', progress: [], blocked: ['ok?'], done: ['a'] })
  expect(parseDigest('{"progress": []}')).toBeUndefined()
  expect(parseDigest('not json')).toBeUndefined()
})

test('matches a message, drawn without markdown, to the turn that wrote it', () => {
  const turn = (id: string, replies: string[], answer: string) => ({ id, prompt: id, answer, files: [], tools: 0, replies })
  const list = [
    turn('t1', ['Checked the **cache layer** first, then the keys.'], 'First answer about caching.'),
    turn('t2', ['Looking at `routes.ts`.'], 'Second answer about routing.'),
  ]

  expect(turnContaining(list, 'cache layer first, then')?.id).toBe('t1')
  expect(turnContaining(list, 'Looking at routes.ts')?.id).toBe('t2')
  expect(turnContaining(list, 'answer about caching')?.id).toBe('t1')
  expect(turnContaining(list, 'nowhere in the session')).toBeUndefined()
  expect(turnContaining(list, 'the')).toBeUndefined() // too short to mean one place
})

test('stamps each view with when the original reply was written, not when it was sorted', async ($, on) => {
  const transcript: SessionMessage[] = []
  const written = new Date(2026, 9, 8, 18, 5).getTime()
  const clock = engine(on, transcript, written)
  model(on, { blocked: ['pick a default theme'] })
  const stamp = timeOf(written, written)!

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  transcript.push({ role: 'user', text: 'Ship the toggle', toolUses: [] })
  transcript.push({ role: 'assistant', text: 'The toggle ships behind a flag.', toolUses: [] })
  await answerTurn($, 't1', 'Ship the toggle', 'The toggle ships behind a flag.')

  // Sorted twenty minutes later: the stamp stays the reply's own time.
  await clock.advance(20 * 60 * 1000)
  const draw = (requestId: string) =>
    $.ui.mount({ plugin: 'lens', surface: 'desktop', component: 'AssistantMessage', requestId, props: { text: 'The toggle ships behind a flag.', isFirstOfReply: true } })
  const callout = await draw('a')
  await clock.advance(1000)
  const sorted = await draw('b')
  expect(await sorted.find({ text: stamp })).toBeDefined()
  expect(await sorted.find({ text: timeOf(written + 20 * 60 * 1000, written)! })).toBeUndefined()
  for (const one of [callout, sorted]) await one.unmount()

  await lens($, '')
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shows(pane, new RegExp(`as of ${stamp}`))).toBe(true)
  expect(await shows(pane, new RegExp(stamp))).toBe(true)
})

test('a time from an earlier day carries its date', () => {
  const at = new Date(2026, 9, 6, 9, 30).getTime()
  const now = new Date(2026, 9, 8, 12, 0).getTime()
  expect(timeOf(at, now)).toBe(`${new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)
  expect(timeOf(at, at)).toBe(new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  expect(timeOf(undefined, now)).toBeUndefined()
})
