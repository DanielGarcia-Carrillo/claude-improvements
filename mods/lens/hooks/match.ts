import type { Turn } from '../types'

// Drawn text and markdown source differ in punctuation and spacing, so both
// sides are reduced to lowercase words before matching.
export const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// A message row carries no turn id, so find the turn whose text
// holds its opening; the latest wins, as a repeated phrase most likely means it.
export const turnContaining = (list: Turn[], text: string) => {
  const probe = words(text).slice(0, 120).trim()
  if (probe.length < 8) return undefined

  // Turns kept before `replies` existed lack it and match on their answer alone.
  return list.findLast(t => [...(t.replies ?? []), t.answer].some(r => words(r).includes(probe)))
}

// True for the block that ends the turn's answer: the one a summary row goes under.
export const endsAnswer = (turn: Turn, text: string) => {
  const tail = words(text).slice(-120)

  return tail.length > 0 && words(turn.answer).endsWith(tail)
}
