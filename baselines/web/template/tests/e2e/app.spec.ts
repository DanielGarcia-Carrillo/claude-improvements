import { paths } from '../../src/constants.ts'
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
