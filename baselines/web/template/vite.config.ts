import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import babel from '@rolldown/plugin-babel'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import stylex from '@stylexjs/unplugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import browserslist from 'browserslist'
import browserslistToEsbuild from 'browserslist-to-esbuild'
import { browserslistToTargets } from 'lightningcss'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

import { colorTokens } from './src/theme/palette.ts'

// Unit tests read no zone from the machine. Set here, in the main process:
// a setup file is too late for Vitest's worker threads.
process.env['TZ'] = 'UTC'

/**
 * The `browserslist` field in package.json is the one list of supported
 * browsers. Vite reads no browserslist itself, so the JS and CSS targets are
 * derived from it here. Keep it modern: below Chrome 123, Firefox 120 or
 * Safari 17.5, Lightning CSS lowers `light-dark()` into variables StyleX never
 * defines, and dark mode silently breaks.
 */
const browsers = browserslist()

/**
 * public/_headers sets the production headers, CSP included. Cloudflare reads
 * it at deploy time and Vite ignores it, so its `/*` block is applied to
 * `vite preview` here, and the e2e tests run under the real policy.
 */
const headersFile = readFileSync(new URL('public/_headers', import.meta.url), 'utf8')

function headersForEveryPath(file: string): Record<string, string> {
  const lines = file.split('\n')
  const start = lines.indexOf('/*')
  if (start === -1) throw new Error('public/_headers has no `/*` block, so `vite preview` would run without the CSP.')
  const headers: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    const colon = line.indexOf(':')
    if (!/^\s+\S/.test(line) || colon === -1) break
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
  }
  return headers
}

export default defineConfig(({ mode }) => ({
  plugins: [
    // Generates src/routeTree.gen.ts from src/routes/. Must precede react().
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    // The package's types expose only the default export, so `vite` can't be imported by name.
    // oxlint-disable-next-line import/no-named-as-default-member
    stylex.vite({
      // Readable class names (`Button__styles.root`) and source attributes in dev only.
      dev: mode === 'development',
      useCSSLayers: true,
      treeshakeCompensation: true,
      // Needed for defineVars themes imported across files. 'commonJS' names
      // StyleX's path-based resolver, the one for ES modules; the alternative,
      // 'haste', is Meta's flat-namespace module system.
      unstable_moduleResolution: { type: 'commonJS' },
      env: { colorTokens },
    }),
    react(),
    // A component the compiler can't optimise fails the build instead of
    // silently shipping unmemoised; the error names the rule it breaks.
    babel({ presets: [reactCompilerPreset({ panicThreshold: 'all_errors' })] }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // UpdatePrompt registers it through useRegisterSW.
      // The icon is precached by the glob below; listing it again makes a
      // duplicate precache entry, and the worker then refuses to install.
      includeManifestIcons: false,
      manifest: {
        name: 'Replace Me',
        short_name: 'ReplaceMe',
        description: 'Replace me: a one-line description',
        start_url: '/',
        display: 'standalone',
        theme_color: '#1d4ed8',
        background_color: '#fcfcfd',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: {
        // The worker is registered as a classic script, and bundling drops the
        // strict mode its module source had. This puts the directive back.
        buildPlugins: {
          vite: [
            {
              name: 'service-worker-use-strict',
              generateBundle(_options, bundle) {
                for (const chunk of Object.values(bundle)) {
                  if (chunk.type === 'chunk') chunk.code = `'use strict';\n${chunk.code}`
                }
              },
            },
          ],
        },
        // Extensions, never `**/*`: public/_headers is consumed by Cloudflare
        // and never served, and precaching a URL that 404s fails the install.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        // StyleX can change a chunk without changing its hashed name
        // (facebook/stylex#1918), so every entry gets a content revision.
        dontCacheBustURLsMatching: /(?!)/,
        // A deploy that changes only public/_headers would otherwise leave
        // every revision as it was, and installed apps would keep serving the
        // cached shell under the old headers. Hashing the file into
        // index.html's revision makes it an ordinary update.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((entry) =>
              entry.url === 'index.html'
                ? {
                    ...entry,
                    revision: `${entry.revision ?? ''}-${createHash('sha256').update(headersFile).digest('hex').slice(0, 12)}`,
                  }
                : entry,
            ),
          }),
        ],
      },
    }),
  ],

  build: { target: browserslistToEsbuild(browsers) },
  preview: { headers: headersForEveryPath(headersFile) },
  css: { transformer: 'lightningcss', lightningcss: { targets: browserslistToTargets(browsers) } },

  test: {
    // StyleX's plugin holds Vite's server open after a run until
    // facebook/stylex#1846 is released; without this Vitest hangs on exit.
    teardownTimeout: 1000,
    projects: [
      {
        // A test that asserts nothing fails rather than passing vacuously.
        // Hook and script tests run each one as Claude Code or pnpm would, with node.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', '.claude/hooks/**/*.test.ts'],
          expect: { requireAssertions: true },
        },
      },
      {
        // Every story renders in a real browser, runs its play function and
        // fails on axe violations (`a11y.test` in .storybook/preview.ts).
        plugins: [storybookTest({ configDir: '.storybook' })],
        test: {
          name: 'storybook',
          // Saves each story as a PNG when SCREENSHOT_DIR is set (.storybook/vitest.setup.ts).
          setupFiles: ['.storybook/vitest.setup.ts'],
          provide: { screenshotDir: process.env['SCREENSHOT_DIR'] ? resolve(process.env['SCREENSHOT_DIR']) : '' },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ contextOptions: { locale: 'en-US', timezoneId: 'America/Toronto' } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
}))
