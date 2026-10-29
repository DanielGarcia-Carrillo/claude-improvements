/** Values vite.config.ts `define`s for every build. */
interface ImportMetaEnv {
  /** When this build was made, an ISO instant (see src/lib/update-policy.ts). */
  readonly BUILD_TIME: string
  /** Whether this is a `pnpm build:kill-switch` build (see src/kill-switch/sw.ts). */
  readonly SW_KILL_SWITCH: boolean
}
