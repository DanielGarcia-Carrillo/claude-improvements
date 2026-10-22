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

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Every core; the default is half. The tests share one static preview server.
  workers: '100%',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [[CI ? 'github' : 'list'], ['html', { open: 'never' }]],

  use: {
    baseURL: PREVIEW_URL,
    trace: 'on-first-retry',
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
    command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1',
    wait: { stdout: /Local:\s+(?<preview_url>http:\/\/127\.0\.0\.1:\d+)/ },
    timeout: 120_000,
  },
})
