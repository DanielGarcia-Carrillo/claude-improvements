import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HOOK = fileURLToPath(new URL('guard-deploy.ts', import.meta.url))

/** The hook's exit code for a Bash call running `command`: 2 blocks it. */
function verdict(command: string): number | null {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } })
  return spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' }).status
}

describe('guard-deploy', () => {
  it.each([
    'wrangler deploy',
    'pnpm dlx wrangler deploy',
    './node_modules/.bin/wrangler --config x deploy',
    'wrangler deploy --env production',
    'wrangler secret put API_KEY',
    // A dry run or `--env` on one call doesn't excuse the next.
    'pnpm dlx wrangler deploy --env staging && pnpm dlx wrangler deploy',
    'wrangler deploy --dry-run && wrangler deploy',
    'wrangler deploy --dry-run; wrangler deploy',
    'pnpm wrangler versions upload && pnpm wrangler versions deploy',
    'echo $(wrangler deploy)',
    // yargs reads all of these as a real deploy.
    'wrangler deploy --dry-run=false',
    'wrangler deploy --dry-run false',
    'wrangler deploy --dry-run --no-dry-run',
    // The shell decides these, so they may be production.
    'wrangler deploy --env "$TARGET"',
    'wrangler deploy --env=$(cat env)',
  ])('blocks %s', (command) => {
    expect(verdict(command)).toBe(2)
  })

  it.each([
    'wrangler deploy --dry-run',
    'wrangler deploy --dry-run=true',
    'wrangler deploy --dry-run --outdir dist',
    'wrangler deploy --env staging',
    'wrangler deploy --env staging 2>&1 | tee deploy.log',
    'wrangler deploy --env staging && wrangler deploy --env qa',
    'wrangler versions upload --preview-alias my-branch',
    'wrangler preview',
    'pnpm build',
  ])('allows %s', (command) => {
    expect(verdict(command)).toBe(0)
  })
})
