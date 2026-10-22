import type { StorybookConfig } from '@storybook/react-vite'
import type { PluginOption } from 'vite'

const isPwaPlugin = (plugin: PluginOption) =>
  Boolean(plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name.startsWith('vite-plugin-pwa'))

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y'],
  // Storybook loads the app's vite.config.ts, StyleX and all. A service
  // worker has no place in a component catalogue, so its plugins are dropped.
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: (viteConfig.plugins ?? []).flat(Infinity).filter((plugin) => !isPwaPlugin(plugin)),
  }),
}

export default config
