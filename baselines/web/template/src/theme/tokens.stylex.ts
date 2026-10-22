import * as stylex from '@stylexjs/stylex'

/**
 * Design tokens. Components take colour, spacing, radii, type and motion
 * from here and never spell a literal. Tokens, not components, answer to
 * `prefers-color-scheme`, `prefers-reduced-motion` and `prefers-contrast`.
 */

/** Colour roles from palette.ts, each a `light-dark()` pair. */
export const color = stylex.defineVars(stylex.env.colorTokens)

export const space = stylex.defineVars({
  s1: '0.25rem',
  s2: '0.5rem',
  s3: '0.75rem',
  s4: '1rem',
  s6: '1.5rem',
  s8: '2rem',
})

export const radius = stylex.defineVars({
  control: '0.5rem',
  surface: '1rem',
})

export const font = stylex.defineVars({
  body: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
})

export const motion = stylex.defineVars({
  duration: { default: '150ms', '@media (prefers-reduced-motion: reduce)': '0s' },
})

export const line = stylex.defineVars({
  /** Borders that carry meaning get stronger when the user asks for more contrast. */
  subtle: { default: color.border, '@media (prefers-contrast: more)': 'CanvasText' },
})
