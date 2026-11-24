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
  /** Automatic, enabled only by test:coverage's isolated instrumented build. */
  coverage: void
}

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>
    reportCoverage?: (data: unknown) => Promise<void>
  }
}

/** Every spec imports `test` and `expect` from here, never from @playwright/test. */
export const test = base.extend<Fixtures>({
  coverage: [
    async ({ page, context }, use) => {
      if (process.env['COVERAGE_BUILD'] !== '1') {
        await use()
        return
      }
      const directory = 'coverage/istanbul'
      await mkdir(directory, { recursive: true })
      const save = async (data: unknown): Promise<void> => {
        if (data !== null && typeof data === 'object' && Object.keys(data).length > 0) {
          await writeFile(`${directory}/${randomUUID()}.json`, JSON.stringify(data))
        }
      }
      await page.exposeFunction('reportCoverage', save)
      await page.addInitScript(() => {
        window.addEventListener('beforeunload', () => {
          void window.reportCoverage?.((globalThis as { __coverage__?: unknown })['__coverage__'])
        })
      })
      await use()
      for (const current of context.pages()) {
        if (!current.isClosed()) {
          await save(await current.evaluate(() => (globalThis as { __coverage__?: unknown })['__coverage__']))
        }
      }
      for (const worker of context.serviceWorkers()) {
        // An update can retire a worker between listing and evaluating it.
        const data = await worker
          .evaluate(() => (globalThis as { __coverage__?: unknown })['__coverage__'])
          .catch(() => undefined)
        await save(data)
      }
    },
    { auto: true },
  ],
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
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
