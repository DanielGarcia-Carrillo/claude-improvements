import type { Locator, Page } from '@playwright/test'

import { paths } from '../../../src/constants.ts'

declare global {
  interface Window {
    /** The `registration.update()` calls made on this page, and how many have settled (trackUpdateChecks). */
    workerUpdates: { started: number; settled: number }
  }
}

/**
 * The shell every screen shares. Page objects expose locators and
 * intent-level actions; assertions stay in the specs.
 */
export class AppPage {
  protected readonly page: Page
  readonly nav: Locator
  readonly heading: Locator

  constructor(page: Page) {
    this.page = page
    this.nav = page.getByRole('navigation', { name: 'Main' })
    this.heading = page.getByRole('heading', { level: 1 })
  }

  navigateTo(name: string): Promise<void> {
    return this.nav.getByRole('link', { name }).click()
  }

  /**
   * Call before the page loads, so waitForUpdateCheck can see the app's
   * update check end. The check (UpdatePrompt) ends with
   * `registration.update()`, which leaves nothing in the page to wait on, so
   * this counts the calls in `window.workerUpdates`.
   */
  async trackUpdateChecks(): Promise<void> {
    await this.page.addInitScript(() => {
      const workerUpdates = { started: 0, settled: 0 }
      window.workerUpdates = workerUpdates
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker)
      navigator.serviceWorker.register = async (...args) => {
        const registration = await register(...args)
        const update = registration.update.bind(registration)
        registration.update = () => {
          workerUpdates.started++
          // A macrotask later, so the caller's own continuation has run too.
          return update().finally(() => setTimeout(() => workerUpdates.settled++, 0))
        }
        return registration
      }
    })
  }

  /**
   * Waits until the app's first update check on this page has ended (see
   * trackUpdateChecks). A test that changes the network or the deploy waits
   * for it first; otherwise the check runs into the change: a request cut off
   * by going offline logs an error, and an update() that runs after the test
   * deploys another build installs that build before the test reloads.
   */
  async waitForUpdateCheck(): Promise<void> {
    await this.page.waitForFunction(() => window.workerUpdates.settled > 0)
  }

  /** Waits until the service worker controls the page, so reloads are served offline. */
  async waitForServiceWorker(): Promise<void> {
    await this.page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (navigator.serviceWorker.controller) return
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      )
    })
  }

  protected async open(path: (typeof paths)[keyof typeof paths]): Promise<void> {
    await this.page.goto(path)
  }
}
