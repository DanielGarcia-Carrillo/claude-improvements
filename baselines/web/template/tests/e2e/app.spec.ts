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
  await home.trackUpdateChecks()
  await home.goto()
  await home.waitForServiceWorker()
  // Going offline mid-check would cut off its policy request, which logs an error.
  await home.waitForUpdateCheck()
  await context.setOffline(true)
  await home.navigateTo('About')
  await page.reload()
  await expect(home.heading).toHaveText('About')
})

// The injected browser code coordinates the offline transition with the test runner.
declare global {
  interface Window {
    disconnectAfterPolicyCheck: () => Promise<void>
    updateCheckResumed: boolean
    workerUpdatesAtDisconnect: number
    requestsAfterWorkerUpdate: number
  }
}

test('stays quiet when the connection drops during an update check', async ({ home, page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright drives service workers in Chromium only')
  await page.exposeFunction('disconnectAfterPolicyCheck', () => context.setOffline(true))
  await home.trackUpdateChecks()
  await page.addInitScript((policyUrl) => {
    window.updateCheckResumed = false
    const fetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await fetch(...args)
      const input = args[0] instanceof Request ? args[0].url : String(args[0])
      if (new URL(input, location.href).pathname !== policyUrl) return response
      // The whole body first: going offline can fail a body still being read.
      const policy = new Response(await response.text(), response)
      // Offline once the policy has arrived, before the check asks for a new worker.
      await window.disconnectAfterPolicyCheck()
      window.workerUpdatesAtDisconnect = window.workerUpdates.started
      const json = policy.json.bind(policy)
      policy.json = async () => {
        const body: unknown = await json()
        // Let the check read the policy and resume before the test continues.
        setTimeout(() => {
          window.updateCheckResumed = true
        }, 0)
        return body
      }
      return policy
    }
  }, UPDATE_POLICY_URL)
  await home.goto()
  await page.waitForFunction(() => window.updateCheckResumed)
  expect(await page.evaluate(() => window.workerUpdates.started - window.workerUpdatesAtDisconnect)).toBe(0)
  await expect(home.heading).toHaveText('Replace Me')
})

// The check's order: the policy first, then update(). A request that reaches
// the old worker while a new one takes over can hold the handover back for
// minutes; UpdatePrompt explains.
test('the update check sends nothing once it has asked for a new worker', async ({ home, page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright drives service workers in Chromium only')
  await home.trackUpdateChecks()
  await page.addInitScript(() => {
    window.requestsAfterWorkerUpdate = 0
    // The policy is the check's one fetch(); none may follow update().
    const fetch = window.fetch.bind(window)
    window.fetch = (...args) => {
      if (window.workerUpdates.started > 0) window.requestsAfterWorkerUpdate++
      return fetch(...args)
    }
  })
  await home.goto()
  await home.waitForUpdateCheck()
  expect(await page.evaluate(() => window.requestsAfterWorkerUpdate)).toBe(0)
})
