/**
 * Request validators for the Edge Function (`touchline-e{ENGINE_VERSION}`): every body, every response of the live
 * site and every data index the server reads goes through one of these before anything else looks at it. Pure,
 * DOM-free and bundled into the verifier. The ranked body's fine rules (team-name characters, the payload's own
 * fields) stay in `verifyRanked`, which runs after these and repeats nothing.
 */
import type { LeaguesFile } from '@engine/universe'
import type { BuildInfo } from '../buildInfo'
import { weekStartOf } from '../weekly'

/** Every operation the Phase 1 function answers. Challenge codes are not here: `create_challenge` and
 * `get_challenge` are database functions the client calls directly (the opener's replay decides, as today). */
export const OPS = ['status', 'daily.pin', 'daily.submit', 'weekly.pin', 'weekly.submit', 'account.delete'] as const
export type Op = (typeof OPS)[number]

/** The largest request body accepted, in UTF-8 bytes (a ranked payload is at most 8000 characters). */
export const MAX_BODY_BYTES = 16384

/** What `account.delete` must carry, so a stray call can never delete an account. */
export const DELETE_CONFIRMATION = 'delete my account'

export type ServerRequest =
  | { op: 'status' }
  | { op: 'daily.pin'; date?: string }
  | { op: 'weekly.pin'; week?: string }
  | { op: 'daily.submit' | 'weekly.submit'; encoded: string; teamName: string; shortName: string }
  | { op: 'account.delete'; confirm: typeof DELETE_CONFIRMATION }

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }

const bad = <T>(reason: string): Parsed<T> => ({ ok: false, reason })

/** Keys each operation may carry besides `op`; anything else is refused rather than ignored. */
const ALLOWED: Record<Op, readonly string[]> = {
  status: [],
  'daily.pin': ['date'],
  'weekly.pin': ['week'],
  'daily.submit': ['encoded', 'teamName', 'shortName'],
  'weekly.submit': ['encoded', 'teamName', 'shortName'],
  'account.delete': ['confirm'],
}

/** A real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse and check a request body (the raw text, so the size is checked before any parsing). */
export function parseRequest(text: string): Parsed<ServerRequest> {
  if (typeof text !== 'string' || !text) return bad('The request has no body')
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return bad(`The request is larger than ${MAX_BODY_BYTES} bytes`)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return bad('The request is not JSON')
  }
  if (!isRecord(raw)) return bad('The request is not an object')
  const op = raw.op
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return bad('Unknown operation')
  const known = ALLOWED[op as Op]
  const extra = Object.keys(raw).filter((k) => k !== 'op' && !known.includes(k))
  if (extra.length) return bad(`Unexpected field ${extra[0]}`)
  switch (op as Op) {
    case 'status':
      return { ok: true, value: { op: 'status' } }
    case 'daily.pin': {
      if (raw.date === undefined) return { ok: true, value: { op: 'daily.pin' } }
      if (typeof raw.date !== 'string' || !isIsoDate(raw.date)) return bad('date is a YYYY-MM-DD day')
      return { ok: true, value: { op: 'daily.pin', date: raw.date } }
    }
    case 'weekly.pin': {
      if (raw.week === undefined) return { ok: true, value: { op: 'weekly.pin' } }
      if (typeof raw.week !== 'string' || !weekStartOf(raw.week)) return bad('week is an ISO week such as 2026-W43')
      return { ok: true, value: { op: 'weekly.pin', week: raw.week } }
    }
    case 'daily.submit':
    case 'weekly.submit': {
      const { encoded, teamName, shortName } = raw
      if (typeof encoded !== 'string' || encoded.length < 1 || encoded.length > 8100) return bad('encoded is the run payload (at most 8000 characters)')
      if (typeof teamName !== 'string' || teamName.length > 64) return bad('teamName is text')
      if (typeof shortName !== 'string' || shortName.length > 8) return bad('shortName is text')
      return { ok: true, value: { op: op as 'daily.submit' | 'weekly.submit', encoded, teamName, shortName } }
    }
    case 'account.delete':
      if (raw.confirm !== DELETE_CONFIRMATION) return bad(`account.delete needs confirm: "${DELETE_CONFIRMATION}"`)
      return { ok: true, value: { op: 'account.delete', confirm: DELETE_CONFIRMATION } }
  }
}

/** The shape of a data stamp, as `private.data_packs.version` accepts it. */
export const STAMP_RE = /^[0-9A-Za-z._:-]{1,40}$/
const ENGINE_RE = /^[0-9A-Za-z._-]{1,16}$/
const LEAGUE_RE = /^[a-z][a-z0-9-]{1,30}$/

/** The live site's `build.json`, or null when it is not one. */
export function parseBuildInfo(raw: unknown): BuildInfo | null {
  if (!isRecord(raw)) return null
  const { engine, data, builtAt } = raw
  if (typeof engine !== 'string' || !ENGINE_RE.test(engine)) return null
  if (typeof data !== 'string' || !STAMP_RE.test(data)) return null
  if (typeof builtAt !== 'string' || builtAt.length > 40) return null
  return { engine, data, builtAt }
}

/** A `leagues.json` that names `version` and lists between 1 and 32 well-formed, distinct league ids. */
export function parseLeaguesIndex(raw: unknown, version: string): Parsed<LeaguesFile> {
  if (!isRecord(raw)) return bad('leagues.json is not an object')
  if (raw.generatedAt !== version) return bad(`leagues.json is stamped ${String(raw.generatedAt)}, not ${version}`)
  const leagues = raw.leagues
  if (!Array.isArray(leagues) || leagues.length < 1 || leagues.length > 32) return bad('leagues.json lists no leagues')
  const ids = new Set<string>()
  for (const l of leagues) {
    if (!isRecord(l) || typeof l.id !== 'string' || !LEAGUE_RE.test(l.id) || ids.has(l.id)) return bad('leagues.json has a malformed league')
    ids.add(l.id)
  }
  return { ok: true, value: raw as unknown as LeaguesFile }
}

/** The 8-character user-id prefix the logs carry (never the whole id, a body or a token). */
export function logId(userId: string): string {
  return userId.replace(/[^0-9a-f]/gi, '').slice(0, 8)
}
