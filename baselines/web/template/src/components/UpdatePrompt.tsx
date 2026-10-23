import * as stylex from '@stylexjs/stylex'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { color, radius, space } from '../theme/tokens.stylex.ts'
import { Button } from './Button.tsx'

/** How often an open app looks for a new deploy, so fixes reach long-lived tabs. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Registers the service worker and, when a new one is waiting, asks before
 * it takes over. Accepting reloads every open tab of the app, not just this
 * one: that is vite-plugin-pwa's default, and it keeps any tab from running
 * old code against the new precache, which no longer has the old chunks. A
 * project whose other tabs can hold unsaved state can pass `onNeedReload` to
 * prompt there instead, and then has to cope with chunks failing to load.
 * The live region is always mounted so screen readers announce the prompt.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS)
    },
  })

  return (
    <div role="status" {...stylex.props(needRefresh && styles.toast)}>
      {needRefresh && (
        <>
          <p {...stylex.props(styles.message)}>A new version is available.</p>
          <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
          <Button onClick={() => setNeedRefresh(false)}>Later</Button>
        </>
      )}
    </div>
  )
}

const styles = stylex.create({
  toast: {
    position: 'fixed',
    insetInline: space.s4,
    insetBlockEnd: space.s4,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.surface,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  message: {
    flexGrow: 1,
    margin: 0,
  },
})
