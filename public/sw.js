/* Touchline service worker: the app shell is cached on install, league packs
   on first use, so the game opens and plays offline once visited. Updated
   builds change the asset names, so a new worker replaces the old cache. */
const VERSION = 'touchline-v1'
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
  // Data packs and hashed assets: cache first, they never change under the same name
  if (url.pathname.includes('/data/') || url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }
  // The shell: network first so a new build shows up, cache when offline
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.endsWith('.webmanifest'))) caches.open(VERSION).then((c) => c.put(req, res.clone()))
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  )
})
