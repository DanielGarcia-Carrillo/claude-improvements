import { AxeBuilder } from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'

import { axeDisabledRules, axeTags } from '../axe.ts'
import { HomePage } from './pages/home-page.ts'

interface Fixtures {
  home: HomePage
  /** Fails the test with every WCAG 2.2 A/AA violation on the current page (see tests/axe.ts). */
  expectAccessible: () => Promise<void>
  /** Automatic: fails any test whose pages break the Content-Security-Policy in public/_headers. */
  cspViolations: string[]
  /** Automatic: fails any test whose pages throw an uncaught error or log one to the console. */
  pageErrors: string[]
}

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>
  }
}

/** Every spec imports `test` and `expect` from here, never from @playwright/test. */
export const test = base.extend<Fixtures>({
  home: async ({ page }, use) => {
    await use(new HomePage(page))
  },
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = []
      await page.exposeFunction('reportCspViolation', (violation: string) => {
        violations.push(violation)
      })
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          void window.reportCspViolation?.(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`)
        })
      })
      await use(violations)
      expect(violations, 'Content-Security-Policy violations (see public/_headers)').toEqual([])
    },
    { auto: true },
  ],
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
      })
      await use(errors)
      expect(errors, 'Errors on the page').toEqual([])
    },
    { auto: true },
  ],
  expectAccessible: async ({ page }, use) => {
    await use(async () => {
      const { violations } = await new AxeBuilder({ page }).withTags(axeTags).disableRules(axeDisabledRules).analyze()
      // Compare a summary, not the raw objects: the failure then reads as a
      // list of rule ids and the elements that broke them.
      expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target.join(' ')) }))).toEqual(
        [],
      )
    })
  },
})

export { expect }
