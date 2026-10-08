import type { EngineInterface, Register } from 'claude-code'

// watching: checks context fill after each main-loop turn
// checkpointing: the checkpoint prompt is submitted or its turn is running
// compacting: /compact is queued or running with the checkpoint as its brief
type Phase = 'watching' | 'checkpointing' | 'compacting'

const COMMAND = 'early-compact'
const MAX_BRIEF_CHARS = 12_000
const SNOOZE_POINTS = 10

// Finds the checkpoint turn in turn.start whatever frame the prompt arrives in.
const CHECKPOINT_MARK = 'write a checkpoint a fresh copy of you could resume from'

export const CHECKPOINT_PROMPT = `Context is getting full, so this session will be compacted as soon as you reply. Before that, ${CHECKPOINT_MARK} with nothing else to go on.

Do not call tools and do not continue the task: reply with the checkpoint alone, under these headings.

- **Goal**: what the user asked for, in their terms, with every constraint and preference they stated.
- **State**: what is done, what is in progress, and what is verified versus assumed.
- **Key facts**: exact file paths, symbols, commands, branch names and SHAs, URLs, IDs and error messages.
- **Decisions**: choices made and why, including approaches ruled out.
- **Open questions**: anything waiting on the user or still unknown.
- **Next steps**: the concrete next actions, in order.

Facts over prose, at most about 800 words.`

export function resumePrompt(path: string | undefined): string {
  const source =
    path === undefined
      ? 'the checkpoint in the summary above'
      : `the checkpoint saved at \`${path}\` (read it first: it is fuller than the summary)`

  return `The conversation was just compacted early to free up context. Pick up where you left off, using ${source}.

- If your last turn was partway through work the user asked for, or said it would carry on, continue it from Next steps.
- If the next step needs the user (a question, an approval, a choice), say in a line or two what you are waiting for and stop.
- Do not start work the user has not asked for.`
}

// The module's environment is fresh on every load, so this is per session.
const session = {
  phase: 'watching' as Phase,
  isEnabled: true,
  snoozeBelowPercent: 0,
  checkpointTurnId: undefined as string | undefined,
  // Counts the person's prompts, so a resume queued behind one is dropped.
  userPrompts: 0,
  resumeAfterUserPrompts: undefined as number | undefined,
  checkpoints: 0,
  lastCheckpointPath: undefined as string | undefined,
}

export function compactBrief(checkpoint: string, path: string | undefined): string {
  const body =
    checkpoint.length > MAX_BRIEF_CHARS
      ? `${checkpoint.slice(0, MAX_BRIEF_CHARS)}\n[checkpoint cut at ${MAX_BRIEF_CHARS} characters]`
      : checkpoint

  return `This is an early compaction. The last assistant message is a checkpoint written for it: build the summary around that checkpoint, keep its Goal, Key facts, Decisions, Open questions and Next steps intact (exact strings stay exact), and add anything from earlier in the conversation it missed.${
    path === undefined
      ? ''
      : ` The summary must state that the full checkpoint is saved at \`${path}\` and should be read before resuming.`
  }

<checkpoint>
${body}
</checkpoint>`
}

function reset($: EngineInterface) {
  session.phase = 'watching'
  session.snoozeBelowPercent = 0
  session.checkpointTurnId = undefined
  $.ui.status(undefined)
}

function snooze($: EngineInterface, percent: number, why: string) {
  reset($)
  session.snoozeBelowPercent = percent + SNOOZE_POINTS
  $.ui.toast(`Early compaction ${why}; trying again at ${session.snoozeBelowPercent}%.`)
}

async function contextFill($: EngineInterface) {
  const { context } = await $.session.usage()

  return { percent: context.percent ?? 0, tokens: context.tokens ?? 0 }
}

// startCheckpoint and startCompact act from a timer: a $ call made inside a
// hook the turn waits on is refused, and the prompt and the command each wait
// for the session to go idle.
function startCheckpoint($: EngineInterface) {
  session.phase = 'checkpointing'
  $.ui.status('early-compact: writing checkpoint')
  $.clock.after(0, () => {
    $.prompt
      .submit({ text: CHECKPOINT_PROMPT })
      .then(entered => {
        if (entered.drop !== undefined) {
          reset($)
          $.ui.toast(`Early compaction stopped: ${entered.drop}`)
        }
      })
      .catch(() => {
        reset($)
        $.ui.toast('Early compaction stopped: the checkpoint prompt was refused.')
      })
  })
}

// Saves the checkpoint where the next turn can Read it without a prompt: under
// the project's .claude/, in a folder that git-ignores itself.
async function saveCheckpoint($: EngineInterface, checkpoint: string, percent: number) {
  const [root, sessionId, now] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.clock.now(),
  ])
  const folder = `${root}/.claude/early-compact`
  const stamp = new Date(now).toISOString()
  session.checkpoints += 1
  const path = `${folder}/${sessionId}/checkpoint-${session.checkpoints}.md`

  await $.fs.write(`${folder}/.gitignore`, '*\n')
  await $.fs.write(
    path,
    `# Checkpoint ${session.checkpoints}\n\nSession \`${sessionId}\`, written ${stamp} at ${percent}% context, just before an early compaction.\n\n${checkpoint.trim()}\n`,
  )
  session.lastCheckpointPath = path

  return path
}

function startResume($: EngineInterface, path: string | undefined) {
  const since = session.resumeAfterUserPrompts
  session.resumeAfterUserPrompts = undefined
  $.clock.after(0, () => {
    // The person's own prompt, sent while this ran, carries on in its place.
    if (since !== undefined && session.userPrompts > since) {
      return
    }
    $.prompt.submit({ text: resumePrompt(path) }).catch(() => {
      $.ui.toast('Compacted early, but could not resume: send a prompt to continue.')
    })
  })
}

function startCompact(
  $: EngineInterface,
  checkpoint: string,
  path: string | undefined,
  percent: number,
) {
  session.phase = 'compacting'
  session.resumeAfterUserPrompts = session.userPrompts
  $.ui.status('early-compact: compacting')
  $.clock.after(0, () => {
    $.command
      .run({ command: 'compact', args: compactBrief(checkpoint, path) })
      .then(() => {
        // session.compact resets first when the compaction stands
        if (session.phase === 'compacting') {
          snooze($, percent, 'was skipped')
        }
      })
      .catch(() => snooze($, percent, 'failed'))
  })
}

export const register: Register = (on, options) => {
  const thresholdPercent = Number(options.thresholdPercent ?? 60)
  const minTokens = Number(options.minTokens ?? 40_000)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: `Checkpoint and compact early (auto at ${thresholdPercent}%)`,
      argumentHint: '[now|on|off|status]',
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const action = e.args.trim().toLowerCase() || 'status'

    if (action === 'on' || action === 'off') {
      session.isEnabled = action === 'on'
      reset($)

      return { text: `Early compaction ${action} for this session.` }
    }

    if (action === 'now') {
      if (session.phase !== 'watching') {
        return { text: `Early compaction is already ${session.phase}.` }
      }
      startCheckpoint($)

      return { text: 'Writing a checkpoint, then compacting and resuming.' }
    }

    if (action !== 'status') {
      return { text: `Unknown option "${action}". Use now, on, off or status.` }
    }

    const { percent, tokens } = await contextFill($)
    const when = `at ${thresholdPercent}% of the window and ${minTokens.toLocaleString()}+ tokens`
    const snoozed =
      session.snoozeBelowPercent > thresholdPercent
        ? ` (snoozed until ${session.snoozeBelowPercent}%)`
        : ''

    return {
      text: [
        `Early compaction is ${session.isEnabled ? 'on' : 'off'}: checkpoint and compact ${when}${snoozed}.`,
        `Context now: ${percent}% (${tokens.toLocaleString()} tokens). Phase: ${session.phase}.`,
        `Last checkpoint: ${session.lastCheckpointPath ?? 'none yet'}.`,
      ].join('\n'),
    }
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind !== 'plugin') {
      session.userPrompts += 1
    }

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (session.phase === 'checkpointing' && e.text.includes(CHECKPOINT_MARK)) {
      session.checkpointTurnId = e.turnId
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      return result
    }

    if (e.turnId === session.checkpointTurnId) {
      session.checkpointTurnId = undefined
      const { percent } = await contextFill($)
      if (e.reason === 'answer' && e.answer.trim() !== '') {
        const path = await saveCheckpoint($, e.answer, percent).catch(() => {
          session.lastCheckpointPath = undefined
          $.ui.toast('Early compaction could not save the checkpoint file; it is in the summary.')

          return undefined
        })
        startCompact($, e.answer, path, percent)
      } else {
        snooze($, percent, e.reason === 'aborted' ? 'was interrupted' : 'got no checkpoint')
      }

      return result
    }

    if (!session.isEnabled || session.phase !== 'watching' || e.reason !== 'answer') {
      return result
    }

    const { percent, tokens } = await contextFill($)
    const isDue =
      percent >= thresholdPercent &&
      percent >= session.snoozeBelowPercent &&
      tokens >= minTokens
    if (isDue) {
      $.ui.toast(`Context at ${percent}%: writing a checkpoint, then compacting and resuming.`)
      startCheckpoint($)
    }

    return result
  })

  // Any compaction of the main conversation (ours, /compact, auto) starts a
  // fresh window, so the watch starts over; after ours, the session resumes.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    const isFreshWindow =
      e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined
    if (!isFreshWindow) {
      return result
    }

    const wasOurs = session.phase === 'compacting'
    reset($)
    if (wasOurs) {
      const { tokensBefore, tokensAfter } = result
      $.ui.toast(
        tokensBefore !== undefined && tokensAfter !== undefined
          ? `Compacted early: ${tokensBefore.toLocaleString()} → ${tokensAfter.toLocaleString()} tokens.`
          : 'Compacted early.',
      )
      startResume($, session.lastCheckpointPath)
    }

    return result
  })
}
