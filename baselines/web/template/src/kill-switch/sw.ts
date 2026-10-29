/// <reference lib="webworker" />
/**
 * The kill switch: an emergency service worker that removes the app's own.
 * `pnpm build:kill-switch` ships it as `/sw.js` in place of src/sw.ts, for a
 * deploy whose worker serves a broken app and can't be fixed by an ordinary
 * update (the web README's "Recover from a broken service worker" says when).
 *
 * Browsers check `/sw.js` on every navigation (public/_headers keeps it
 * uncached), so this reaches each user on their next visit, even when the
 * broken page never runs. It installs without waiting for the update prompt,
 * deletes the app's Cache Storage, unregisters, and reloads the open tabs
 * from the network. IndexedDB, localStorage and cookies are left alone, so
 * data the app keeps offline survives.
 */
declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
      await self.registration.unregister()
      // The tabs the old worker controlled; each reloads without a worker.
      const windows = await self.clients.matchAll({ type: 'window' })
      await Promise.all(windows.map((client) => client.navigate(client.url)))
    })(),
  )
})
