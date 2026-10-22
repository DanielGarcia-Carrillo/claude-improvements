import type { Locator, Page } from '@playwright/test'

import { paths } from '../../../src/constants.ts'

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
