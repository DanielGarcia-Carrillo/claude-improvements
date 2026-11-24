// Run the suite once: Vitest collects application/browser coverage, and raw
// V8 files also retain native Node subprocesses used by hook/script tests.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

rmSync('coverage', { recursive: true, force: true })
mkdirSync('coverage/node', { recursive: true })
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('pnpm', ['exec', 'vitest', 'run', '--coverage'], {
  ...process.env,
  NODE_V8_COVERAGE: resolve('coverage/node'),
})
run('pnpm', [
  'exec',
  'c8',
  'report',
  '--all',
  '--src',
  'scripts',
  '--src',
  '.claude/hooks',
  '--include',
  'scripts/**/*.ts',
  '--include',
  '.claude/hooks/**/*.ts',
  '--exclude',
  '**/*.test.ts',
  '--exclude',
  '**/scratch-checkout.ts',
  '--temp-directory',
  'coverage/node',
  '--reports-dir',
  'coverage/tooling',
  '--reporter',
  'text',
  '--reporter',
  'html',
  '--reporter',
  'cobertura',
])
mkdirSync('coverage/istanbul', { recursive: true })
copyFileSync('coverage/app/coverage-final.json', 'coverage/istanbul/unit.json')
// Instrumented output has its own directory. The ordinary `pnpm e2e` in
// verify subsequently checks the production build and creates deploy's dist/.
run('pnpm', ['exec', 'playwright', 'test'], {
  ...process.env,
  COVERAGE_BUILD: '1',
  E2E_RUN_DIR: 'coverage/browser-build',
})
run('pnpm', ['exec', 'nyc', 'merge', 'coverage/istanbul', 'coverage/merged/coverage.json'])
run('pnpm', [
  'exec',
  'nyc',
  'report',
  '--temp-dir',
  'coverage/merged',
  '--report-dir',
  'coverage/app',
  '--reporter',
  'text',
  '--reporter',
  'html',
  '--reporter',
  'cobertura',
])
for (const report of ['app', 'tooling']) {
  run('uv', ['run', '--script', '--locked', 'scripts/check-coverage.py', `coverage/${report}/cobertura-coverage.xml`])
}
