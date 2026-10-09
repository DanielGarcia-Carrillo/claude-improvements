# lens

Sorts each of Claude's replies into five lists, **in progress**, **needs
you**, **waiting on others**, **blocked** and **done**, under a one-line
headline. You see where the work stands
without reading the whole reply. The idea comes from Amelia Wattenberger's
[fish-eye essay](https://wattenberger.com/thoughts/fish-eye/): show the part
you're looking at in detail, with the context around it summarised.

## What it does

After each main-loop turn, Haiku reads your prompt and Claude's final answer
and returns a headline plus up to five items per list:

- **In progress**: work started but not finished, or next steps Claude said
  it would take itself.
- **Needs you**: only what you personally have to do: questions Claude asked
  you, choices it offered, approvals or actions it requested of you.
- **Waiting on others**: work waiting on someone other than you or Claude.
  Each item names who, as specifically as the reply allows (a session, agent,
  branch, PR, CI run or person). A task handed to another session goes here,
  even when you're the one relaying it.
- **Blocked**: obstacles that are nobody's task: rate or usage limits, failing
  tools or services, denied permissions, missing access.
- **Done**: what this turn finished.

One call covers all five lists, so switching between them never calls the
model again. Digests are cached per turn for the session.

Every view is stamped with when Claude finished the original reply (with the
date once it isn't today), not when it was summarised.

### In the transcript

The `inline` button cycles three modes. Replace is the default:

- **off**: replies draw as usual.
- **callout**: a strip under each answer shows the headline, the list counts
  anything that needs you and anything blocked, plus `open in lens ›`.
- **replace**: each answer becomes one box. It holds the headline and the
  lists, the purpose buttons, `show original` and `open in lens ›`. The box
  stays the same size and place whether it is still sorting, showing the lists
  or showing the original, so the transcript doesn't jump. Text Claude wrote
  between tool calls folds to its first line.

### In the side pane

`/lens [all|progress|needs|waiting|blocked|done]` opens a pane with:

- **Session so far**: what's still open after the latest turn, and what got
  done across the session.
- **The focused turn**: the turn in full, with `original` to swap in Claude's
  reply.
- **Nearby turns**: as headlines, with `✋ n` when they're waiting on you and
  `⛔ n` when they're blocked.

Keys while the pane has focus: `a`/`1`–`5` choose the list, `r` retries the
focused turn's summary, `n` cycles the
inline mode, `o` toggles the original, and `k`/`j`/`l` move between turns.

### When a summary fails

A summary that fails (the model call errors or times out, or its answer can't
be read) shows `↻`, inline and in the pane, next to the error. Inline
replies never retry on their own, so a rate limit isn't hammered; the pane
retries what it shows each time it refreshes. A summary still `sorting…`
after 75 seconds was lost (a reload mid-call, say) and gets the button too.

## Notes

- **Display only.** Replace mode changes what you see, never what Claude
  reads or what the transcript file stores.
- **Cost.** One Haiku call per turn when you first view it, at most three at a
  time, plus one for the session overview after each new turn while the pane
  is open.
- **Earlier turns.** When the lens loads (a resumed session, or the mod
  added mid-session), it rebuilds the last 10 turns already in the
  transcript. Those turns have no timestamp, because the conversation API
  doesn't expose message times. Older turns, and the reply being streamed,
  draw as usual.

## Limits of the mod API this works around

These come from Claude Code's mod API (2.1.293, early access) and shaped the
design. Some may change in later releases.

- **No type size for text.** `Text` and `Markdown` draw at the app's body
  size. Markdown `##`/`###` headings use the app's own small heading styles,
  and `Text` offers only bold, italic, underline, colour and background. The
  only way to draw a larger heading is an `Svg` element, so on the desktop
  every heading here is an SVG image. That costs three things:
  - SVG headings can't be selected or copied.
  - They wrap lines by estimating character width, so a line can break a
    little early or late.
  - They pick light or dark colours from the system setting, which can differ
    from the app's theme.
- **Colours have no light/dark pair outside SVG.** `Text` and `Box` colours
  take a theme name or a fixed hex. The lens uses mid-tone hex values that
  read on both themes, rather than separate shades for each.
- **Rewriting a reply means redrawing it.** To add the callout or replace the
  answer, the mod draws the reply's text itself with `Markdown`. Spacing, the
  reply's opening bullet and code styling can look slightly different from
  replies the app draws.
- **Replies carry no turn id.** A reply is drawn with a message id, and the
  hook that would tie rows to turns (`session.append`) is declared in the
  types but refused at load in this build. The mod matches each reply to its
  turn by text, so two replies that open identically can be matched to the
  wrong turn.
- **The desktop reports neither scroll position nor selection.** In the
  desktop Code tab, replies are drawn without `onScreen`, and
  `$.ui.selection()` answers `undefined`. A pane that follows what you're
  reading is therefore only possible in the fullscreen terminal, so it isn't
  in this version.
- **Render hooks can't start work.** A drawing may read state but not write
  it or call the model, so replies note which digests they're missing and a
  timer fetches them, three at a time.
- **Hotkeys only show on plain buttons.** Buttons drawn as real buttons hide
  their hotkey, so the pane's shortcuts work but aren't labelled.

## Develop

```bash
claude plugin validate mods/lens
```

```bash
claude plugin test mods/lens
```
