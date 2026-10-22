import type { colorTokens } from './palette.ts'

// Types `stylex.env` (filled from `env` in vite.config.ts). Augmenting
// '@stylexjs/stylex' itself does not reach the Register interface.
declare module '@stylexjs/stylex/lib/types/StyleXTypes' {
  interface Register {
    env: { colorTokens: typeof colorTokens }
  }
}
