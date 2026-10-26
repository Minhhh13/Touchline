import { Component, createElement, lazy, Suspense, type ComponentType, type ReactNode } from 'react'

/**
 * Route-level code splitting: every screen but Home is its own chunk, so a phone downloads, parses and compiles only
 * the shell and Home before the first paint of the game. Once Home is up the chunks are fetched one by one in idle
 * time (`prefetchScreens`), in the order a player meets them, so the first tap on a mode rarely waits and every screen
 * is in the service worker's cache for the next offline visit. A screen whose chunk is already in renders at once,
 * without a Suspense frame; one still on its way shows `ScreenFallback`; one that cannot load (offline before it was
 * fetched, or a deploy replaced it) shows `ScreenBoundary`'s reload card instead of a blank page.
 */

/** Whether this page loaded before a service worker controlled it (a first visit): its assets then bypassed the worker's cache. */
const startedUncontrolled = typeof navigator !== 'undefined' && !!navigator.serviceWorker && !navigator.serviceWorker.controller

export interface LazyScreen {
  Screen: ComponentType
  preload: () => Promise<unknown>
}

/** A screen loaded on demand: `name` is its export in the module `load` imports. */
export function lazyScreen<K extends string>(load: () => Promise<{ [k in K]: ComponentType }>, name: K): LazyScreen {
  let loaded: ComponentType | null = null
  let pending: Promise<ComponentType> | null = null
  const preload = (): Promise<ComponentType> => {
    if (!pending) {
      pending = load().then((m) => (loaded = m[name]))
      // A failed fetch is not kept: the next render or prefetch tries the network again
      pending.catch(() => {
        pending = null
      })
    }
    return pending
  }
  // React.lazy keeps a rejection for good: a failed load swaps in a fresh one, so the next render tries again
  const make = (): ComponentType =>
    lazy(() =>
      preload().then(
        (c) => ({ default: c }),
        (e: unknown) => {
          Lazy = make()
          throw e
        },
      ),
    )
  let Lazy = make()
  function Screen() {
    return createElement(loaded ?? Lazy)
  }
  Screen.displayName = `Lazy(${name})`
  return { Screen, preload }
}

/** What a screen shows while its chunk downloads: the loading skeleton of the design system. */
export function ScreenFallback() {
  return (
    <div className="page loading-screen" aria-busy="true" data-testid="screen-loading">
      <div className="skeleton loading-hero">
        <div className="muted small" role="status">
          Loading…
        </div>
      </div>
    </div>
  )
}

/** A screen's chunk that failed to load: say so and offer a reload, rather than an empty page. */
export class ScreenBoundary extends Component<{ children: ReactNode; screenKey: string }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.screenKey }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  static getDerivedStateFromProps(props: { screenKey: string }, state: { failed: boolean; key: string }) {
    // Moving to another screen clears the card: that screen gets its own try
    return props.screenKey !== state.key ? { failed: false, key: props.screenKey } : null
  }
  render() {
    if (!this.state.failed) return <Suspense fallback={<ScreenFallback />}>{this.props.children}</Suspense>
    return (
      <div className="page">
        <div className="panel col" data-testid="screen-load-error">
          <h2>This screen did not load</h2>
          <p className="muted">It needs a connection the first time. Your game is saved: reload to try again.</p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/**
 * Fetch every screen's chunk one at a time in idle moments, in the order given, each within 400 ms even when the page
 * never goes idle (Home's art keeps a software-rendered page busy): all of them are in within seconds of Home, as
 * the single bundle was. Returns a cancel. On a first visit the
 * page loads before the service worker takes it, so whatever came in until then is fetched once more through the
 * worker when it does (`cacheLoadedAssets`), from the HTTP cache: the next visit works offline.
 */
export function prefetchScreens(screens: LazyScreen[]): () => void {
  let stopped = false
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const idle = (fn: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 400 }) : window.setTimeout(fn, 200))
  const queue = [...screens]
  const next = () => {
    if (stopped) return
    const s = queue.shift()
    if (!s) return
    idle(() => {
      if (stopped) return
      s.preload().then(next, next)
    })
  }
  next()
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  const onControl = () => cacheLoadedAssets()
  if (sw && startedUncontrolled && import.meta.env.PROD) {
    if (sw.controller) cacheLoadedAssets()
    else sw.addEventListener('controllerchange', onControl, { once: true })
  }
  return () => {
    stopped = true
    sw?.removeEventListener('controllerchange', onControl)
  }
}

/** Fetch again, through the service worker that now controls the page, every hashed asset this page loaded before it did. */
export function cacheLoadedAssets(): void {
  if (typeof performance === 'undefined' || typeof fetch === 'undefined') return
  const seen = new Set<string>()
  for (const e of performance.getEntriesByType('resource')) {
    const url = new URL(e.name, location.href)
    if (url.origin !== location.origin || !url.pathname.includes('/assets/') || seen.has(url.href)) continue
    seen.add(url.href)
    fetch(url.href).catch(() => undefined)
  }
}
