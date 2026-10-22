/**
 * The colour roles, as plain values: the one source for both the StyleX
 * tokens (passed in through `env` in vite.config.ts) and the APCA test.
 * A `.stylex.ts` file can't be imported for its values outside the compiler,
 * which is why these live here. No StyleX import in this file.
 *
 * Pick colours in OKLCH so lightness steps are even across hues.
 */
export const palette = {
  light: {
    bg: 'oklch(99% 0.005 250)',
    fg: 'oklch(22% 0.02 250)',
    fgMuted: 'oklch(45% 0.02 250)',
    accent: 'oklch(50% 0.19 260)',
    accentHover: 'oklch(45% 0.19 260)',
    accentPressed: 'oklch(40% 0.18 260)',
    onAccent: 'oklch(99% 0 0)',
    focus: 'oklch(50% 0.19 260)',
    border: 'oklch(85% 0.01 250)',
  },
  dark: {
    bg: 'oklch(18% 0.01 250)',
    fg: 'oklch(94% 0.01 250)',
    fgMuted: 'oklch(80% 0.02 250)',
    accent: 'oklch(78% 0.13 260)',
    accentHover: 'oklch(83% 0.11 260)',
    accentPressed: 'oklch(87% 0.09 260)',
    onAccent: 'oklch(18% 0.02 260)',
    focus: 'oklch(80% 0.13 260)',
    border: 'oklch(35% 0.01 250)',
  },
} as const satisfies Record<'light' | 'dark', Record<string, string>>

export type Scheme = keyof typeof palette
export type Role = keyof typeof palette.light

const lightDark = (role: Role) => `light-dark(${palette.light[role]}, ${palette.dark[role]})`

/**
 * Each role as a `light-dark()` pair: the page's `color-scheme` picks the
 * value. Typed as every role, so a role added above fails to compile here
 * until it has a token.
 */
export const colorTokens: Record<Role, string> = {
  bg: lightDark('bg'),
  fg: lightDark('fg'),
  fgMuted: lightDark('fgMuted'),
  accent: lightDark('accent'),
  accentHover: lightDark('accentHover'),
  accentPressed: lightDark('accentPressed'),
  onAccent: lightDark('onAccent'),
  focus: lightDark('focus'),
  border: lightDark('border'),
}
