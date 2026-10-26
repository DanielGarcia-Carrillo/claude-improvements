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
 * steps of `baselines/<stack>/README.md`; `steps` is the same run, with its
 * pnpm, cargo and just commands through `mise exec` so the pinned tools win
 * over whatever is on PATH, and after
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

// A TOML table heading, and a mise.toml `[tools]` line pinned to a version number.
const TOML_TABLE = /^\s*\[([^\]]+)\]/
const MISE_PIN = /^(\s*"?([^"=\s]+)"?\s*=\s*)"(\d+(?:\.\d+)*)"(.*)$/

/** Each line of a mise.toml, with its pin when it is one under `[tools]`. */
function miseLines(text: string) {
  let isTools = false
  return text.split('\n').map(line => {
    const table = TOML_TABLE.exec(line)
    if (table) isTools = table[1]?.trim() === 'tools'
    const [, prefix = '', tool = '', version = '', rest = ''] = (isTools && MISE_PIN.exec(line)) || []
    return { line, pin: tool === '' ? undefined : { prefix, tool, version, rest } }
  })
}

/** The tools a mise.toml pins to a version number: `node = "26"`. */
export function misePins(text: string): { tool: string; version: string }[] {
  return miseLines(text).flatMap(({ pin }) => (pin === undefined ? [] : [{ tool: pin.tool, version: pin.version }]))
}

/**
 * The mise.toml with each pin moved to its tool's latest release, at the
 * pin's own precision, as `mise up --bump` writes it: `26` stays a major.
 */
export function bumpMiseToml(text: string, latest: Readonly<Record<string, string>>): string {
  return miseLines(text)
    .map(({ line, pin }) => {
      const release = pin === undefined ? undefined : latest[pin.tool]
      if (pin === undefined || release === undefined) return line
      const bumped = release.split('.').slice(0, pin.version.split('.').length).join('.')
      return `${pin.prefix}"${bumped}"${pin.rest}`
    })
    .join('\n')
}

/** Where rustup's stable channel says which release it is. */
export const RUST_STABLE_MANIFEST = 'https://static.rust-lang.org/dist/channel-rust-stable.toml'

/** The release the stable channel manifest names: `1.99.1`. */
export function rustStableVersion(manifest: string): string {
  const version = /^\[pkg\.rust\]\nversion = "(\d+\.\d+\.\d+) /m.exec(manifest)?.[1]
  if (version === undefined) throw new Error(`${RUST_STABLE_MANIFEST} has no [pkg.rust] version; has its format changed?`)
  return version
}

/**
 * The `key = "…"` line of a TOML file's `[table]`, if it has one: its value,
 * and the file with that line set to another.
 */
function tomlString(text: string, table: string, key: string) {
  const line = new RegExp(`^${key} = "([^"]*)"`)
  const lines = text.split('\n')
  let current: string | undefined
  const at = lines.findIndex(row => {
    current = TOML_TABLE.exec(row)?.[1]?.trim() ?? current
    return current === table && line.test(row)
  })
  const value = line.exec(lines[at] ?? '')?.[1]
  if (value === undefined) return undefined
  const set = (next: string) => lines.map((row, i) => (i === at ? row.replace(line, `${key} = "${next}"`) : row)).join('\n')
  return { value, set }
}

/**
 * Pins the toolchain file's channel to `version`. The project's
 * `rust-version` moves to its minor only while it equals the old channel's:
 * a binary-only tool's MSRV is the pinned channel, but an older one, such as
 * a published library's, was set on purpose and stays. That MSRV is the one
 * in `[workspace.package]`, which members inherit, else a single crate's in
 * `[package]`; a root package beside a workspace MSRV keeps its own. Throws
 * when either line has moved, so a bump never half lands.
 */
export function pinRust(files: { toolchain: string; cargo: string }, version: string) {
  const minor = (release: string) => release.split('.').slice(0, 2).join('.')
  const missing = (file: string, key: string, tables: string) =>
    new Error(`${file} has no \`${key} = "…"\` line in ${tables} to bump.`)
  const channel = tomlString(files.toolchain, 'toolchain', 'channel')
  if (channel === undefined) throw missing('rust-toolchain.toml', 'channel', '[toolchain]')
  const msrv =
    tomlString(files.cargo, 'workspace.package', 'rust-version') ?? tomlString(files.cargo, 'package', 'rust-version')
  if (msrv === undefined) throw missing('Cargo.toml', 'rust-version', '[workspace.package] or [package]')
  return {
    toolchain: channel.set(version),
    cargo: msrv.value === minor(channel.value) ? msrv.set(minor(version)) : files.cargo,
  }
}

/** The lines a step changed in a file, `-` before and `+` after, for undoing one major. */
export function changedLines(before: string, after: string): string[] {
  const old = before.split('\n')
  const now = after.split('\n')
  return [
    ...old.filter(line => !now.includes(line)).map(line => `- ${line.trim()}`),
    ...now.filter(line => !old.includes(line)).map(line => `+ ${line.trim()}`),
  ]
}

const EVERY_PROJECT = 'Every project'
const SHORT_NAME_MAX = 12
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Every template placeholder spells "replace me". This is the pattern of the
 * templates' CI step "No template placeholders left"
 * (`git grep -niE 'replace[-_ ]?me([^a-z]|$)'`), which skips the workflow
 * that holds it.
 */
export const PLACEHOLDER = /replace[-_ ]?me(?:[^a-z]|$)/i
export const PLACEHOLDER_EXEMPT = '.github/workflows/ci.yml'
/** The one line of PLACEHOLDER_EXEMPT that spells the placeholder: the comment naming what its step looks for. */
const PLACEHOLDER_EXEMPT_LINE = /^\s*# Template placeholders all spell "replace me"/

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
  if (name !== undefined && /[<>{}"\\\r\n]/.test(name))
    problems.push('`name` cannot hold < > { } " \\ or a line break: it lands in HTML, JSX and string literals.')

  const slug = text('slug')
  if (slug !== undefined && (!SLUG.test(slug) || slug.length > 63))
    problems.push(
      `\`slug\` "${slug}" must be lowercase letters and digits joined by single hyphens, starting with a letter, at most 63 characters (a Worker, package and crate name).`,
    )
  if (slug !== undefined && stack === 'rust' && RUST_RESERVED.has(slug.replaceAll('-', '_')))
    problems.push(`\`slug\` "${slug}" is a Rust keyword or sysroot crate; pick another name.`)

  const shortName = text('shortName', true)
  if (shortName !== undefined && (shortName.length > SHORT_NAME_MAX || /[<>{}"\\\r\n]/.test(shortName)))
    problems.push(`\`shortName\` must be at most ${SHORT_NAME_MAX} characters, without < > { } " or \\.`)

  const description = text('description')
  if (description !== undefined && /[<>\\\r\n]/.test(description))
    problems.push('`description` is one sentence without < > \\ or a line break: it lands in HTML and the manifest.')

  const summary = text('summary')
  const issues = text('issues')
  const merging = text('merging')
  const issue = text('issue', true)
  const consequences = text('consequences')

  const repository = text('repository', stack !== 'rust')
  // URL characters only: the value lands inside a quoted TOML string. They
  // also spell non-URLs such as `https://?`, so it must parse, with a host.
  const isUrl = (url: string) =>
    /^https:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+$/.test(url) && URL.canParse(url) && new URL(url).hostname !== ''
  if (repository !== undefined && !isUrl(repository))
    problems.push('`repository` must be an https URL with a host, such as https://github.com/owner/name, without quotes, backslashes or spaces.')

  const kickoff = list<KickoffAnswer>('kickoff', ['question', 'answer'])
  const changed = list<ChangedDefault>('changed', ['area', 'to', 'why'], true)
  // The ADR has one row per area, so a second change to one would drop out
  // of it. `list` hands back the malformed items it reported, too.
  const areas = changed.map(change => (isRecord(change) ? change['area'] : undefined))
  areas.forEach((area, i) => {
    const first = areas.indexOf(area)
    if (typeof area === 'string' && first < i)
      problems.push(`\`changed[${i}]\` names area "${area}" again; merge it into \`changed[${first}]\`.`)
  })
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

/** `[text](target)` becomes `text` unless the target is a full URL, which survives a copy. */
const keepAbsoluteLinks = (markdown: string) =>
  markdown.replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1')

/** The defaults table of a stack README: the first table headed `| Area | Default |`. */
export function parseDefaults(readme: string): Default[] {
  const lines = readme.split('\n')
  const start = lines.findIndex(line => {
    const row = cells(line)
    return line.startsWith('|') && row[0] === 'Area' && row[1] === 'Default'
  })
  if (start < 0) throw new Error('The stack README has no "| Area | Default |" table to record in the ADR.')

  const defaults: Default[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('|')) break
    const row = cells(line)
    if (isTableRule(row)) continue
    const [area = '', value = '', why = ''] = row
    defaults.push({ area: keepAbsoluteLinks(area), value: keepAbsoluteLinks(value), why: keepAbsoluteLinks(why) })
  }
  return defaults
}

/** Changed defaults that name no area of the stack's table, as problems. */
export function unknownAreas(answers: Answers, defaults: readonly Default[]): string[] {
  const areas = defaults.map(d => d.area)
  return answers.changed
    .filter(change => !areas.includes(change.area))
    .map(change => `\`changed\` names area "${change.area}", which is not one of: ${areas.join(', ')}.`)
}

export function defaultShortName(name: string): string {
  if (name.length <= SHORT_NAME_MAX) return name
  return (name.split(/\s+/)[0] ?? name).slice(0, SHORT_NAME_MAX)
}

/** A string literal as oxfmt writes it: single quotes unless the text holds more of them than double. */
export function tsString(value: string): string {
  const singles = value.split("'").length - 1
  const doubles = value.split('"').length - 1
  const quote = singles > doubles ? '"' : "'"
  return `${quote}${value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`
}

const htmlText = (value: string) => value.replaceAll('&', '&amp;')
const htmlAttribute = (value: string) => htmlText(value).replaceAll('"', '&quot;')

/** The web template's placeholders, as `baselines/web/README.md` lists them. */
const WEB = {
  slug: 'replace-me',
  name: 'Replace Me',
  shortName: 'ReplaceMe',
  description: 'Replace me: a one-line description',
}

/** The Rust template's placeholders, as `baselines/rust/README.md` lists them. */
const RUST = {
  slug: 'replace-me',
  snake: 'replace_me',
  repository: 'https://github.com/replace-me-owner/replace-me',
}

// The renames here replace through functions: a replacement string would
// expand an answer's `$&`, `$'` or `$$`.
function renameWeb(file: TemplateFile, answers: Answers): TemplateFile {
  if (file.text === undefined) return file
  const shortName = answers.shortName ?? defaultShortName(answers.name)
  let text = file.text
  if (/\.[cm]?tsx?$/.test(file.path)) {
    text = text
      .replaceAll(`'${WEB.description}'`, () => tsString(answers.description))
      .replaceAll(`'${WEB.shortName}'`, () => tsString(shortName))
      .replaceAll(`'${WEB.name}'`, () => tsString(answers.name))
      .replaceAll(`>${WEB.name}<`, () => `>${htmlText(answers.name)}<`)
  } else if (file.path.endsWith('.html')) {
    text = text
      .replaceAll(`>${WEB.name}<`, () => `>${htmlText(answers.name)}<`)
      .replaceAll(`"${WEB.description}"`, () => `"${htmlAttribute(answers.description)}"`)
  } else if (/\.jsonc?$/.test(file.path)) {
    text = text.replaceAll(`"${WEB.slug}"`, () => JSON.stringify(answers.slug))
  }
  return { ...file, text }
}

function renameRust(file: TemplateFile, answers: Answers): TemplateFile {
  const path = file.path
    .split('/')
    .map(segment =>
      segment === RUST.slug || segment.startsWith(`${RUST.slug}-`)
        ? `${answers.slug}${segment.slice(RUST.slug.length)}`
        : segment,
    )
    .join('/')
  if (file.text === undefined) return { ...file, path }

  // `replace_me` is an identifier (`replace_me_core`, the CLI test's
  // `replace_me()`); `replace-me` is a crate's or the binary's name.
  const text = file.text
    .replaceAll(RUST.repository, () => answers.repository ?? '')
    .replaceAll(RUST.snake, () => answers.slug.replaceAll('-', '_'))
    .replaceAll(RUST.slug, () => answers.slug)
  return { path, text }
}

/** Renames one template file's path and placeholders for the answers' stack. */
export function renameFile(file: TemplateFile, answers: Answers): TemplateFile {
  return answers.stack === 'web' ? renameWeb(file, answers) : renameRust(file, answers)
}

/**
 * Placeholders a rename left behind, as problems: what the new repo's CI
 * would fail on, plus paths, which it does not read. parseAnswers refuses an
 * answer that matches, so each one is a use the rename rules here miss.
 */
export function leftoverPlaceholders(files: readonly TemplateFile[]): string[] {
  const teach = 'teach renameFile in compose.ts this use'
  const isExempt = (path: string, line: string) => path === PLACEHOLDER_EXEMPT && PLACEHOLDER_EXEMPT_LINE.test(line)
  return files.flatMap(file => [
    ...(PLACEHOLDER.test(file.path) ? [`${file.path}: the path still holds a template placeholder; ${teach}.`] : []),
    ...(file.text ?? '')
      .split('\n')
      .flatMap((line, i) =>
        PLACEHOLDER.test(line) && !isExempt(file.path, line)
          ? [`${file.path}:${i + 1} still holds a template placeholder: ${line.trim()} (${teach})`]
          : [],
      ),
  ])
}

const COMMENT = /<!--[\s\S]*?-->\n*/g

/** The `##` sections of a stack fragment, by heading, comments dropped. */
function fragmentSections(fragment: string): Map<string, string> {
  const sections = new Map<string, string>()
  let heading: string | undefined
  let body: string[] = []
  const flush = () => {
    if (heading === undefined) return
    if (sections.has(heading)) throw new Error(`The stack fragment has two "## ${heading}" sections; merge them.`)
    sections.set(heading, body.join('\n').trim())
  }
  for (const line of fragment.replace(COMMENT, '').split('\n')) {
    const match = /^## (.+)$/.exec(line)
    if (match) {
      flush()
      heading = (match[1] ?? '').trim()
      body = []
    } else body.push(line)
  }
  flush()
  return sections
}

/** `<placeholder>`s outside code and comments. */
function unfilled(markdown: string): string[] {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  return [...prose.matchAll(/<[^<>\n]+>/g)].map(match => match[0])
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * CLAUDE.md: the general skeleton with the stack fragment spliced in at its
 * markers and every placeholder filled from the answers. Throws when the
 * skeleton or fragment no longer has a marker or placeholder this expects.
 */
export function composeAgentFile(template: string, fragment: string, answers: Answers): string {
  const stack = STACKS[answers.stack]
  const renamed = answers.stack === 'rust' ? (renameRust({ path: '', text: fragment }, answers).text ?? '') : fragment
  const sections = fragmentSections(renamed)
  const used = new Set<string>()

  // The skeleton opens with instructions for whoever fills it in.
  let text = template.replace(/^<!--[\s\S]*?-->\n*/, '')
  text = text.replace(/<!-- stack fragment: ([^>]+?) -->/g, (_marker, name: string) => {
    const body = sections.get(name)
    if (body === undefined) throw new Error(`The stack fragment has no "## ${name}" section for CLAUDE.template.md's marker.`)
    used.add(name)
    return body
  })
  const unused = [...sections.keys()].filter(name => !used.has(name))
  if (unused.length > 0)
    throw new Error(`CLAUDE.template.md has no marker for the stack fragment's sections: ${unused.join(', ')}.`)

  const architecture = answers.architecture
    .map(({ choice, line }) => `- ${choice}: ${sentence(line)} [ADR 0001](docs/adr/0001-stack.md)`)
    .join('\n')
  const fills: [string, string][] = [
    ['<Project name>', answers.name],
    ['<One paragraph: what it is, who it is for, the one thing it must do well.>', answers.summary],
    ['`<verify command>`', `\`${stack.verify}\``],
    ['<Linear team "X", project "Y" | GitHub Issues>', answers.issues],
    ['<Who may push, mark ready and merge.>', sentence(answers.merging)],
    ['- <Choice>: <one line>. [ADR 0001](docs/adr/0001-stack.md)', architecture],
  ]
  for (const [placeholder, value] of fills) {
    if (!text.includes(placeholder))
      throw new Error(`CLAUDE.template.md no longer holds ${placeholder}; update the fills in composeAgentFile.`)
    text = text.replaceAll(placeholder, () => value)
  }

  const left = unfilled(text)
  if (left.length > 0) throw new Error(`CLAUDE.md still has placeholders: ${left.join(', ')}.`)
  return `${text.replace(/\n{3,}/g, '\n\n').trim()}\n`
}

const cell = (text: string) => text.replace(/\s*\n\s*/g, ' ').replaceAll(/(?<!\\)\|/g, '\\|')

/** `docs/adr/0001-stack.md`: the kickoff answers and every default kept or changed. */
export function renderAdr(
  answers: Answers,
  input: { date: string; kickoff: readonly KickoffSection[]; defaults: readonly Default[]; baseline: Baseline },
): string {
  if (!DATE.test(input.date)) throw new Error(`The ADR date "${input.date}" is not YYYY-MM-DD.`)
  // A change to an area outside the table would have no row to land in.
  const unknown = unknownAreas(answers, input.defaults)
  if (unknown.length > 0) throw new AnswersError(unknown)
  const stack = STACKS[answers.stack]

  const asked = input.kickoff.flatMap(section => section.questions)
  const extra = answers.kickoff.filter(a => !asked.some(q => normalise(q) === normalise(a.question)))
  const rows = [
    ...asked.map(question => ({ question, found: findAnswer(answers.kickoff, question) })),
    ...extra.map(found => ({ question: found.question, found })),
  ].map(({ question, found }) => {
    const answer = found === undefined ? 'Not asked' : `${found.answer}${found.assumed === true ? ' (assumed)' : ''}`
    return `| ${cell(question)} | ${cell(answer)} |`
  })

  const defaults = input.defaults.map(d => {
    const change = answers.changed.find(c => c.area === d.area)
    const here = change === undefined ? 'Kept' : `Changed: ${sentence(change.to)} ${sentence(change.why)}`
    return `| ${cell(d.area)} | ${cell(d.value)} | ${cell(d.why)} | ${cell(here)} |`
  })

  const source = [
    `\`baselines/${answers.stack}\``,
    input.baseline.sha === undefined ? undefined : `at \`${input.baseline.sha}\``,
    input.baseline.isDirty ? 'with uncommitted changes' : undefined,
  ]
    .filter(part => part !== undefined)
    .join(' ')

  const followUps =
    answers.followUps.length === 0
      ? []
      : ['', 'Follow-ups this leaves:', '', ...answers.followUps.map(f => `- ${sentence(f)}`)]

  return [
    `# 0001. Stack: the ${answers.stack} baseline`,
    '',
    '- Status: accepted',
    `- Date: ${input.date}`,
    `- Issue: ${answers.issue ?? 'none'}`,
    '',
    '## Context',
    '',
    answers.summary,
    '',
    'The kickoff questions, answered when the repository was created. "(assumed)" marks a default taken without asking.',
    '',
    '| Question | Answer |',
    '| --- | --- |',
    ...rows,
    '',
    '## Decision',
    '',
    `Start from the ${answers.stack} baseline in claude-improvements (${source}): ${stack.shape}. \`${stack.verify}\` is the gate. Its defaults, and what this repo did with each:`,
    '',
    '| Area | Default | Why | Here |',
    '| --- | --- | --- | --- |',
    ...defaults,
    '',
    '## Alternatives considered',
    '',
    ...answers.alternatives.map(a => `- **${a.option}**: ${sentence(a.why)}`),
    '',
    '## Consequences',
    '',
    answers.consequences,
    ...followUps,
    '',
  ].join('\n')
}

/** A README for people: what it is, and how to get a working checkout. */
export function renderReadme(answers: Answers): string {
  const stack = STACKS[answers.stack]
  return [
    `# ${answers.name}`,
    '',
    sentence(answers.description),
    '',
    '## Develop',
    '',
    'Set up once (tools come from `mise.toml`):',
    '',
    '```bash',
    stack.install,
    '```',
    '',
    `Then \`${stack.verify}\` runs every check CI runs. [CLAUDE.md](CLAUDE.md) has the commands and conventions, and [docs/adr](docs/adr/README.md) the decisions behind them.`,
    '',
  ].join('\n')
}
