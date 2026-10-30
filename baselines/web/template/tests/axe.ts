/**
 * The one axe configuration, shared by Playwright pages and Storybook stories,
 * tuned so a failure is a real defect rather than noise.
 *
 * Only WCAG A and AA rules run. axe's best-practice rules (landmarks, regions,
 * heading order) are advice, and in an isolated story they mostly flag the
 * page that isn't there around the component.
 *
 * `color-contrast` is off. It scores WCAG 2 contrast ratios, while this
 * project holds color to APCA in src/theme/contrast.test.ts: running both
 * lets a palette that passes one fail the other. The rule also reads whatever
 * is painted at that instant (a transition, an overlapping layer), which makes
 * it axe's usual source of flaky results.
 */
export const axeTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

export const axeDisabledRules = ['color-contrast']
