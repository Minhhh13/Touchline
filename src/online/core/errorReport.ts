/**
 * Error reports, the pure half (docs/ONLINE.md section 5f): what one report holds, how a stack is trimmed to our own
 * frames, how text is scrubbed of anything personal, and the device's queue (deduplicated, rate-limited, kept offline).
 * Shared by the client (`src/online/errors.ts`) and the Edge Function's validator (`server/validate.ts`), so it imports
 * nothing and touches no DOM: the client passes in the page's origin, the clock and the user agent.
 *
 * A report never holds game data, an account id, an email or a token: only the message and our own stack frames
 * (both scrubbed), the build, the engine, the screen and phase, the viewport, a browser and OS family and a random id
 * made for error reports alone on this device.
 */

export const REPORT_KINDS = ['error', 'rejection', 'boundary', 'chunk'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface ErrorReport {
  kind: ReportKind
  message: string
  /** Our own frames only, one per line, origin and query stripped (`/assets/Draft-abc123.js:1:2345`). */
  stack: string
  /** `builtAt` of the page's `build.json` ('dev' in the dev server, 'unknown' when it could not be read). */
  build: string
  engine: string
  screen: string
  phase: string
  /** `1280x720`, the window's inner size. */
  viewport: string
  /** A browser and OS family (`safari/ios`), never the full user agent. */
  ua: string
  /** The random id this device made for error reports (`touchline-online-v1`'s `errors.id`), nothing else's. */
  device: string
  /** How many times this device saw it before the report went (deduplicated). */
  count: number
  /** When it was first seen, ISO. */
  at: string
}

/** The longest message, stack, and each other field a report may carry, in characters. The server refuses longer. */
export const REPORT_CAPS = { message: 300, stack: 1200, frames: 8, frame: 160, build: 40, engine: 16, screen: 24, phase: 24, viewport: 11, ua: 24, device: 36 } as const
/** Reports per request. */
export const REPORTS_PER_POST = 5
/** A device sends at most this many reports an hour and a day; more are dropped, never queued. */
export const DEVICE_LIMITS = { hour: 10, day: 30 } as const
/** The queue waiting to go (offline, or the server busy) never holds more than this; the oldest go first. */
export const QUEUE_CAP = 20
/** The same error (kind, message and first frame) is reported at most once a day per device; repeats only count. */
export const DEDUPE_MS = 86400000
const SEEN_CAP = 60

export const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const VIEWPORT_RE = /^\d{1,5}x\d{1,5}$/
export const UA_RE = /^[a-z]{1,10}\/[a-z]{1,10}$/
export const LABEL_RE = /^[a-z0-9_-]{1,24}$/

/**
 * Text with anything that could name a person or hold a secret taken out: emails, JWTs and other long tokens, and the
 * query and hash of every URL (a challenge link's `#c=` carries a draft; an auth redirect carries a token).
 */
export function scrubText(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?/g, '<token>')
    .replace(/\bsb_[a-z]+_[A-Za-z0-9_-]{8,}/g, '<key>')
    .replace(/((?:https?|blob|file):\/\/[^\s?#'")]*)[?#][^\s'")]*/g, '$1')
    // A long run of token characters with a digit in it (a seat token, a hash); a path's slashes and dots break runs,
    // so file names and identifiers stay
    .replace(/(?=[A-Za-z0-9_+-]*\d)[A-Za-z0-9_+-]{32,}={0,2}/g, '<redacted>')
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)

/** The message of anything thrown, scrubbed and capped. */
export function messageOf(e: unknown): string {
  let m: string
  if (e instanceof Error) m = e.name && e.name !== 'Error' && !e.message.startsWith(e.name) ? `${e.name}: ${e.message}` : e.message
  else if (typeof e === 'string') m = e
  else {
    try {
      m = JSON.stringify(e) ?? String(e)
    } catch {
      m = String(e)
    }
  }
  return clip(scrubText(m.replace(/\s+/g, ' ').trim()) || '(no message)', REPORT_CAPS.message)
}

/**
 * Only the frames of our own scripts (`origin`, the page's), each reduced to its path and position with the origin,
 * query and hash gone, at most `REPORT_CAPS.frames` of them. Extensions', other sites' and the browser's own frames go.
 */
export function trimStack(stack: string | undefined, origin: string): string {
  if (!stack || !origin) return ''
  const out: string[] = []
  for (const raw of stack.split('\n')) {
    const line = raw.trim()
    const at = line.indexOf(origin)
    if (at < 0) continue
    const rest = line.slice(at + origin.length)
    const m = /^(\/[^\s?#)]*)(?:[?#][^\s:)]*)?(:\d+:\d+|:\d+)?/.exec(rest)
    if (!m) continue
    // The function's name, when the engine gives one before the location (V8 `at fn (url)`, Gecko and WebKit `fn@url`)
    const fn = /^(?:at\s+)?([A-Za-z0-9_$.<>[\]]{1,60})(?:\s+\(|@)/.exec(line.slice(0, at))?.[1]
    out.push(clip(scrubText(`${fn && fn !== 'at' ? `${fn} ` : ''}${m[1]}${m[2] ?? ''}`), REPORT_CAPS.frame))
    if (out.length >= REPORT_CAPS.frames) break
  }
  return clip(out.join('\n'), REPORT_CAPS.stack)
}

/** A browser and OS family from a user agent: `chrome/android`, `safari/ios`, `firefox/windows`, `other/other`. */
export function uaFamily(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /CrOS/.test(ua) ? 'chromeos' : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : 'other'
  const browser = /Edg\//.test(ua)
    ? 'edge'
    : /SamsungBrowser/.test(ua)
      ? 'samsung'
      : /OPR\/|Opera/.test(ua)
        ? 'opera'
        : /Firefox\/|FxiOS/.test(ua)
          ? 'firefox'
          : /CriOS|Chrome\//.test(ua)
            ? 'chrome'
            : /Safari\//.test(ua) || /AppleWebKit/.test(ua)
              ? 'safari'
              : 'other'
  return `${browser}/${os}`
}

/** A short label (screen, phase) as reports carry it: lower case, `[a-z0-9_-]`, or `none`. */
export function labelOf(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, REPORT_CAPS.screen) : ''
  return s || 'none'
}

/** What the device recognises a repeat by: the kind, the message and the first of our frames. */
export function fingerprintOf(r: Pick<ErrorReport, 'kind' | 'message' | 'stack'>): string {
  const key = `${r.kind}|${r.message}|${r.stack.split('\n')[0] ?? ''}`
  // FNV-1a, 32-bit, twice with different offsets: a key, not a secret
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < key.length; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), 0x01000193)
    b = Math.imul(b ^ key.charCodeAt(i), 0x01000197)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** The device's error-report state, kept in `touchline-online-v1` (`OnlineRecord.errors`). */
export interface ErrorState {
  /** A random UUID made for error reports alone (not the sync record's device id). */
  id: string
  /** Reports waiting to go. */
  queue: ErrorReport[]
  /** Fingerprint -> when it was last admitted (epoch ms). */
  seen: Record<string, number>
  /** When each report of the last day was admitted (epoch ms), for the hourly and daily limits. */
  sent: number[]
  /** Epoch ms before which the queue is not posted again (after a refusal or a failed post). */
  nextAt: number
  /** Failed posts in a row, for the back-off. */
  failures: number
}

export function freshErrorState(id: string): ErrorState {
  return { id, queue: [], seen: {}, sent: [], nextAt: 0, failures: 0 }
}

/** A stored error state with every field checked; a fresh one (with `id`) when nothing usable is stored. */
export function parseErrorState(v: unknown, id: () => string): ErrorState {
  if (!v || typeof v !== 'object') return freshErrorState(id())
  const r = v as Partial<ErrorState>
  if (typeof r.id !== 'string' || !DEVICE_ID_RE.test(r.id)) return freshErrorState(id())
  return {
    id: r.id,
    queue: Array.isArray(r.queue) ? r.queue.filter((q) => reportProblem(q) === null).slice(-QUEUE_CAP) : [],
    seen: r.seen && typeof r.seen === 'object' ? Object.fromEntries(Object.entries(r.seen).filter(([, t]) => typeof t === 'number')) : {},
    sent: Array.isArray(r.sent) ? r.sent.filter((t) => typeof t === 'number') : [],
    nextAt: typeof r.nextAt === 'number' ? r.nextAt : 0,
    failures: typeof r.failures === 'number' ? r.failures : 0,
  }
}

export type Admission = 'queued' | 'repeat' | 'limited'

/**
 * Take a new report in at `now`: a repeat of one seen in the last day only adds to the count of the copy still
 * waiting (or nothing, once sent); past the hourly or daily limit it is dropped. The queue keeps its newest
 * `QUEUE_CAP`. Pure: returns the next state.
 */
export function admit(s: ErrorState, report: ErrorReport, now: number): { state: ErrorState; outcome: Admission } {
  const fp = fingerprintOf(report)
  const sent = s.sent.filter((t) => now - t < 86400000 && t <= now)
  const last = s.seen[fp]
  if (last !== undefined && now - last < DEDUPE_MS && last <= now) {
    const queue = s.queue.map((q) => (fingerprintOf(q) === fp ? { ...q, count: Math.min(q.count + 1, 1000) } : q))
    return { state: { ...s, sent, queue }, outcome: 'repeat' }
  }
  if (sent.filter((t) => now - t < 3600000).length >= DEVICE_LIMITS.hour || sent.length >= DEVICE_LIMITS.day) return { state: { ...s, sent }, outcome: 'limited' }
  const seenEntries = Object.entries({ ...s.seen, [fp]: now }).filter(([, t]) => now - t < DEDUPE_MS)
  const seen = Object.fromEntries(seenEntries.sort((x, y) => x[1] - y[1]).slice(-SEEN_CAP))
  return { state: { ...s, sent: [...sent, now], seen, queue: [...s.queue, report].slice(-QUEUE_CAP) }, outcome: 'queued' }
}

/** The state after a post of the first `n` queued reports: `ok` drops them; a refusal (`drop`) drops them too, since
 * the server will never take them; anything else keeps them and backs off (1, 2, 4 ... minutes, at most an hour). */
export function afterPost(s: ErrorState, n: number, outcome: 'ok' | 'drop' | 'retry', now: number): ErrorState {
  if (outcome === 'retry') {
    const failures = s.failures + 1
    return { ...s, failures, nextAt: now + Math.min(60, 2 ** (failures - 1)) * 60000 }
  }
  return { ...s, queue: s.queue.slice(n), failures: 0, nextAt: 0 }
}

/** Why a report is not one the server takes, or null. The server's validator (`parseRequest`) runs exactly this. */
export function reportProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a report is an object'
  const r = v as Record<string, unknown>
  const keys = ['kind', 'message', 'stack', 'build', 'engine', 'screen', 'phase', 'viewport', 'ua', 'device', 'count', 'at']
  const extra = Object.keys(r).find((k) => !keys.includes(k))
  if (extra) return `unexpected report field ${extra}`
  if (!(REPORT_KINDS as readonly unknown[]).includes(r.kind)) return 'kind is error, rejection, boundary or chunk'
  if (typeof r.message !== 'string' || r.message.length < 1 || r.message.length > REPORT_CAPS.message) return `message is 1 to ${REPORT_CAPS.message} characters`
  if (typeof r.stack !== 'string' || r.stack.length > REPORT_CAPS.stack || r.stack.split('\n').length > REPORT_CAPS.frames) return `stack is at most ${REPORT_CAPS.frames} frames`
  if (typeof r.build !== 'string' || !/^[0-9A-Za-z.:_-]{1,40}$/.test(r.build)) return 'build is the build id'
  if (typeof r.engine !== 'string' || !/^[0-9A-Za-z._-]{1,16}$/.test(r.engine)) return 'engine is the engine version'
  if (typeof r.screen !== 'string' || !LABEL_RE.test(r.screen)) return 'screen is a screen name'
  if (typeof r.phase !== 'string' || !LABEL_RE.test(r.phase)) return 'phase is a phase name'
  if (typeof r.viewport !== 'string' || !VIEWPORT_RE.test(r.viewport)) return 'viewport is WIDTHxHEIGHT'
  if (typeof r.ua !== 'string' || !UA_RE.test(r.ua)) return 'ua is a browser/os family'
  if (typeof r.device !== 'string' || !DEVICE_ID_RE.test(r.device)) return 'device is the reports id'
  if (typeof r.count !== 'number' || !Number.isInteger(r.count) || r.count < 1 || r.count > 1000) return 'count is 1 to 1000'
  if (typeof r.at !== 'string' || r.at.length > 30 || Number.isNaN(Date.parse(r.at))) return 'at is an ISO time'
  // What the client scrubs, the server checks again: a report that still holds an email or a token is refused
  if (scrubText(r.message) !== r.message || scrubText(r.stack) !== r.stack) return 'a report may not hold an email, a token or a URL query'
  return null
}
