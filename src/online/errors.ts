/**
 * The error reporter (docs/ONLINE.md section 5f): uncaught errors (`window` `error`), unhandled rejections, what the
 * screen boundary caught (`signalError` in core/errorSignal.ts) and chunks that did not load (the boundary's, and
 * Vite's `vite:preloadError`), sent to the Edge Function's `errors.report` as a guest (the publishable key, never a
 * JWT, so a report is tied to no account) with no third-party service. Loaded by `boot.ts`, so only an online build
 * has it; an offline build emits none of it.
 *
 * Every report is built by `core/errorReport.ts` (scrubbed, our frames only, no game data), deduplicated and
 * rate-limited per device, and queued in `touchline-online-v1` until it goes (offline, or the server busy). The
 * Profile's "Send error reports" (`core/errorPref.ts`) switched off takes nothing and empties the queue. Nothing here
 * throws: a reporter that fails stays quiet, and it never reports its own failures.
 */
import { ENGINE_VERSION } from '@engine/version'
import { useStore } from '@game/store'
import { onlineConfig } from './config'
import { functionUrl, timedFetch } from './transport'
import { loadRecord, updateRecord } from './localState'
import { errorReportsOn } from './core/errorPref'
import { ERROR_EVENT, takeEarlySignals, type ErrorSignal } from './core/errorSignal'
import {
  admit,
  afterPost,
  freshErrorState,
  labelOf,
  messageOf,
  parseErrorState,
  REPORTS_PER_POST,
  trimStack,
  uaFamily,
  type Admission,
  type ErrorReport,
  type ErrorState,
  type ReportKind,
} from './core/errorReport'

/** The request limit the Edge Function holds every body to (`MAX_BODY_BYTES` in server/validate.ts; a test keeps them equal). */
export const BODY_BUDGET = 16384

/**
 * The next batch to post: the queue's first reports, at most `REPORTS_PER_POST`, while the request stays within
 * `BODY_BUDGET` bytes. Each report is within its caps, but the caps count characters and JSON escapes a control
 * character to six bytes, so five of the largest could pass the limit, and the server refuses (and the device drops)
 * the whole batch (docs/QA.md round 3, R8-5). One report always goes: alone it is well inside the limit.
 */
export function batchOf(queue: readonly ErrorReport[]): ErrorReport[] {
  const out: ErrorReport[] = []
  for (const r of queue.slice(0, REPORTS_PER_POST)) {
    if (out.length && new TextEncoder().encode(JSON.stringify({ op: 'errors.report', reports: [...out, r] })).length > BODY_BUDGET) break
    out.push(r)
  }
  return out
}

/** What the reporter needs from the page, injected so the tests drive it with no DOM. */
export interface ReporterEnv {
  origin: string
  userAgent: string
  now(): number
  viewport(): string
  where(): { screen: string; phase: string }
  online(): boolean
  enabled(): boolean
  /** This page's build id (`builtAt` of its `build.json`), read once. */
  build(): Promise<string>
  /** POST some reports; the HTTP status, or 0 when the request did not get an answer. */
  post(reports: ErrorReport[]): Promise<number>
  load(): ErrorState | null
  save(s: ErrorState): void
  randomId(): string
  later(fn: () => void, ms: number): void
}

export interface Reporter {
  capture(kind: ReportKind, error: unknown): Promise<Admission | 'off' | 'ignored'>
  flush(): Promise<void>
  /** Empty the queue (the setting was switched off). */
  clear(): void
}

/** Messages that carry nothing to act on: a cross-origin script's "Script error." and the browser's own ResizeObserver
 * notice, which every layout change can raise. */
export function ignoredMessage(message: string): boolean {
  return /^(?:Uncaught )?Script error\.?$/i.test(message) || /^ResizeObserver loop/i.test(message)
}

/** How a post's status files the reports: taken, refused for good (never retried), or kept for later. */
export function postOutcome(status: number): 'ok' | 'drop' | 'retry' {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 400 || status === 413 || status === 422) return 'drop'
  return 'retry'
}

const FLUSH_DELAY_MS = 4000

export function createReporter(env: ReporterEnv): Reporter {
  let flushing = false
  let scheduled = false
  const state = (): ErrorState => env.load() ?? freshErrorState(env.randomId())

  const schedule = (ms: number) => {
    if (scheduled) return
    scheduled = true
    env.later(() => {
      scheduled = false
      void flush()
    }, ms)
  }

  async function flush(): Promise<void> {
    if (flushing) return
    flushing = true
    try {
      if (!env.enabled()) {
        clear()
        return
      }
      const s = env.load()
      if (!s || !s.queue.length || !env.online() || env.now() < s.nextAt) {
        if (s && s.queue.length && env.now() < s.nextAt) schedule(s.nextAt - env.now())
        return
      }
      const batch = batchOf(s.queue)
      let status = 0
      try {
        status = await env.post(batch)
      } catch {
        status = 0
      }
      // Read again: another capture (or tab) may have queued while the post was out
      const next = afterPost(env.load() ?? s, batch.length, postOutcome(status), env.now())
      env.save(next)
      if (next.queue.length) schedule(next.nextAt > env.now() ? next.nextAt - env.now() : FLUSH_DELAY_MS)
    } catch {
      // the reporter never reports itself
    } finally {
      flushing = false
    }
  }

  function clear(): void {
    try {
      const s = env.load()
      if (s && s.queue.length) env.save({ ...s, queue: [] })
    } catch {
      // nothing to clear
    }
  }

  async function capture(kind: ReportKind, error: unknown): Promise<Admission | 'off' | 'ignored'> {
    try {
      if (!env.enabled()) {
        clear()
        return 'off'
      }
      const message = messageOf(error)
      if (ignoredMessage(message)) return 'ignored'
      // A chunk that cannot load while the device is offline is the offline card doing its job, not a fault
      if (kind === 'chunk' && !env.online()) return 'ignored'
      const stack = trimStack(error instanceof Error ? error.stack : undefined, env.origin)
      const { screen, phase } = env.where()
      const s = state()
      const report: ErrorReport = {
        kind,
        message,
        stack,
        build: await env.build(),
        engine: ENGINE_VERSION,
        screen: labelOf(screen),
        phase: labelOf(phase),
        viewport: env.viewport(),
        ua: uaFamily(env.userAgent),
        device: s.id,
        count: 1,
        at: new Date(env.now()).toISOString(),
      }
      // Admit against the stored state as it is now (the build read may have taken a moment)
      const { state: next, outcome } = admit(env.load() ?? s, report, env.now())
      env.save(next)
      if (outcome === 'queued') schedule(FLUSH_DELAY_MS)
      return outcome
    } catch {
      return 'ignored'
    }
  }

  return { capture, flush, clear }
}

// ------------------------------------------------------------------ browser wiring

let reporter: Reporter | null = null

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // fall through
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

let buildId: Promise<string> | null = null

/** This page's build id: `builtAt` of the `build.json` its deploy serves ('dev' in the dev server). */
function readBuild(): Promise<string> {
  if (!import.meta.env.PROD) return Promise.resolve('dev')
  buildId ??= fetch(`${import.meta.env.BASE_URL}build.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<{ builtAt?: unknown }>) : null))
    .then((j) => (j && typeof j.builtAt === 'string' && /^[0-9A-Za-z.:_-]{1,40}$/.test(j.builtAt) ? j.builtAt : 'unknown'))
    .catch(() => 'unknown')
  return buildId
}

/** Start capturing (once per page; `boot.ts`). Does nothing in a build without the online layer. */
export function installErrorReporting(): Reporter | null {
  if (reporter || typeof window === 'undefined') return reporter
  const cfg = onlineConfig()
  if (!cfg) return null
  const url = functionUrl(cfg)
  // A post that never settles would hold `flushing` (and so every later report) for the rest of the page's life
  const post = timedFetch((...a) => fetch(...a), 30000)
  const env: ReporterEnv = {
    origin: location.origin,
    userAgent: navigator.userAgent,
    now: () => Date.now(),
    viewport: () => `${Math.max(0, Math.round(window.innerWidth))}x${Math.max(0, Math.round(window.innerHeight))}`,
    where: () => {
      const s = useStore.getState()
      return { screen: s.screen, phase: s.game?.phase ?? 'none' }
    },
    online: () => navigator.onLine !== false,
    enabled: errorReportsOn,
    build: readBuild,
    post: async (reports) => {
      try {
        // A guest call: the publishable key alone, never the session's JWT, so no report is tied to an account
        const r = await post(url, { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.key }, body: JSON.stringify({ op: 'errors.report', reports }), keepalive: true })
        await r.body?.cancel().catch(() => undefined)
        return r.status
      } catch {
        return 0
      }
    },
    load: () => {
      const stored = loadRecord().errors
      return stored ? parseErrorState(stored, uuid) : null
    },
    save: (s) => void updateRecord((r) => ({ ...r, errors: s })),
    randomId: uuid,
    later: (fn, ms) => void setTimeout(fn, ms),
  }
  const rep = createReporter(env)
  reporter = rep
  const take = (kind: ReportKind, error: unknown) => void rep.capture(kind, error)
  window.addEventListener('error', (e: ErrorEvent) => take('error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => take('rejection', e.reason))
  window.addEventListener('vite:preloadError', (e: Event) => take('chunk', (e as Event & { payload?: unknown }).payload ?? 'A module did not load'))
  window.addEventListener(ERROR_EVENT, (e: Event) => {
    const d = (e as CustomEvent<ErrorSignal>).detail
    if (d) take(d.kind, d.error)
  })
  for (const s of takeEarlySignals()) take(s.kind, s.error)
  window.addEventListener('online', () => void rep.flush())
  // Whatever an earlier visit left in the queue goes once the page has settled
  setTimeout(() => void rep.flush(), 8000)
  return rep
}

/** The setting was switched off: empty the queue now (the reporter also checks before every capture and post). */
export function clearErrorReports(): void {
  reporter?.clear()
}
