/* Touchline service worker. The shell is cached on install and refreshed in
   the background on every visit; hashed assets, icons and flags are cache-first;
   league packs are served from the cache and refreshed behind the scenes, so
   a rebuilt pack shows up on the next visit. VERSION is stamped per build, so
   a new deploy installs a fresh worker and drops the old cache. */
const VERSION = 'touchline-__BUILD__'
const SHELL = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // Hashed assets, icons and flags (public/flags/<code>.svg) never change under the same name: cache first
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/') || url.pathname.includes('/flags/')) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) {
          const copy = res.clone()
          event.waitUntil(cache.put(req, copy))
        }
        return res
      }),
    )
    return
  }
  // League packs: serve the cached copy at once, refresh it in the background
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req)
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              event.waitUntil(cache.put(req, copy))
            }
            return res
          })
          .catch(() => hit)
        if (hit) {
          event.waitUntil(refresh.then(() => undefined, () => undefined))
          return hit
        }
        return refresh
      }),
    )
    return
  }
  // The shell: network first so a new build shows up, cache when offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.endsWith('.webmanifest'))) {
          const copy = res.clone()
          event.waitUntil(caches.open(VERSION).then((c) => c.put(req, copy)))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  )
})
