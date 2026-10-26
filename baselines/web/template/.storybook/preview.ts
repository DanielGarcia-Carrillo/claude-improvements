import '../src/index.css'
import type { Preview } from '@storybook/react-vite'

import { axeDisabledRules, axeTags } from '../tests/axe.ts'

const preview: Preview = {
  parameters: {
    a11y: {
      // Any violation fails the story's test, in the UI and under Vitest.
      test: 'error',
      // The same rules as the Playwright pages; see tests/axe.ts for why.
      options: {
        runOnly: { type: 'tag', values: axeTags },
        rules: Object.fromEntries(axeDisabledRules.map((id) => [id, { enabled: false }])),
      },
    },
  },
}

export default preview
