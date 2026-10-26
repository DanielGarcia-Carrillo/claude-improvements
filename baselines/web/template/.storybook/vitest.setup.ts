import { afterEach, inject } from 'vitest'
import { page } from 'vitest/browser'

declare module 'vitest' {
  export interface ProvidedContext {
    /** Absolute, or empty when screenshots are off (vite.config.ts sets it from SCREENSHOT_DIR). */
    screenshotDir: string
  }
}

/**
 * With SCREENSHOT_DIR set, as CI sets it for PR screenshots, every story that
 * passed is saved as `<dir>/stories/<file>--<story>.png`. Otherwise nothing is
 * written.
 */
afterEach(async ({ task }) => {
  const dir = inject('screenshotDir')
  if (dir === '' || task.result?.state === 'fail') return
  const file = task.file.name
    .replace(/^src\//, '')
    .replace(/\.stories\.tsx$/, '')
    .replaceAll('/', '-')
  // The story's own container, beside Storybook's hidden loader wrappers;
  // the whole frame if a Storybook update moves it.
  const story = document.querySelector('body > div:not(.sb-wrapper)')
  await page.screenshot({
    path: `${dir}/stories/${file}--${task.name.replaceAll(/\W+/g, '-')}.png`,
    ...(story ? { element: story } : {}),
  })
})
