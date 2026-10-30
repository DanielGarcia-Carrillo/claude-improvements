/** Format exactly the paths Lefthook passes, including names starting with ! or -. */
import { spawnSync } from 'node:child_process'

const files = process.argv.slice(2)
// An empty Oxfmt path list would format the whole checkout.
if (files.length === 0) process.exit(0)

// Oxfmt treats ! as a glob exclusion even after --. Prefix each path, not
// the joined argument list; spawnSync preserves spaces without a shell.
const result = spawnSync(
  'pnpm',
  ['exec', 'oxfmt', '--no-error-on-unmatched-pattern', '--', ...files.map((file) => `./${file}`)],
  {
    stdio: 'inherit',
  },
)
if (result.error) process.stderr.write(`format-staged: ${result.error.message}\n`)
process.exit(result.status ?? 1)
