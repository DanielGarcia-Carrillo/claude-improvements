import type { EngineInterface, Register } from 'claude-code'

const SKILL = 'new-project'
// A baselines folder is one that holds this file.
const MARKER = 'general/kickoff.md'

export type Located = { dir: string; source: string; isFound: boolean }

/** `/a/b/../../c` as `/c`; the folder beside the mod is named through `..`. */
export function normalisePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

/**
 * The baselines folder: the `baselines` option when set, else the folder two
 * above the mod, where it sits in claude-improvements. An installed copy of
 * the mod has no such neighbour, so it needs the option. A relative option is
 * refused: it would depend on whichever project the session opened.
 */
export async function locateBaselines($: EngineInterface, configured: string): Promise<Located> {
  let dir: string
  let source: string
  if (configured.trim() === '') {
    dir = normalisePath(`${$.plugin.root}/../../baselines`)
    source = 'the folder beside the mod'
  } else {
    const home = (await $.env.get('HOME')) ?? ''
    const path = configured.trim().replace(/^~(?=\/|$)/, home)
    if (!path.startsWith('/')) {
      return { dir: path, source: 'the `baselines` option (it must be absolute or start with `~/`)', isFound: false }
    }
    dir = normalisePath(path)
    source = 'the `baselines` option'
  }
  return { dir, source, isFound: await $.fs.exists(`${dir}/${MARKER}`) }
}

const isOwnSkill = ($: EngineInterface, skill: string, path: string | undefined) =>
  (skill === SKILL || skill === `${$.plugin.name}:${SKILL}`) &&
  (path === undefined || path.startsWith(`${$.plugin.root}/`))

/**
 * Tells /new-project where the baselines are, or, when they cannot be found,
 * replaces its instructions with how to point the mod at them.
 */
export const register: Register = (on, options) => {
  const baselines = options['baselines']
  const configured = typeof baselines === 'string' ? baselines : ''

  on('skill.prompt', async ($, e, next) => {
    const expanded = await next(e)
    if (!isOwnSkill($, e.skill, e.path)) return expanded

    const located = await locateBaselines($, configured)
    if (!located.isFound) {
      return {
        text: [
          `The new-project mod cannot find the project baselines: ${located.source} is \`${located.dir}\`, which has no \`${MARKER}\`.`,
          '',
          "Do not start the kickoff. Tell the user that, and that the fix is to set the new-project mod's `baselines` option to the `baselines` folder of a claude-improvements checkout (the folder holding `general/kickoff.md`), then run /new-project again.",
        ].join('\n'),
      }
    }
    return { text: `Baselines folder: ${located.dir}\n\n${expanded.text}` }
  })
}
