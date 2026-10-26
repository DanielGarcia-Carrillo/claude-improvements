import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { defineConfig, devices } from '@playwright/test'

const CI = Boolean(process.env['CI'])

/**
 * Where this run's preview server says it is listening. `webServer.wait`
 * fills it in from the server's own output before any worker starts, and
 * every worker loads this file again, so it is set wherever a page is
 * visited. Never a fixed port: parallel worktrees would each find another
 * checkout's server answering on it and test the wrong build.
 */
const PREVIEW_URL = process.env['PREVIEW_URL']

/** Local runs each get a folder here. The newest finished ones are kept. */
const RUNS = 'test-results'
const KEEP_FINISHED_RUNS = 5

/**
 * This local run's folder, holding all it writes: the build its server
 * serves, test output with traces, and the HTML report. Two runs in one
 * checkout then can't rebuild the app under each other's server or wipe each
 * other's results. Named once, in the main process; workers inherit it
 * through the environment, as they do PREVIEW_URL. CI keeps the usual paths:
 * a job is one run in its own checkout, and ci.yml uploads dist/ and the
 * report from there.
 */
const RUN_DIR = CI ? undefined : (process.env['E2E_RUN_DIR'] ??= newRun())

const dirs =
  RUN_DIR === undefined
    ? { dist: 'dist', results: 'test-results', report: 'playwright-report' }
    : { dist: `${RUN_DIR}/dist`, results: `${RUN_DIR}/results`, report: `${RUN_DIR}/report` }

/**
 * Names a run `<UTC time>-<pid>` and deletes all but the newest few finished
 * runs. A run is finished once the process in its name has exited, so one
 * still going, a long `--ui` session included, keeps its files.
 */
function newRun(): string {
  const root = join(import.meta.dirname, RUNS)
  const finished = (existsSync(root) ? readdirSync(root) : [])
    .filter((name) => {
      const pid = /^\d{8}T\d{6}Z-(\d+)$/.exec(name)?.[1]
      return pid !== undefined && !isRunning(Number(pid))
    })
    .toSorted()
  for (const name of finished.slice(0, -KEEP_FINISHED_RUNS)) rmSync(join(root, name), { recursive: true, force: true })
  return `${RUNS}/${new Date().toISOString().replaceAll(/[-:]|\.\d+/g, '')}-${process.pid}`
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: dirs.results,
  fullyParallel: true,
  // Every core; the default is half. The tests share one static preview server.
  workers: '100%',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [[CI ? 'github' : 'list'], ['html', { open: 'never', outputFolder: dirs.report }]],

  use: {
    baseURL: PREVIEW_URL,
    // Every local test keeps a trace: local runs never retry, so
    // on-first-retry would record none. CI traces only a retried failure.
    trace: CI ? 'on-first-retry' : 'on',
    // Pinned so nothing a test reads depends on the machine running it.
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    serviceWorkers: 'allow',
    // The motion tokens drop to 0s, so no assertion, axe run or screenshot
    // lands mid-transition.
    reducedMotion: 'reduce',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
  ],

  // The production build, so the service worker is the real one. Vite's
  // preview starts at 4173 and moves up past anything listening; 127.0.0.1
  // rather than localhost, where ::1 and 127.0.0.1 can answer the same port.
  webServer: {
    command: `pnpm build --outDir ${dirs.dist} && pnpm exec vite preview --outDir ${dirs.dist} --host 127.0.0.1`,
    wait: { stdout: /Local:\s+(?<preview_url>http:\/\/127\.0\.0\.1:\d+)/ },
    timeout: 120_000,
  },
})
