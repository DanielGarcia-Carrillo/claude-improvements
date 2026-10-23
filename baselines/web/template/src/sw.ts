/// <reference lib="webworker" />
/**
 * The service worker. vite-plugin-pwa compiles this file and injects the
 * precache manifest (`self.__WB_MANIFEST`) at build time; there is no `sw.js`
 * to edit, and `dist/sw.js` is rebuilt on every build.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Take control of open pages as soon as this worker activates. On first
// install that makes the app offline-ready without a reload; an update only
// activates once the user accepts it (below), and open pages reload then anyway.
clientsClaim()

// Every in-app navigation gets the precached shell, so the app opens offline.
// Paths the Worker or Cloudflare answer (the API, /cdn-cgi/) are not the app.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/cdn-cgi\//] }))

// A new worker waits until the user accepts the update in a page (see
// UpdatePrompt, which says what happens to the app's other open tabs).
self.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
