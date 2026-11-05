/* TouchLine service worker. The shell and every built asset (the list the build
   writes in place of __ASSETS__) are cached on install, so a second visit works
   offline whatever the first one loaded; the shell is refreshed in
   the background on every visit; hashed assets, icons, flags, art and local fonts are cache-first;
   league packs are served from the cache and refreshed behind the scenes, so
   a rebuilt pack shows up on the next visit. The local Barlow/VT323 fonts and Home art
   are precached, so the complete scene also works offline. VERSION is stamped per build, so
   a new deploy installs a fresh worker and drops the old cache. */
const VERSION = 'touchline-__BUILD__'
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './fonts/vt323-latin.woff2', './fonts/vt323-latin-ext.woff2', './fonts/vt323-vietnamese.woff2',
  './fonts/barlow-400-latin.woff2', './fonts/barlow-400-latin-ext.woff2', './fonts/barlow-400-vietnamese.woff2',
  './fonts/barlow-500-latin.woff2', './fonts/barlow-500-latin-ext.woff2', './fonts/barlow-500-vietnamese.woff2',
  './fonts/barlow-600-latin.woff2', './fonts/barlow-600-latin-ext.woff2', './fonts/barlow-600-vietnamese.woff2',
  './fonts/barlow-700-latin.woff2', './fonts/barlow-700-latin-ext.woff2', './fonts/barlow-700-vietnamese.woff2',
  './art/touchline-clouds.svg', './art/touchline-ground-day.webp', './art/touchline-ground-night.webp',
  './art/touchline-player-run.webp', './art/touchline-oak.webp',
]
// Unbuilt (the placeholder left as it is) this is empty
const ASSETS = ['__ASSETS__'].filter((a) => !a.startsWith('__'))

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([...SHELL, ...ASSETS])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  // Static assets, icons, flags, art and fonts: cache first inside this build's cache.
  // The precache stored them from requests without an Origin header, and a module import sends one, so a host that
  // answers `Vary: Origin` (vite preview does) would miss every one offline: the name alone decides
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/') || url.pathname.includes('/flags/') || url.pathname.includes('/img/') || url.pathname.includes('/fonts/') || url.pathname.includes('/art/')) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req, { ignoreVary: true })
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
  // The shell: network first so a new build shows up, cache when offline. A page is cached under its path only, so a
  // sign-in redirect's one-time `?token_hash=` or `?code=` never lands in Cache Storage
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.mode === 'navigate' || url.pathname.endsWith('.webmanifest'))) {
          const copy = res.clone()
          event.waitUntil(caches.open(VERSION).then((c) => c.put(key, copy)))
        }
        return res
      })
      .catch(() => caches.match(key).then((hit) => hit || caches.match('./index.html'))),
  )
})
