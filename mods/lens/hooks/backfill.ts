import type { SessionMessage } from 'claude-code'

import type { Turn } from '../types'

const REPLY_MAX = 8000 // characters kept per reply block for matching

// A prompt the person typed: a user row with text and no tool results, and not
// one of the rows the engine writes in their name (command records, reminders).
const isPrompt = (row: SessionMessage) =>
  row.role === 'user' &&
  (row.toolResults ?? []).length === 0 &&
  row.text.trim() !== '' &&
  !/^\s*<(local-command|command-|system-reminder|task-notification)/.test(row.text)

// A stable id from the turn's text, so a turn rebuilt twice is the same turn.
const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0

  return (h >>> 0).toString(36)
}

/**
 * The turns a transcript holds, rebuilt from its rows: each typed prompt and
 * the assistant text that followed it, the last block being the answer. Rows
 * carry no times, so a rebuilt turn has none.
 */
export function turnsFrom(rows: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  let open: { prompt: string; texts: string[]; files: string[]; tools: number } | undefined
  const close = () => {
    const answer = open?.texts.at(-1)
    if (open === undefined || answer === undefined) return
    turns.push({
      id: `backfill:${hash(`${open.prompt}\n${answer.slice(0, 500)}`)}`,
      prompt: open.prompt,
      answer,
      files: open.files,
      tools: open.tools,
      replies: open.texts.slice(0, -1).map(t => t.slice(0, REPLY_MAX)),
    })
  }

  for (const row of rows) {
    if (isPrompt(row)) {
      close()
      open = { prompt: row.text, texts: [], files: [], tools: 0 }
      continue
    }
    if (open === undefined || row.role !== 'assistant') continue
    if (row.text.trim() !== '') open.texts.push(row.text)
    for (const use of row.toolUses) {
      if (use.agentId !== undefined) continue
      open.tools += 1
      const path = use.input.file_path ?? use.input.notebook_path
      if (typeof path === 'string' && !open.files.includes(path)) open.files.push(path)
    }
  }
  close()

  return turns
}

/**
 * The turns the lens already knows, with up to `limit` of the transcript's
 * earlier ones filled in around them, in transcript order. A known turn keeps
 * its id, time and files; it is recognised by its answer.
 */
export function withBackfill(known: Turn[], rebuilt: Turn[], limit: number): Turn[] {
  const byAnswer = new Map(known.map(t => [t.answer.trim(), t]))
  const missing = rebuilt.filter(t => !byAnswer.has(t.answer.trim()))
  const added = new Set(limit > 0 ? missing.slice(-limit) : [])

  const merged: Turn[] = []
  for (const t of rebuilt) {
    const kept = byAnswer.get(t.answer.trim())
    if (kept !== undefined) {
      merged.push(kept)
      byAnswer.delete(t.answer.trim())
    } else if (added.has(t)) {
      merged.push(t)
    }
  }

  // Known turns the transcript no longer shows were compacted away, so they are
  // older than anything it holds: they stay, ahead of it.
  return [...byAnswer.values(), ...merged]
}
