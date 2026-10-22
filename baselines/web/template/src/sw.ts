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
// activates once the user accepts it (below), and the page reloads then anyway.
clientsClaim()

// Every in-app navigation gets the precached shell, so the app opens offline.
// Paths the Worker or Cloudflare answer (the API, /cdn-cgi/) are not the app.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/cdn-cgi\//] }))

// The page asks before a new worker takes over (see UpdatePrompt), so a user
// never has the app swapped out from under unsaved state.
self.addEventListener('message', (event) => {
  const data: unknown = event.data
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
