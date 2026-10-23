import { paths, testIds } from '../../src/constants.ts'
import { expect, test } from './fixtures.ts'

const dir = process.env['SCREENSHOT_DIR']

/** Content that changes on its own, masked so it never counts as a visual change. */
const VOLATILE = [testIds.today]

/**
 * Not a test of behaviour: with SCREENSHOT_DIR set, as CI sets it for PR
 * screenshots, saves every screen at each project's viewport
 * (`<dir>/screens/<screen>--<project>.png`). Skipped otherwise.
 */
test.describe('screens', () => {
  test.skip(!dir, 'Set SCREENSHOT_DIR to capture every screen')
  // Playwright styles the page while capturing (masks, caret), which the CSP
  // would block in WebKit. The other specs run under the CSP.
  test.use({ bypassCSP: true })

  for (const [screen, path] of Object.entries(paths)) {
    test(screen, async ({ page }, testInfo) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.screenshot({
        path: `${dir}/screens/${screen}--${testInfo.project.name}.png`,
        fullPage: true,
        animations: 'disabled',
        mask: VOLATILE.map((id) => page.getByTestId(id)),
      })
    })
  }
})
