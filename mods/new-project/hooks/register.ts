import type { EngineInterface, Register } from 'claude-code'

const SKILL = 'new-project'
// A baselines folder is one that holds this file.
const MARKER = 'general/kickoff.md'

export type Located = { dir: string; source: string; isFound: boolean }

/**
 * The folder the `baselines` option names, `~` expanded. A relative option
 * is refused: it would depend on whichever project the session opened.
 */
export async function locateBaselines($: EngineInterface, configured: string): Promise<Located> {
  const home = (await $.env.get('HOME')) ?? ''
  const dir = configured
    .trim()
    .replace(/^~(?=\/|$)/, home)
    .replace(/(?<=.)\/+$/, '')
  if (!dir.startsWith('/'))
    return { dir, source: 'the `baselines` option (it must be absolute or start with `~/`)', isFound: false }
  return { dir, source: 'the `baselines` option', isFound: await $.fs.exists(`${dir}/${MARKER}`) }
}

const isOwnSkill = ($: EngineInterface, skill: string, path: string | undefined) =>
  (skill === SKILL || skill === `${$.plugin.name}:${SKILL}`) &&
  (path === undefined || path.startsWith(`${$.plugin.root}/`))

/**
 * Hands /new-project the folder the mod's `baselines` option names. With the
 * option empty it adds nothing: the skill's doctor step finds the baselines
 * itself (`$NEW_PROJECT_BASELINES`, else the checkout its script is in), so
 * a session in any worktree uses that worktree's baselines.
 */
export const register: Register = (on, options) => {
  const baselines = options['baselines']
  const configured = typeof baselines === 'string' ? baselines : ''

  on('skill.prompt', async ($, e, next) => {
    const expanded = await next(e)
    if (!isOwnSkill($, e.skill, e.path) || configured.trim() === '') return expanded

    const located = await locateBaselines($, configured)
    const note = located.isFound
      ? `Baselines folder: ${located.dir}`
      : `The new-project mod cannot use ${located.source}: \`${located.dir}\` has no \`${MARKER}\`. Run doctor without \`--baselines\`. If it can't find them either, tell the user to set the option to the \`baselines\` folder of a claude-improvements checkout.`
    return { text: `${note}\n\n${expanded.text}` }
  })
}
