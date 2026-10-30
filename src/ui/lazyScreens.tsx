import { Component, createElement, lazy, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { House, RotateCcw, TriangleAlert } from 'lucide-react'
import { signalError } from '../online/core/errorSignal'

/**
 * Route-level code splitting: every screen but Home is its own chunk, so a phone downloads, parses and compiles only
 * the shell and Home before the first paint of the game. Once Home is up the chunks are fetched one by one in idle
 * time (`prefetchScreens`), in the order a player meets them, so the first tap on a mode rarely waits and every screen
 * is in the service worker's cache for the next offline visit. A screen whose chunk is already in renders at once,
 * without a Suspense frame; one still on its way shows `ScreenFallback`; one that cannot load (offline before it was
 * fetched, or a deploy replaced it) shows `ScreenBoundary`'s reload card instead of a blank page, and a screen that throws
 * while rendering shows its Back to home and Reload card.
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

/**
 * A screen chunk that could not be fetched (offline before it was prefetched, or a deploy replaced it), as Chromium,
 * Firefox, Safari and Vite's CSS preload word it, as opposed to a render error in a screen that did load. Pure.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'ChunkLoadError' || /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk \S+ failed/i.test(error.message)
}

/** Per tab (sessionStorage): when this tab last reloaded itself over a chunk that did not load. */
export const CHUNK_RELOAD_KEY = 'touchline-chunk-reload'
/** At most one automatic reload in this long, so a chunk that really is missing shows the card instead of a reload loop. */
export const CHUNK_RELOAD_WINDOW_MS = 60_000

/**
 * Whether a chunk that did not load reloads the page by itself (R14-O1): only online (offline, the card says why and a
 * reload would not help), and only when this tab has not done so in the last `CHUNK_RELOAD_WINDOW_MS`. A reload made
 * while the previous page's imports were in flight can leave one screen's module failed; a fresh page loads it. Pure.
 */
export function chunkReloadDue(now: number, lastAt: number | null, online: boolean): boolean {
  if (!online) return false
  if (lastAt === null || !Number.isFinite(lastAt)) return true
  return now - lastAt >= CHUNK_RELOAD_WINDOW_MS || now < lastAt
}

/** Per tab: the screen a reload over a failed chunk goes back to (a screen with no game is not kept by the save). */
export const CHUNK_RETURN_KEY = 'touchline-chunk-screen'
/** The screens a reload can come back to with nothing but their name (and Setup's mode). */
const RETURNABLE = ['setup', 'explore', 'profile', 'howto', 'h2h', 'world', 'privacy', 'account'] as const
const RETURN_MODES = ['quick', 'daily', 'season', 'dynasty', 'arena', 'weekly', 'runin'] as const
export type ChunkReturn = { screen: (typeof RETURNABLE)[number]; mode?: (typeof RETURN_MODES)[number] }

/**
 * Where the page that reloaded over a chunk goes back to: the screen it was showing ("setup:quick", "explore"), and
 * only when the reload brought it home (a game's own screen comes back from the save by itself). Pure.
 */
export function chunkReturnOf(token: string | null, current: string): ChunkReturn | null {
  if (!token || current !== 'home') return null
  const [screen, mode] = token.split(':')
  const s = RETURNABLE.find((x) => x === screen)
  if (!s) return null
  const m = RETURN_MODES.find((x) => x === mode)
  return m ? { screen: s, mode: m } : { screen: s }
}

/** The return token a reload left for this page, read once (it is removed). */
export function takeChunkReturn(): string | null {
  try {
    const token = sessionStorage.getItem(CHUNK_RETURN_KEY)
    if (token !== null) sessionStorage.removeItem(CHUNK_RETURN_KEY)
    return token
  } catch {
    return null
  }
}

/** Reload once over a failed chunk, if due; false when the card should stay. */
function reloadOverChunk(returnTo: string | undefined): boolean {
  try {
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY)
    const last = raw === null ? null : Number(raw)
    const now = Date.now()
    if (!chunkReloadDue(now, last, navigator.onLine !== false)) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    if (returnTo) sessionStorage.setItem(CHUNK_RETURN_KEY, returnTo)
    location.reload()
    return true
  } catch {
    return false
  }
}

interface BoundaryProps {
  children: ReactNode
  /** The screen on show: a new key (another screen or phase) clears a caught error, so that screen gets its own try. */
  resetKey: string
  onHome: () => void
  /** Home itself is the screen: Back to home would land on the same error, so only Reload is offered. */
  atHome?: boolean
  /** The screen to come back to after a reload over a chunk (`chunkReturnOf`): "setup:quick", "explore". */
  returnTo?: string
}

interface BoundaryState {
  error: Error | null
  key: string
}

/**
 * The one boundary around the screens: it holds the Suspense frame of a lazy screen and catches whatever goes wrong
 * below it, so the page is never left white with no way out. A chunk that did not load says so and offers a reload; a
 * screen that threw while rendering shows the error, Back to home (not when Home itself threw) and Reload, the top bar kept. The save is untouched:
 * the store's state is not part of the render. Navigating to another screen or phase resets it.
 */
export class ScreenBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const chunk = isChunkLoadError(error)
    console.error(chunk ? 'Screen chunk did not load' : 'Screen error', error, info.componentStack)
    // To the error reporter of an online build, if the player has not switched it off (src/online/errors.ts)
    signalError(chunk ? 'chunk' : 'boundary', error)
    // Once, online: a fresh page loads what this one could not (the card shows meanwhile, and if the reload does not help)
    if (chunk) reloadOverChunk(this.props.returnTo)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return <Suspense fallback={<ScreenFallback />}>{this.props.children}</Suspense>
    const chunk = isChunkLoadError(error)
    const atHome = !!this.props.atHome
    const reload = (
      <button type="button" className={chunk || atHome ? 'btn primary' : 'btn'} onClick={() => location.reload()} data-testid="screen-error-reload">
        <RotateCcw size={16} aria-hidden="true" /> Reload
      </button>
    )
    const home = atHome ? null : (
      <button type="button" className={chunk ? 'btn' : 'btn primary'} onClick={this.props.onHome} data-testid="screen-error-home">
        <House size={16} aria-hidden="true" /> Back to home
      </button>
    )
    return (
      <div className="page">
        <div className="panel col" role="alert" data-testid={chunk ? 'screen-load-error' : 'screen-error'}>
          <h2 className="row">
            <TriangleAlert size={20} aria-hidden="true" /> {chunk ? 'This screen did not load' : 'This screen hit a problem'}
          </h2>
          {chunk ? (
            <p className="muted">It needs a connection the first time. Your game is saved: reload to try again.</p>
          ) : (
            <>
              <p className="muted">{atHome ? 'Your game and your record are saved. Reload the page to try again.' : 'Your game and your record are saved. Go back to the home screen, or reload the page to try this screen again.'}</p>
              <p className="muted small mono">{error.message}</p>
            </>
          )}
          {/* The likely fix goes first: a reload for a chunk, home for a screen that threw */}
          <div className="row wrap">
            {chunk ? (
              <>
                {reload}
                {home}
              </>
            ) : (
              <>
                {home}
                {reload}
              </>
            )}
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
let screensFetched: () => void = () => undefined
const allFetched = new Promise<void>((resolve) => {
  screensFetched = resolve
})

/** Resolves once `prefetchScreens` has fetched every chunk it was given (main.tsx then registers the service worker). */
export function whenScreensFetched(): Promise<void> {
  return allFetched
}

export function prefetchScreens(screens: LazyScreen[]): () => void {
  let stopped = false
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const idle = (fn: () => void) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 400 }) : window.setTimeout(fn, 200))
  const queue = [...screens]
  const next = () => {
    if (stopped) return
    const s = queue.shift()
    if (!s) return screensFetched()
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
