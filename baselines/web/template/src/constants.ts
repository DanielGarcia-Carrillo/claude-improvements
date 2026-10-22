/**
 * Values the app and its tests both spell. Tests import them from here, so a
 * renamed path or test id fails to compile instead of failing at runtime.
 *
 * Prefer role-and-name locators in tests; a test id is for elements with no
 * accessible role worth asserting on.
 */
export const paths = {
  home: '/',
  about: '/about',
} as const

export const testIds = {
  today: 'today',
} as const
