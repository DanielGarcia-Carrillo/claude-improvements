import { paths } from '../../src/constants.ts'
import { UPDATE_POLICY_URL } from '../../src/lib/update-policy.ts'
import { expect, test } from './fixtures.ts'

test('home shows the day and passes axe', async ({ home, expectAccessible }) => {
  await home.goto()
  await expect(home.heading).toHaveText('Replace Me')
  await expect(home.today).not.toBeEmpty()
  await expectAccessible()
})

test('pages are served with the production headers', async ({ page }) => {
  const response = await page.goto(paths.home)
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
})

test('main navigation reaches every screen', async ({ home, page }) => {
  await home.goto()
  await expect(home.nav).toMatchAriaSnapshot(`
    - navigation "Main":
      - list:
        - listitem:
          - link "Home"
        - listitem:
          - link "About"
  `)
  await home.navigateTo('About')
  await expect(page).toHaveURL(paths.about)
  await expect(home.heading).toHaveText('About')
})

test('opens offline once the service worker is installed', async ({ home, page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright drives service workers in Chromium only')
  await home.goto()
  await home.waitForServiceWorker()
  await context.setOffline(true)
  await home.navigateTo('About')
  await page.reload()
  await expect(home.heading).toHaveText('About')
})

// The injected browser callback coordinates the offline transition with the test runner.
declare global {
  interface Window {
    disconnectAfterWorkerUpdate: () => Promise<void>
    workerUpdateCheckResumed: boolean
    policyRequestsAfterDisconnect: number
  }
}

test('stays quiet when the connection drops during a worker update check', async ({
  home,
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Playwright drives service workers in Chromium only')
  await page.exposeFunction('disconnectAfterWorkerUpdate', () => context.setOffline(true))
  await page.addInitScript((policyUrl) => {
    let disconnected = false
    window.workerUpdateCheckResumed = false
    window.policyRequestsAfterDisconnect = 0
    const fetch = window.fetch.bind(window)
    window.fetch = (...args) => {
      const input = args[0] instanceof Request ? args[0].url : String(args[0])
      if (disconnected && new URL(input, location.href).pathname === policyUrl) window.policyRequestsAfterDisconnect++
      return fetch(...args)
    }
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker)
    navigator.serviceWorker.register = async (...args) => {
      const registration = await register(...args)
      const update = registration.update.bind(registration)
      registration.update = async () => {
        const updated = await update()
        await window.disconnectAfterWorkerUpdate()
        disconnected = true
        // Let update() resolve and its awaiting caller resume before the test continues.
        setTimeout(() => {
          window.workerUpdateCheckResumed = true
        }, 0)
        return updated
      }
      return registration
    }
  }, UPDATE_POLICY_URL)
  await home.goto()
  await page.waitForFunction(() => window.workerUpdateCheckResumed)
  expect(await page.evaluate(() => window.policyRequestsAfterDisconnect)).toBe(0)
  await expect(home.heading).toHaveText('Replace Me')
})
