/**
 * The part of Claude Code's plugin API this mod uses, for `pnpm typecheck`.
 *
 * The engine writes the whole API beside a mod it loads, as
 * .claude-plugin/types/ with a tsconfig.json over hooks/, types/ and tests/,
 * which git ignores; a fresh checkout has neither. The shapes here are that
 * file's, cut to the calls register.ts and its tests make. Keep this file
 * outside those three folders: beside the whole API it would declare each
 * name twice.
 */

declare module 'claude-code' {
  /** The plugin's `userConfig` values, as `register` receives them. */
  export type PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>

  /** A skill's prompt as it expands: typed as `/name`, called through the Skill tool, or preloaded. */
  export type SkillPromptInput = {
    /** Which skill: `new-project`, or `plugin:new-project`. */
    skill: string
    /** The prompt's text as the skill computed it. */
    text: string
    /** The skill's file; an inline command has none. */
    path?: string
  }

  /** The text the model reads for the skill. */
  export type SkillPromptResult = { text: string }

  /** `$`: the engine's calls this mod makes. */
  export interface EngineInterface {
    /** This plugin, as loaded: its manifest name and its directory, absolute. */
    plugin: { name: string; root: string }
    env: { get: (name: string) => Promise<string | undefined> }
    fs: { exists: (path: string) => Promise<boolean> }
    skill: { prompt: (input: SkillPromptInput) => Promise<SkillPromptResult> }
  }

  /** Each event this mod hooks or its tests answer: its input, and what a hook resolves. */
  type Events = {
    'skill.prompt': { input: SkillPromptInput; result: SkillPromptResult }
    'fs.exists': { input: { path: string }; result: { value: boolean } }
    'env.get': { input: { name: string }; result: { value: string | undefined } }
  }

  /** Registers `hook` on one event; `next(e)` runs the hooks beneath it. */
  export type On = <N extends keyof Events>(
    event: N,
    hook: (
      $: EngineInterface,
      e: Events[N]['input'],
      next: (e: Events[N]['input']) => Promise<Events[N]['result']>,
    ) => Events[N]['result'] | Promise<Events[N]['result']>,
  ) => unknown

  /** A hooks module's entry point. */
  export type Register = (on: On, options: PluginOptions) => unknown
}

declare module 'claude-code/testing' {
  import type { EngineInterface, On, PluginOptions } from 'claude-code'

  /** A test's body: the engine's `$`, and an `on` whose hooks sit beneath every plugin. */
  export type TestBody = ($: EngineInterface, on: On) => unknown
  /** `options`: the plugin under test's `userConfig` values. */
  export type TestOptions = { timeoutMs?: number; options?: PluginOptions }
  export const test: (
    name: string,
    ...rest: readonly [body: TestBody] | readonly [options: TestOptions, body: TestBody]
  ) => void

  export type Matchers = {
    toBe: (expected: unknown) => void
    toEqual: (expected: unknown) => void
    toContain: (expected: unknown) => void
    toThrow: (expected?: string | RegExp) => void
  }
  export const expect: (received: unknown) => Matchers
}
