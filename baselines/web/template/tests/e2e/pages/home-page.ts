import type { Locator, Page } from '@playwright/test'

import { paths, testIds } from '../../../src/constants.ts'
import { AppPage } from './app-page.ts'

export class HomePage extends AppPage {
  readonly today: Locator

  constructor(page: Page) {
    super(page)
    this.today = page.getByTestId(testIds.today)
  }

  goto(): Promise<void> {
    return this.open(paths.home)
  }
}
