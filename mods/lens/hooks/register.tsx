import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ResolveInput, Timer } from 'claude-code'

import type { Digest, InlineMode, Purpose, Turn, View } from '../types'
import { LENS, headingSvg, mid } from './heading'
import type { Hue } from './heading'
import { turnsFrom, withBackfill } from './backfill'
import { endsAnswer, turnContaining } from './match'
import { timeOf } from './time'
import { BUCKETS, PURPOSES, overviewRequest, parseDigest, titleOf, turnRequest } from './digest'

const PANE = 'lens'
const MODEL = 'haiku'
const NEAR = 2 // turns this close to the focus show their headline; farther ones fold away
const TICK_MS = 400 // how often the inline rows' wanted digests are generated
const REPLY_MAX = 8000 // characters kept per reply block for matching
const INLINE_MAX = 3 // inline digests generated at once
const BACKFILL = 10 // earlier turns rebuilt from the transcript when the lens loads
const TIMEOUT_MS = 60_000 // how long one model call may take
const STALE_MS = TIMEOUT_MS + 15_000 // a call pending longer was lost (a reload mid-call) and may be retried

const turns = atom({ plugin: 'lens', key: 'turns' } as const, [])
const purpose = atom({ plugin: 'lens', key: 'purpose' } as const, 'all')
const focus = atom({ plugin: 'lens', key: 'focus' } as const, null)
const views = atom({ plugin: 'lens', key: 'views' } as const, {})
const isOpen = atom({ plugin: 'lens', key: 'isOpen' } as const, false)
const inline = atom({ plugin: 'lens', key: 'inline' } as const, 'replace')
const expanded = atom({ plugin: 'lens', key: 'expanded' } as const, [])

const MODES: InlineMode[] = ['off', 'callout', 'replace']
// Sessions from before the third mode stored this as a boolean.
const modeOf = (stored: unknown): InlineMode =>
  stored === false ? 'off' : stored === true ? 'callout' : MODES.includes(stored as InlineMode) ? (stored as InlineMode) : 'replace'

// v2: digests cached before the five lists had a different shape.
const viewKey = (turnId: string) => `digest|v2|${turnId}`
const overviewKey = (lastTurnId: string) => `digest|v2|overview|${lastTurnId}`

const focusIndex = (list: Turn[], id: string | null) => {
  const found = id === null ? -1 : list.findIndex(t => t.id === id)

  return found === -1 ? list.length - 1 : found
}

// What a retry button may redo: a failed call, or one pending past its timeout.
const isRetryable = (view: View | undefined, now: number) =>
  view?.status === 'error' || (view?.status === 'pending' && now - (view.since ?? 0) > STALE_MS)

// `force` redoes the call whatever is known: the retry buttons.
async function generate($: EngineInterface, key: string, ask: { system: string; prompt: string; maxTokens: number }, force = false) {
  const now = await $.clock.now().catch(() => Date.now())
  const known = (await read($, views))[key]
  if (!force && known && known.status !== 'error' && !isRetryable(known, now)) return

  const pending: View = { status: 'pending', text: '', since: now }
  await update($, views, v => ({ ...v, [key]: pending }))
  // A call that rejects (the engine refusing to send it) ends as an error view
  // too, never left pending: an error is what the next refresh retries.
  let view: View
  try {
    const result = await $.model.complete({ model: MODEL, effort: 'low', timeoutMs: TIMEOUT_MS, ...ask })
    const digest = result.isAnswered ? parseDigest(result.text) : undefined
    view = digest
      ? { status: 'done', text: digest.headline, digest }
      : { status: 'error', text: result.isAnswered ? "couldn't read the summary" : `couldn't summarize (${result.reason})` }
  } catch {
    view = { status: 'error', text: "couldn't summarize" }
  }
  await update($, views, v => ({ ...v, [key]: view }))
}

// One line per earlier turn, so a digest knows what led up to its turn.
const contextFor = (list: Turn[], known: Record<string, View>, i: number) =>
  list.slice(Math.max(0, i - 6), i).map(t => {
    const view = known[viewKey(t.id)]

    return view?.status === 'done' ? view.text : titleOf(t)
  })

// Fills what the pane is about to show: the focused turn and its neighbours,
// and the session overview.
async function refresh($: EngineInterface) {
  const list = await read($, turns)
  if (list.length === 0) return

  const f = focusIndex(list, await read($, focus))
  const known = await read($, views)

  const jobs: Promise<void>[] = []
  list.forEach((t, i) => {
    if (Math.abs(i - f) <= NEAR) jobs.push(generate($, viewKey(t.id), turnRequest(t, contextFor(list, known, i))))
  })
  const last = list.at(-1)
  if (last) jobs.push(generate($, overviewKey(last.id), overviewRequest(list.slice(-20))))
  await Promise.all(jobs)
}

async function retryTurn($: EngineInterface, turnId: string) {
  const list = await read($, turns)
  const i = list.findIndex(t => t.id === turnId)
  const turn = list[i]
  if (turn !== undefined) await generate($, viewKey(turnId), turnRequest(turn, contextFor(list, await read($, views), i)), true)
}

async function retryOverview($: EngineInterface) {
  const list = await read($, turns)
  const last = list.at(-1)
  if (last) await generate($, overviewKey(last.id), overviewRequest(list.slice(-20)), true)
}

const shownBuckets = (d: Digest, p: Purpose) => BUCKETS.filter(b => (p === 'all' ? d[b.id].length > 0 : b.id === p))

// A heading at a real size: SVG text where the surface draws SVG (the desktop),
// else bold coloured text, as the terminal has one type size.
function heading($: EngineInterface, e: ResolveInput, key: string, text: string, size: number, hue: Hue, columns: number) {
  // By surface, not by the table: every surface's table answers `in` for Svg.
  if (e.surface !== 'terminal') {
    const { Box, Svg } = $.ui.resolve({ ...e, surface: e.surface })
    const svg = headingSvg(text, size, hue, Math.min(720, Math.max(240, columns * 8)))

    return (
      <Box key={key}>
        <Svg source={svg.source} alt={text} width={svg.width} height={svg.height} />
      </Box>
    )
  }
  const { Text } = $.ui.resolve(e)

  return (
    <Text key={key} bold color={hue === 'text' ? undefined : mid(hue)}>
      {text}
    </Text>
  )
}

// The digest's lists, one heading each in the list's own colour, as many as the
// purpose asks for. `all` skips empty ones.
function sections($: EngineInterface, e: ResolveInput, d: Digest, p: Purpose, size: number, columns: number) {
  const { Box, Markdown } = $.ui.resolve(e)
  const shown = shownBuckets(d, p)
  if (shown.length === 0) return <Markdown text="_nothing to report_" />

  return (
    <Box flexDirection="column" rowGap={1}>
      {shown.map(b => (
        <Box key={`s-${b.id}`} flexDirection="column">
          {heading($, e, `h-${b.id}`, `${b.mark} ${b.label}`, size, b.hue, columns)}
          <Markdown text={d[b.id].length === 0 ? `_${b.empty}_` : d[b.id].map(x => `- ${x}`).join('\n')} />
        </Box>
      ))}
    </Box>
  )
}

const tally = (d: Digest) => BUCKETS.map(b => `${b.mark} ${d[b.id].length}`).join('   ')

// A message row carries no turn id; once matched by its text, it keeps its turn.
const turnOfMessage = new Map<string, string>()
const turnFor = (list: Turn[], requestId: string, text: string) => {
  const known = turnOfMessage.get(requestId)
  if (known) return known
  const turn = turnContaining(list, text)
  if (turn) turnOfMessage.set(requestId, turn.id)

  return turn?.id
}

async function openPane($: EngineInterface) {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: 'Lens' })
  await refresh($)
}

// The inline rows ask for the digests they lack; a render may not start work,
// so they note the turn here and a timer generates a few at a time.
const wanted = new Set<string>()
let inFlight = 0
let ticker: Timer | undefined

async function fillInline($: EngineInterface) {
  if (wanted.size === 0 || inFlight >= INLINE_MAX) return

  const list = await read($, turns)
  const known = await read($, views)
  const jobs: Promise<void>[] = []
  for (const turnId of [...wanted].reverse()) {
    if (inFlight >= INLINE_MAX) break
    wanted.delete(turnId)
    const i = list.findIndex(t => t.id === turnId)
    const turn = list[i]
    const key = viewKey(turnId)
    if (turn === undefined || known[key] !== undefined) continue
    inFlight += 1
    jobs.push(generate($, key, turnRequest(turn, contextFor(list, known, i))).finally(() => (inFlight -= 1)))
  }
  await Promise.all(jobs)
}

// The inline row's button: show this turn in the pane, opening it if need be.
async function showTurn($: EngineInterface, id: string) {
  const list = await read($, turns)
  await update($, focus, () => (id === list.at(-1)?.id ? null : id))
  if (await read($, isOpen)) await refresh($)
  else await openPane($)
}

// The turns from before the lens loaded (a resumed session, or the mod added
// mid-session): the last few are rebuilt from the transcript, without times.
async function backfill($: EngineInterface) {
  try {
    const rebuilt = turnsFrom(await $.session.messages())
    if (rebuilt.length > 0) await update($, turns, known => withBackfill(known, rebuilt, BACKFILL).slice(-50))
  } catch {
    // No transcript to read: the lens starts from the next turn.
  }
}

const toggleExpanded = ($: EngineInterface, id: string) =>
  update($, expanded, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(-200)))

export const register: Register = on => {
  // The turn in flight; a reload mid-turn loses it, which only drops that turn's file list.
  let prompt = ''
  let files: string[] = []
  let tools = 0

  on('session.start', async ($, e, next) => {
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => void fillInline($))
    await $.command.register({
      name: 'lens',
      description: 'Sort this session into in progress, needs you, waiting on others, blocked and done: /lens [all|progress|needs|waiting|blocked|done]',
      argumentHint: '[purpose]',
    })
    await backfill($)

    return next(e)
  })

  on('command.run', { command: 'lens' }, async ($, e) => {
    const words: Record<string, Purpose> = {
      all: 'all',
      progress: 'progress',
      needs: 'needs',
      you: 'needs',
      waiting: 'waiting',
      others: 'waiting',
      blocked: 'blocked',
      done: 'done',
    }
    for (const word of e.args.toLowerCase().split(/\s+/).filter(Boolean)) {
      const u = words[word]
      if (u) await update($, purpose, () => u)
    }
    if ((await read($, turns)).length === 0) {
      await update($, isOpen, () => true)
      await $.ui.open({ id: PANE, title: 'Lens' })

      return { text: 'Lens opened. It fills in after the next answer.' }
    }
    await openPane($)

    return { text: 'Lens opened.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const mode = modeOf(await read($, inline))
    if (e.props.isSummary || mode === 'off') return next(e)
    const list = await read($, turns)
    const id = turnFor(list, e.requestId, e.props.text)
    const turn = list.find(t => t.id === id)
    if (turn === undefined) return next(e) // still streaming, or from before the lens

    const isEnd = endsAnswer(turn, e.props.text)
    const isExpanded = (await read($, expanded)).includes(turn.id)
    const p = await read($, purpose)
    const view = (await read($, views))[viewKey(turn.id)]
    if (view === undefined) wanted.add(turn.id)
    const d = view?.digest
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const label = PURPOSES.find(x => x.id === p)?.label ?? p
    const columns = e.viewport?.columns ?? 80
    const when = timeOf(turn.at, await $.clock.now().catch(() => Date.now()))

    const color = mid(LENS)
    const openButton = <Button key={`lens-${turn.id}`} label="open in lens ›" onPress={() => showTurn($, turn.id)} />
    const status = view?.status === 'error' ? `${view.text}; showing the original` : 'sorting…'
    const retryButton = isRetryable(view, await $.clock.now().catch(() => Date.now())) && (
      <Button key={`retry-${turn.id}`} label="↻" onPress={() => retryTurn($, turn.id)} />
    )

    // Callout: the original, then a strip with the headline and the purpose's items
    // (with `all`, the counts and whatever needs the person).
    if (mode === 'callout') {
      if (!isEnd) return next(e)
      // With `all`, what needs a look: the person's asks and what is blocked.
      const items: { text: string; hue?: Hue }[] =
        d === undefined
          ? []
          : p === 'all'
            ? BUCKETS.filter(b => b.id === 'needs' || b.id === 'blocked').flatMap(b => d[b.id].map(x => ({ text: `${b.mark} ${x}`, hue: b.hue })))
            : d[p].map(x => ({ text: `• ${x}` }))

      return (
        <Box flexDirection="column" rowGap={1}>
          <Markdown text={e.props.text} />
          <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
            <Box columnGap={2} alignItems="center">
              <Text bold color={color}>
                ◆ Lens
              </Text>
              {when !== undefined && <Text dimColor>{when}</Text>}
              <Box flexShrink={1} flexGrow={1}>
                <Text dimColor={d === undefined}>{d?.headline ?? status}</Text>
              </Box>
              {retryButton}
              {openButton}
            </Box>
            {d !== undefined && p === 'all' && <Text dimColor>{tally(d)}</Text>}
            {d !== undefined && p !== 'all' && items.length === 0 && <Text dimColor>{BUCKETS.find(b => b.id === p)?.empty}</Text>}
            {items.map((x, i) => (
              <Text key={`i-${i}`} color={x.hue === undefined ? undefined : mid(x.hue)}>
                {x.text}
              </Text>
            ))}
          </Box>
        </Box>
      )
    }

    // Replace: the steps between tool calls fold to one dim line each. The answer
    // is one box in every state (sorting, the lists, the original), so
    // nothing around it moves as it fills in or flips; only its body changes.
    if (!isEnd) {
      return (
        <Text dimColor wrap="truncate-end">
          · {e.props.text.trim().split('\n')[0]}
        </Text>
      )
    }
    const isOriginal = isExpanded || d === undefined

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} rowGap={1}>
        <Box columnGap={2} alignItems="center">
          <Text bold color={color}>
            ◆ Lens · {d === undefined || isExpanded ? 'original' : label}
          </Text>
          {when !== undefined && <Text dimColor>{when}</Text>}
          <Box flexShrink={1} flexGrow={1}>
            {d === undefined && <Text dimColor>{status}</Text>}
          </Box>
          {retryButton}
          {d !== undefined && (
            <Button key={`orig-${turn.id}`} label={isExpanded ? 'show lens view' : 'show original'} onPress={() => toggleExpanded($, turn.id)} />
          )}
          {openButton}
        </Box>
        {/* The pane's purpose buttons, here too: they refilter every reply at once. */}
        <Box flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center">
          {PURPOSES.map(x => (
            // While the original shows, the lists are not on screen: no choice is
            // highlighted and the buttons draw dim and do nothing (Button has no disabled).
            <Button
              key={`ru-${turn.id}-${x.id}`}
              variant={!isOriginal && x.id === p ? 'primary' : 'secondary'}
              dimColor={isOriginal}
              label={x.label}
              onPress={() => (isOriginal ? undefined : update($, purpose, () => x.id))}
            />
          ))}
        </Box>
        {isOriginal ? (
          <Markdown text={e.props.text} />
        ) : (
          <Box flexDirection="column" rowGap={1}>
            {heading($, e, 'headline', d.headline, 20, 'text', columns)}
            {sections($, e, d, p, 16, columns)}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isOpen, () => false)

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    prompt = e.text
    files = []
    tools = 0

    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) {
      tools += 1
      const input = ('input' in e ? e.input : undefined) as { file_path?: unknown; notebook_path?: unknown } | undefined
      const path = input?.file_path ?? input?.notebook_path
      if (typeof path === 'string' && !files.includes(path)) files.push(path)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer' && e.answer.trim() !== '') {
      // The turn's assistant text blocks: every row after the last prompt the person typed.
      // Missing them only costs matching on the turn's earlier blocks, never the turn.
      let replies: string[] = []
      try {
        const rows = await $.session.messages()
        const start = rows.findLastIndex(r => r.role === 'user' && (r.toolResults ?? []).length === 0)
        replies = rows
          .slice(start + 1)
          .filter(r => r.role === 'assistant' && r.text.trim() !== '' && r.text !== e.answer)
          .map(r => r.text.slice(0, REPLY_MAX))
      } catch {
        replies = []
      }
      // The reply's own time, which every view stamps; a clock that fails costs the stamp, not the turn.
      const at = await $.clock.now().catch(() => undefined)
      const turn: Turn = { id: e.turnId, prompt, answer: e.answer, files: [...files], tools, replies, at }
      await update($, turns, list => [...list, turn].slice(-50))
      if (await read($, isOpen)) $.clock.after(50, () => void refresh($))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const list = await read($, turns)
    const p = await read($, purpose)
    const known = await read($, views)
    const mode = modeOf(await read($, inline))
    const columns = e.props.bodyColumns
    const color = mid(LENS)

    const sortBy = (u: Purpose) => () => update($, purpose, () => u)
    const goTo = (id: string | null) => async () => {
      await update($, focus, () => id)
      await refresh($)
    }
    const cycleInline = () => update($, inline, () => MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'replace')

    const header = (
      <Box flexDirection="column">
        <Box flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center">
          {PURPOSES.map(x => (
            <Button key={`u-${x.id}`} hotkey={x.hotkey} variant={x.id === p ? 'primary' : 'secondary'} label={x.label} onPress={sortBy(x.id)} />
          ))}
          <Text dimColor> │ </Text>
          <Button key="inline" hotkey="n" label={`inline: ${mode}`} onPress={cycleInline} />
        </Box>
      </Box>
    )

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text dimColor>No answers yet. The lens fills in after Claude's next reply.</Text>
        </Box>
      )
    }

    const f = focusIndex(list, await read($, focus))
    const now = await $.clock.now().catch(() => Date.now())
    const shownOriginal = await read($, expanded)
    const body = (v: View | undefined, key: string, retry: () => Promise<void>) =>
      v?.digest !== undefined ? (
        <Box flexDirection="column" rowGap={1}>
          <Text bold>{v.digest.headline}</Text>
          {sections($, e, v.digest, p, 15, columns)}
        </Box>
      ) : (
        <Box columnGap={2} alignItems="center">
          <Text dimColor>{v?.status === 'error' ? v.text : 'sorting…'}</Text>
          {isRetryable(v, now) && <Button key={key} hotkey={key === 'retry-turn' ? 'r' : undefined} label="↻" onPress={retry} />}
        </Box>
      )
    const overview = known[overviewKey(list.at(-1)?.id ?? '')]

    const rows = list.map((t, i) => {
      const d = Math.abs(i - f)
      const view = known[viewKey(t.id)]
      if (d === 0) {
        const isOriginal = shownOriginal.includes(t.id)

        return (
          <Box key={`t-${t.id}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} rowGap={1}>
            <Box columnGap={2} alignItems="center">
              <Box flexShrink={1} flexGrow={1}>
                {heading($, e, 'title', `${i + 1}. ${titleOf(t)}`, 18, 'text', columns - 14)}
              </Box>
              <Button key="pane-orig" hotkey="o" label={isOriginal ? 'lens view' : 'original'} onPress={() => toggleExpanded($, t.id)} />
            </Box>
            {(t.at !== undefined || t.files.length > 0) && (
              <Text dimColor wrap="truncate-end">
                {[timeOf(t.at, now), ...t.files].filter(Boolean).join('  ·  ')}
              </Text>
            )}
            {isOriginal ? <Markdown text={t.answer} /> : body(view, 'retry-turn', () => retryTurn($, t.id))}
          </Box>
        )
      }
      if (d <= NEAR) {
        const flags = BUCKETS.filter(b => (b.id === 'needs' || b.id === 'blocked') && (view?.digest?.[b.id].length ?? 0) > 0)
          .map(b => `   ${b.mark} ${view?.digest?.[b.id].length}`)
          .join('')
        const when = timeOf(t.at, now)

        return (
          <Button
            key={`t-${t.id}`}
            plain
            dimColor
            label={`${i + 1}  ${when !== undefined ? `${when}  ` : ''}${view?.status === 'done' ? view.text : titleOf(t)}${flags}`}
            onPress={goTo(i === list.length - 1 ? null : t.id)}
          />
        )
      }

      return null
    })

    const older = Math.max(0, f - NEAR)
    const newer = Math.max(0, list.length - 1 - f - NEAR)

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Box flexDirection="column" rowGap={1}>
          {heading($, e, 'session', 'Session so far', 20, LENS, columns)}
          {list.at(-1)?.at !== undefined && <Text dimColor>as of {timeOf(list.at(-1)?.at, now)}</Text>}
          {body(overview, 'retry-overview', () => retryOverview($))}
        </Box>
        <Box flexDirection="column">
          {older > 0 && <Text dimColor>… {older} earlier</Text>}
          {rows}
          {newer > 0 && <Text dimColor>… {newer} later</Text>}
        </Box>
        <Box columnGap={1}>
          {f > 0 && <Button key="prev" hotkey="k" label="‹ older" onPress={goTo(list[f - 1]?.id ?? null)} />}
          {f < list.length - 1 && (
            <Button key="next" hotkey="j" label="newer ›" onPress={goTo(f + 1 === list.length - 1 ? null : (list[f + 1]?.id ?? null))} />
          )}
          {f < list.length - 1 && <Button key="latest" hotkey="l" label="latest »" onPress={goTo(null)} />}
        </Box>
      </Box>
    )
  })
}
