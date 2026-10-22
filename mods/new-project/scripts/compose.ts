/**
 * The text work behind /new-project: checking the answers, renaming a
 * template's placeholders, and writing CLAUDE.md, the stack ADR and the
 * README. No I/O, so the Node script and the mod's tests share it, and only
 * erasable TypeScript, so Node runs it without a build step.
 */

export type Stack = 'web' | 'rust'

export type KickoffAnswer = { question: string; answer: string; assumed?: boolean }
export type ChangedDefault = { area: string; to: string; why: string }
export type ArchitectureLine = { choice: string; line: string }
export type Alternative = { option: string; why: string }

export type Answers = {
  stack: Stack
  /** Display name, as people read it: `Trip Planner`. */
  name: string
  /** Package, Worker and crate name: `trip-planner`. */
  slug: string
  /** Web only: the installed app's label, at most 12 characters. */
  shortName?: string
  /** One sentence: what it is and who uses it. */
  description: string
  /** CLAUDE.md's opening: what it is, who it is for, the one thing it must do well. */
  summary: string
  /** Where issues live, in the words CLAUDE.md uses: `Linear team "Personal", project "Trips"`. */
  issues: string
  /** Who may push, mark ready and merge. */
  merging: string
  /** Rust only: Cargo.toml's `repository`. */
  repository?: string
  /** The ADR's Issue line. */
  issue?: string
  kickoff: KickoffAnswer[]
  changed: ChangedDefault[]
  architecture: ArchitectureLine[]
  alternatives: Alternative[]
  consequences: string
  followUps: string[]
}

export type TemplateFile = {
  /** Relative to the new repo's root, `/`-separated. */
  path: string
  /** Absent for a binary file, which is copied untouched. */
  text?: string
}

export type KickoffSection = { title: string; questions: string[] }
export type Default = { area: string; value: string; why: string }
export type Baseline = { sha?: string; isDirty: boolean }

/**
 * One step of `setup`: a command, or a version bump setup does itself.
 * `isMajor` marks the steps that take new majors, which `--keep-versions`
 * skips.
 *
 * The README's `mise up --bump` upgrades the global config's tools too, and
 * even with `--local` uninstalls each old version, which other projects may
 * use; `mise-tools` rewrites the repo's own pins and installs them instead.
 */
export type Step = { run: readonly string[]; isMajor?: true } | { bump: 'mise-tools' | 'rust-toolchain'; isMajor: true }

/**
 * What each baseline needs here. `install` and `verify` mirror the "Using it"
 * steps of `baselines/<stack>/README.md`; `steps` is the same run, through
 * `mise exec` so the pinned tools win over whatever is on PATH, and after
 * `mise trust`, which a fresh checkout needs before mise reads its config
 * without asking. Majors come before anything is built on the old versions,
 * and Playwright's browsers after them, so they match the Playwright that
 * stays. Before verify, the repo's own formatter lays out what the scaffold
 * wrote once: names longer than the placeholders, and the ADR's tables, which
 * oxfmt pads. `manifests` are the files a major lands in.
 */
export const STACKS = {
  web: {
    shape: 'a client-rendered, offline-capable React PWA on Cloudflare',
    kickoffSection: 'Web apps',
    marker: 'package.json',
    install: 'mise install && pnpm install && pnpm exec playwright install chromium webkit',
    verify: 'pnpm verify',
    manifests: ['mise.toml', 'package.json'],
    steps: [
      { run: ['mise', 'trust'] },
      { run: ['mise', 'install'] },
      { bump: 'mise-tools', isMajor: true },
      { run: ['mise', 'exec', '--', 'pnpm', 'install'] },
      { run: ['mise', 'exec', '--', 'pnpm', 'up', '--latest'], isMajor: true },
      { run: ['mise', 'exec', '--', 'pnpm', 'exec', 'playwright', 'install', 'chromium', 'webkit'] },
      { run: ['mise', 'exec', '--', 'pnpm', 'format'] },
      { run: ['mise', 'exec', '--', 'pnpm', 'verify'] },
    ],
  },
  rust: {
    shape: 'a Rust workspace for a developer tool: a thin binary over a core library',
    kickoffSection: 'Rust tools',
    marker: 'Cargo.toml',
    install: 'mise install && cargo generate-lockfile',
    verify: 'just verify',
    manifests: ['rust-toolchain.toml', 'Cargo.toml'],
    steps: [
      { run: ['mise', 'trust'] },
      { run: ['mise', 'install'] },
      { bump: 'rust-toolchain', isMajor: true },
      { run: ['mise', 'exec', '--', 'cargo', 'generate-lockfile'] },
      // cargo-edit is a one-off here, so mise fetches it without pinning it.
      { run: ['mise', 'exec', 'cargo:cargo-edit@latest', '--', 'cargo', 'upgrade', '--incompatible'], isMajor: true },
      { run: ['mise', 'exec', '--', 'cargo', 'fmt', '--all'] },
      { run: ['mise', 'exec', '--', 'just', 'verify'] },
    ],
  },
} as const satisfies Record<Stack, { steps: readonly Step[]; manifests: readonly string[] } & Record<string, unknown>>

const EVERY_PROJECT = 'Every project'
const SHORT_NAME_MAX = 12
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Every template placeholder spells "replace me". This is the pattern of the
 * templates' CI step "No template placeholders left"
 * (`git grep -niE 'replace[-_ ]?me([^a-z]|$)'`), which skips the workflow
 * that holds it.
 */
export const PLACEHOLDER = /replace[-_ ]?me(?:[^a-z]|$)/i
export const PLACEHOLDER_EXEMPT = '.github/workflows/ci.yml'

// A Rust slug becomes a function name in the CLI test and a crate name, so
// it cannot be a keyword or shadow a sysroot crate.
const RUST_RESERVED = new Set(
  (
    'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move ' +
    'mut pub ref return self static struct super trait true type unsafe use where while abstract become box do final ' +
    'gen macro override priv try typeof unsized virtual yield std core alloc test proc_macro'
  ).split(' '),
)

/** Answers that cannot build a repo, each problem naming its fix. */
export class AnswersError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`The answers need fixing before anything is written:\n${problems.map(p => `- ${p}`).join('\n')}`)
    this.name = 'AnswersError'
    this.problems = problems
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every string in a JSON value, with its path: `kickoff[2].answer`. */
function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`))
  if (isRecord(value))
    return Object.entries(value).flatMap(([key, item]) => strings(item, path === '' ? key : `${path}.${key}`))
  return []
}

/** Parses the answers file, reporting every problem at once. */
export function parseAnswers(raw: unknown): Answers {
  const problems: string[] = []
  if (!isRecord(raw)) throw new AnswersError(['The answers file must hold one JSON object.'])

  const text = (key: string, optional = false): string | undefined => {
    const value = raw[key]
    if (value === undefined && optional) return undefined
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`\`${key}\` must be a non-empty string.`)
      return undefined
    }
    return value.trim()
  }
  const list = <T>(key: string, fields: readonly string[], optional = false): T[] => {
    const value = raw[key]
    if (value === undefined && optional) return []
    if (!Array.isArray(value) || (!optional && value.length === 0)) {
      problems.push(`\`${key}\` must be a non-empty array of { ${fields.join(', ')} }.`)
      return []
    }
    value.forEach((item: unknown, i) => {
      const missing = fields.filter(f => {
        const field = isRecord(item) ? item[f] : undefined
        return typeof field !== 'string' || field.trim() === ''
      })
      if (missing.length > 0) problems.push(`\`${key}[${i}]\` needs ${missing.map(f => `\`${f}\``).join(', ')}.`)
    })
    return value as T[]
  }

  const stack = raw['stack']
  if (stack !== 'web' && stack !== 'rust') problems.push('`stack` must be "web" or "rust".')

  const name = text('name')
  if (name !== undefined && /[<>{}"\\\n]/.test(name))
    problems.push('`name` cannot hold < > { } " \\ or a line break: it lands in HTML, JSX and string literals.')

  const slug = text('slug')
  if (slug !== undefined && (!SLUG.test(slug) || slug.length > 63))
    problems.push(
      `\`slug\` "${slug}" must be lowercase letters and digits joined by single hyphens, starting with a letter, at most 63 characters (a Worker, package and crate name).`,
    )
  if (slug !== undefined && stack === 'rust' && RUST_RESERVED.has(slug.replaceAll('-', '_')))
    problems.push(`\`slug\` "${slug}" is a Rust keyword or sysroot crate; pick another name.`)

  const shortName = text('shortName', true)
  if (shortName !== undefined && (shortName.length > SHORT_NAME_MAX || /[<>{}"\\\n]/.test(shortName)))
    problems.push(`\`shortName\` must be at most ${SHORT_NAME_MAX} characters, without < > { } " or \\.`)

  const description = text('description')
  if (description !== undefined && /[<>\\\n]/.test(description))
    problems.push('`description` is one sentence without < > \\ or a line break: it lands in HTML and the manifest.')

  const summary = text('summary')
  const issues = text('issues')
  const merging = text('merging')
  const issue = text('issue', true)
  const consequences = text('consequences')

  const repository = text('repository', stack !== 'rust')
  if (repository !== undefined && !/^https:\/\/\S+$/.test(repository))
    problems.push('`repository` must be an https URL, such as https://github.com/owner/name.')

  const kickoff = list<KickoffAnswer>('kickoff', ['question', 'answer'])
  const changed = list<ChangedDefault>('changed', ['area', 'to', 'why'], true)
  const architecture = list<ArchitectureLine>('architecture', ['choice', 'line'])
  const alternatives = list<Alternative>('alternatives', ['option', 'why'])
  const followUps = raw['followUps'] ?? []
  if (!Array.isArray(followUps) || followUps.some(f => typeof f !== 'string'))
    problems.push('`followUps` must be an array of strings.')

  // Every answer lands somewhere in the new repo, whose CI fails on anything
  // that reads as a placeholder.
  for (const [key, value] of strings(raw))
    if (PLACEHOLDER.test(value))
      problems.push(`\`${key}\` "${value}" reads as a template placeholder to the new repo's CI; reword it.`)

  if (problems.length > 0) throw new AnswersError(problems)

  return {
    stack: stack as Stack,
    name: name as string,
    slug: slug as string,
    shortName,
    description: description as string,
    summary: summary as string,
    issues: issues as string,
    merging: merging as string,
    repository,
    issue,
    kickoff,
    changed,
    architecture,
    alternatives,
    consequences: consequences as string,
    followUps: followUps as string[],
  }
}

/** The cells of one Markdown table row, `\|` kept inside a cell. */
function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim())
}

const isTableRule = (row: string[]) => row.every(cell => /^:?-+:?$/.test(cell))

/** Every `##` section of kickoff.md that holds a question table. */
export function parseKickoff(markdown: string): KickoffSection[] {
  const sections: KickoffSection[] = []
  let current: KickoffSection | undefined
  for (const line of markdown.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      current = { title: (heading[1] ?? '').trim(), questions: [] }
      sections.push(current)
      continue
    }
    if (current === undefined || !line.startsWith('|')) continue
    const row = cells(line)
    if (isTableRule(row) || row[0] === 'Question' || row[0] === undefined) continue
    current.questions.push(row[0])
  }
  return sections.filter(section => section.questions.length > 0)
}

/** The kickoff sections a stack asks: every project's, then its own. */
export function kickoffFor(sections: readonly KickoffSection[], stack: Stack): KickoffSection[] {
  return [EVERY_PROJECT, STACKS[stack].kickoffSection].map(title => {
    const section = sections.find(s => s.title === title)
    if (section === undefined)
      throw new Error(
        `kickoff.md has no "## ${title}" question table; update STACKS in compose.ts to the section's new name.`,
      )
    return section
  })
}

const normalise = (question: string) =>
  question
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

function findAnswer(answers: readonly KickoffAnswer[], question: string): KickoffAnswer | undefined {
  const key = normalise(question)
  return answers.find(a => normalise(a.question) === key)
}

/** The kickoff questions the answers leave out, as problems. */
export function missingKickoff(answers: Answers, sections: readonly KickoffSection[]): string[] {
  return sections.flatMap(section =>
    section.questions
      .filter(question => findAnswer(answers.kickoff, question) === undefined)
      .map(question => `\`kickoff\` has no answer to "${question}" (${section.title}). Copy the question verbatim.`),
  )
}
