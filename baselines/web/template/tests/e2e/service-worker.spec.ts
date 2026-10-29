/**
 * The service worker's ways out of a bad deploy (the web README's "Service
 * worker emergencies"): a forced update, and the kill switch. Each test
 * installs the run's build, deploys another at the same origin, and checks
 * what the open page ends up running.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { UPDATE_POLICY_URL } from '../../src/lib/update-policy.ts'
import { expect, test } from './fixtures.ts'
import { HomePage } from './pages/home-page.ts'
import { SwitchableSite } from './switchable-site.ts'

// Building two more versions of the app takes a while, so these tests share
// them and run in order in one worker.
test.describe.configure({ mode: 'serial' })
test.skip(({ browserName }) => browserName !== 'chromium', 'Playwright drives service workers in Chromium only')

/** The build this run's preview serves (playwright.config.ts). */
const CURRENT = process.env['E2E_RUN_DIR'] === undefined ? 'dist' : join(process.env['E2E_RUN_DIR'], 'dist')

let scratch: string
let builds: { current: string; next: string; killSwitch: string }
let site: SwitchableSite

/** A build of the app into a folder of its own, the kill switch when asked. */
function build(name: string, env: Record<string, string> = {}): string {
  const outDir = join(scratch, name)
  execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
  return outDir
}

/** The entry script a build's shell loads; its hash tells the builds apart. */
const entryOf = (dir: string) =>
  /<script type="module"[^>]*src="([^"]+)"/.exec(readFileSync(join(dir, 'index.html'), 'utf8'))?.[1]

/** The entry script the page runs; undefined while a forced reload is under way. */
const runningEntry = (page: Page) =>
  page.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute('src')).catch(() => undefined)

const setPolicy = (dir: string, forceUpdateBefore: string | null) =>
  writeFileSync(join(dir, UPDATE_POLICY_URL), `${JSON.stringify({ forceUpdateBefore })}\n`)

test.beforeAll(async ({ browserName }) => {
  if (browserName !== 'chromium') return
  test.setTimeout(240_000)
  scratch = mkdtempSync(join(tmpdir(), 'sw-emergency-'))
  // A copy, so a policy written for a test never lands in the preview's build.
  builds = {
    current: join(scratch, 'current'),
    next: build('next'),
    killSwitch: build('kill-switch', { SW_KILL_SWITCH: '1' }),
  }
  cpSync(CURRENT, builds.current, { recursive: true })
  expect(entryOf(builds.next), 'the next build loads a different entry').not.toBe(entryOf(builds.current))
  site = await SwitchableSite.start(builds.current)
})

test.afterAll(async () => {
  await site?.close()
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true })
})

/** Opens the current build and waits until its worker controls the page. */
async function installCurrent(page: Page): Promise<void> {
  setPolicy(builds.current, null)
  site.serve(builds.current)
  await page.goto(`${site.url}/`)
  await new HomePage(page).waitForServiceWorker()
  expect(await runningEntry(page)).toBe(entryOf(builds.current))
}

test('a new deploy waits for the user to accept it', async ({ page }) => {
  await installCurrent(page)
  setPolicy(builds.next, null)
  site.serve(builds.next)
  await page.reload()

  await expect(page.getByRole('status')).toContainText('A new version is available.')
  expect(await runningEntry(page)).toBe(entryOf(builds.current))
})

test('update-policy.json makes an older build take the new deploy without asking', async ({ page }) => {
  await installCurrent(page)
  // Every build made before now, which is the current one but not next.
  setPolicy(builds.next, new Date().toISOString())
  site.serve(builds.next)
  await page.reload()

  await expect.poll(() => runningEntry(page), { timeout: 15_000 }).toBe(entryOf(builds.next))
  await expect(page.getByRole('status')).not.toContainText('A new version is available.')
})

test('the kill switch removes the worker and its caches, and the app loads from the network', async ({ page }) => {
  await installCurrent(page)
  site.serve(builds.killSwitch)
  // The browser checks /sw.js on this navigation, whatever the page does.
  await page.reload()

  const state = () =>
    page
      .evaluate(async () => ({
        workers: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).length,
        controlled: navigator.serviceWorker.controller !== null,
      }))
      // The kill switch reloads the page under the test's feet.
      .catch(() => undefined)
  await expect.poll(state, { timeout: 15_000 }).toEqual({ workers: 0, caches: 0, controlled: false })
  expect(await runningEntry(page)).toBe(entryOf(builds.killSwitch))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The kill-switch page registers nothing, so nothing comes back.
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await state()).toEqual({ workers: 0, caches: 0, controlled: false })
})
