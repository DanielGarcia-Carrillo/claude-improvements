export type Bucket = 'progress' | 'needs' | 'waiting' | 'blocked' | 'done'

export type Purpose = 'all' | Bucket

export type InlineMode = 'off' | 'callout' | 'replace'

export type Turn = {
  id: string
  prompt: string
  answer: string
  files: string[]
  tools: number
  /** Each assistant text block of this turn, to find the turn a transcript message belongs to. */
  replies: string[]
  /** When Claude finished the reply, in ms since the epoch; absent on turns kept before it was recorded. */
  at?: number
}

/** A turn (or the session) sorted: a headline and what is in progress, needs the person, waits on others, is blocked, or got done. */
export type Digest = { headline: string } & Record<Bucket, string[]>

/** `since`: when a pending call started, so one lost to a reload can be retried. */
export type View = { status: 'pending' | 'done' | 'error'; text: string; digest?: Digest; since?: number }

declare module 'claude-code' {
  interface PluginState {
    lens: {
      turns: Turn[]
      purpose: Purpose
      focus: string | null
      views: Record<string, View>
      isOpen: boolean
      inline: InlineMode
      expanded: string[]
    }
  }
}
