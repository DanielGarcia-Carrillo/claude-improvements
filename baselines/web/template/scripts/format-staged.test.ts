import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('format-staged.ts', import.meta.url))
const MODULES = fileURLToPath(new URL('../node_modules', import.meta.url))
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'format-staged-'))
  writeFileSync(join(root, 'package.json'), '{"private":true}\n')
  writeFileSync(join(root, '.oxfmtrc.json'), '{"semi":false}\n')
  symlinkSync(MODULES, join(root, 'node_modules'), 'dir')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function format(...paths: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...paths], { cwd: root, encoding: 'utf8' })
}

it('formats literal leading ! and - paths with spaces without touching other files', () => {
  for (const path of ['!staged file.ts', '-staged file.ts', 'untouched.ts']) {
    writeFileSync(join(root, path), 'export const value={answer:42}\n')
  }
  const before = readFileSync(join(root, 'untouched.ts'), 'utf8')
  const result = format('!staged file.ts', '-staged file.ts')
  expect(result.status).toBe(0)
  for (const path of ['!staged file.ts', '-staged file.ts']) {
    expect(readFileSync(join(root, path), 'utf8')).toBe('export const value = { answer: 42 }\n')
  }
  expect(readFileSync(join(root, 'untouched.ts'), 'utf8')).toBe(before)
})

it('does nothing with an empty path list', () => {
  const content = 'export const value={answer:42}\n'
  writeFileSync(join(root, 'untouched.ts'), content)
  expect(format().status).toBe(0)
  expect(readFileSync(join(root, 'untouched.ts'), 'utf8')).toBe(content)
})

it('refuses syntax errors', () => {
  writeFileSync(join(root, '!broken.ts'), 'export const =\n')
  expect(format('!broken.ts').status).not.toBe(0)
})
