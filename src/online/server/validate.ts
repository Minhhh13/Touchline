/**
 * Request validators for the Edge Function (`touchline-e{ENGINE_VERSION}`): every body, every response of the live
 * site and every data index the server reads goes through one of these before anything else looks at it. Pure,
 * DOM-free and bundled into the verifier. The ranked body's fine rules (team-name characters, the payload's own
 * fields) stay in `verifyRanked`, which runs after these and repeats nothing.
 */
import type { LeaguesFile } from '@engine/universe'
import type { BuildInfo } from '../buildInfo'
import type { RoomManagerInput, RoomSettings } from '@game/logic/h2hRoom'
import { weekStartOf } from '../weekly'
import { REPORTS_PER_POST, reportProblem, type ErrorReport } from '../core/errorReport'
import { CASUAL_BOARDS, type CasualBoard } from './casualVerify'

/** Every operation the function answers. Challenge codes are not here: `create_challenge` and `get_challenge` are
 * database functions the client calls directly (the opener's replay decides, as today). `chase.*` are the 38-0 chase's;
 * `casual.submit` posts to the casual modes' boards (the Daily Arena, the Weekly Challenge, the Run-in of the week);
 * the `room.*` ops are Phase 2's
 * online head-to-head rooms; `errors.report` files the client's error reports (docs/ONLINE.md section 5f). Those two
 * are the only ones a guest (no account) may call. */
export const OPS = ['status', 'daily.pin', 'daily.submit', 'weekly.pin', 'weekly.submit', 'chase.start', 'chase.submit', 'casual.submit', 'account.delete', 'room.create', 'room.join', 'room.pick', 'room.leave', 'room.resume', 'errors.report'] as const
export type Op = (typeof OPS)[number]

/** The ops a guest may call: the rooms (`room.resume` needs an account, and says so itself). */
export const ROOM_OPS: readonly Op[] = ['room.create', 'room.join', 'room.pick', 'room.leave', 'room.resume']

/** Every op a guest may call: the rooms and the error reports. */
export const GUEST_OPS: readonly Op[] = [...ROOM_OPS, 'errors.report']

/** The largest request body accepted, in UTF-8 bytes (a ranked payload is at most 8000 characters). */
export const MAX_BODY_BYTES = 16384

/** What `account.delete` must carry, so a stray call can never delete an account. */
export const DELETE_CONFIRMATION = 'delete my account'

export type ServerRequest =
  | { op: 'status' }
  | { op: 'daily.pin'; date?: string }
  | { op: 'weekly.pin'; week?: string }
  | { op: 'daily.submit' | 'weekly.submit' | 'chase.submit'; encoded: string; teamName: string; shortName: string }
  | { op: 'casual.submit'; board: CasualBoard; encoded: string; teamName: string; shortName: string }
  | { op: 'chase.start'; leagueId: string; formationId: string; ratings: 'season' | 'prime'; benchPicks: number; engine: string; data: string }
  | { op: 'account.delete'; confirm: typeof DELETE_CONFIRMATION }
  | { op: 'room.create'; settings: RoomSettings; manager: RoomManagerInput; engine: string; data: string }
  | { op: 'room.join'; code: string; manager: RoomManagerInput; engine: string; data: string }
  | { op: 'room.pick'; code: string; token: string; version: number; playerSeasonId: string; slotId: string }
  | { op: 'room.leave'; code: string; token: string }
  | { op: 'room.resume'; code: string }
  | { op: 'errors.report'; reports: ErrorReport[] }

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string }

const bad = <T>(reason: string): Parsed<T> => ({ ok: false, reason })

/** Keys each operation may carry besides `op`; anything else is refused rather than ignored. */
const ALLOWED: Record<Op, readonly string[]> = {
  status: [],
  'daily.pin': ['date'],
  'weekly.pin': ['week'],
  'daily.submit': ['encoded', 'teamName', 'shortName'],
  'weekly.submit': ['encoded', 'teamName', 'shortName'],
  'chase.start': ['leagueId', 'formationId', 'ratings', 'benchPicks', 'engine', 'data'],
  'chase.submit': ['encoded', 'teamName', 'shortName'],
  'casual.submit': ['board', 'encoded', 'teamName', 'shortName'],
  'account.delete': ['confirm'],
  'room.create': ['settings', 'manager', 'engine', 'data'],
  'room.join': ['code', 'manager', 'engine', 'data'],
  'room.pick': ['code', 'token', 'version', 'playerSeasonId', 'slotId'],
  'room.leave': ['code', 'token'],
  'room.resume': ['code'],
  'errors.report': ['reports'],
}

/** A seat token as the server issues it: 32 random bytes, base64url without padding. */
export const SEAT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

function roomManagerOf(v: unknown): RoomManagerInput | null {
  if (!isRecord(v)) return null
  const extra = Object.keys(v).filter((k) => k !== 'name' && k !== 'formationId' && k !== 'hostClubId')
  if (extra.length) return null
  const { name, formationId, hostClubId } = v
  if (typeof name !== 'string' || name.length > 64 || typeof formationId !== 'string' || formationId.length > 24 || typeof hostClubId !== 'string' || hostClubId.length > 64) return null
  return { name, formationId, hostClubId }
}

function roomSettingsOf(v: unknown): RoomSettings | null {
  if (!isRecord(v)) return null
  const extra = Object.keys(v).filter((k) => !['leagueId', 'wheelLeagues', 'leagueSeason', 'difficulty', 'hardMode'].includes(k))
  if (extra.length) return null
  const { leagueId, wheelLeagues, leagueSeason, difficulty, hardMode } = v
  if (typeof leagueId !== 'string' || !LEAGUE_RE.test(leagueId)) return null
  if (!Array.isArray(wheelLeagues) || wheelLeagues.length < 1 || wheelLeagues.length > 32 || !wheelLeagues.every((l) => typeof l === 'string' && LEAGUE_RE.test(l))) return null
  if (typeof leagueSeason !== 'number' || !Number.isInteger(leagueSeason) || leagueSeason < 1900 || leagueSeason > 2100) return null
  if (difficulty !== 'calibrated' && difficulty !== 'realistic') return null
  if (typeof hardMode !== 'boolean') return null
  return { leagueId, wheelLeagues: wheelLeagues as string[], leagueSeason, difficulty, hardMode }
}

/** The room code of a body: the 8 characters of the seed alphabet, as typed or pasted, or null. */
export function roomCodeOf(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 24) return null
  const code = v.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return /^[A-HJ-NP-Z2-9]{8}$/.test(code) ? code : null
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
    case 'chase.start': {
      const { leagueId, formationId, ratings = 'season', benchPicks = 0, engine, data } = raw
      if (typeof leagueId !== 'string' || !LEAGUE_RE.test(leagueId)) return bad('leagueId is a league id such as england')
      if (typeof formationId !== 'string' || !FORMATION_RE.test(formationId)) return bad('formationId is a shape such as 4-3-3')
      if (typeof engine !== 'string' || !ENGINE_RE.test(engine)) return bad('engine is the engine version the client runs')
      if (typeof data !== 'string' || !STAMP_RE.test(data)) return bad('data is the data stamp the client runs')
      if (ratings !== 'season' && ratings !== 'prime') return bad('ratings is season or prime')
      if (typeof benchPicks !== 'number' || !Number.isInteger(benchPicks) || benchPicks < 0 || benchPicks > 5) return bad('benchPicks is 0 to 5')
      return { ok: true, value: { op: 'chase.start', leagueId, formationId, ratings, benchPicks, engine, data } }
    }
    case 'daily.submit':
    case 'weekly.submit':
    case 'chase.submit': {
      const { encoded, teamName, shortName } = raw
      if (typeof encoded !== 'string' || encoded.length < 1 || encoded.length > 8100) return bad('encoded is the run payload (at most 8000 characters)')
      if (typeof teamName !== 'string' || teamName.length > 64) return bad('teamName is text')
      if (typeof shortName !== 'string' || shortName.length > 8) return bad('shortName is text')
      return { ok: true, value: { op: op as 'daily.submit' | 'weekly.submit' | 'chase.submit', encoded, teamName, shortName } }
    }
    case 'casual.submit': {
      const { board, encoded, teamName, shortName } = raw
      if (typeof board !== 'string' || !(CASUAL_BOARDS as readonly string[]).includes(board)) return bad('board is arena, themed or runin')
      if (typeof encoded !== 'string' || encoded.length < 1 || encoded.length > 8100) return bad('encoded is the run payload (at most 8000 characters)')
      if (typeof teamName !== 'string' || teamName.length > 64) return bad('teamName is text')
      if (typeof shortName !== 'string' || shortName.length > 8) return bad('shortName is text')
      return { ok: true, value: { op: 'casual.submit', board: board as CasualBoard, encoded, teamName, shortName } }
    }
    case 'account.delete':
      if (raw.confirm !== DELETE_CONFIRMATION) return bad(`account.delete needs confirm: "${DELETE_CONFIRMATION}"`)
      return { ok: true, value: { op: 'account.delete', confirm: DELETE_CONFIRMATION } }
    case 'room.create':
    case 'room.join': {
      const manager = roomManagerOf(raw.manager)
      if (!manager) return bad('manager is { name, formationId, hostClubId }')
      if (typeof raw.engine !== 'string' || !ENGINE_RE.test(raw.engine)) return bad('engine is the engine version the client runs')
      if (typeof raw.data !== 'string' || !STAMP_RE.test(raw.data)) return bad('data is the data stamp the client plays on')
      if (op === 'room.create') {
        const settings = roomSettingsOf(raw.settings)
        if (!settings) return bad('settings is { leagueId, wheelLeagues, leagueSeason, difficulty, hardMode }')
        return { ok: true, value: { op: 'room.create', settings, manager, engine: raw.engine, data: raw.data } }
      }
      const code = roomCodeOf(raw.code)
      if (!code) return bad('code is a room code')
      return { ok: true, value: { op: 'room.join', code, manager, engine: raw.engine, data: raw.data } }
    }
    case 'room.pick': {
      const code = roomCodeOf(raw.code)
      if (!code) return bad('code is a room code')
      if (typeof raw.token !== 'string' || !SEAT_TOKEN_RE.test(raw.token)) return bad('token is the seat token')
      if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 0 || raw.version > 100000) return bad('version is the room version the pick was made on')
      if (typeof raw.playerSeasonId !== 'string' || raw.playerSeasonId.length < 1 || raw.playerSeasonId.length > 120) return bad('playerSeasonId is a player-season id')
      if (typeof raw.slotId !== 'string' || raw.slotId.length < 1 || raw.slotId.length > 16) return bad('slotId is a slot id or bench')
      return { ok: true, value: { op: 'room.pick', code, token: raw.token, version: raw.version, playerSeasonId: raw.playerSeasonId, slotId: raw.slotId } }
    }
    case 'room.leave': {
      const code = roomCodeOf(raw.code)
      if (!code) return bad('code is a room code')
      if (typeof raw.token !== 'string' || !SEAT_TOKEN_RE.test(raw.token)) return bad('token is the seat token')
      return { ok: true, value: { op: 'room.leave', code, token: raw.token } }
    }
    case 'room.resume': {
      const code = roomCodeOf(raw.code)
      if (!code) return bad('code is a room code')
      return { ok: true, value: { op: 'room.resume', code } }
    }
    case 'errors.report': {
      const reports = raw.reports
      if (!Array.isArray(reports) || reports.length < 1 || reports.length > REPORTS_PER_POST) return bad(`reports is 1 to ${REPORTS_PER_POST} error reports`)
      for (const r of reports) {
        const problem = reportProblem(r)
        if (problem) return bad(problem)
      }
      return { ok: true, value: { op: 'errors.report', reports: reports as ErrorReport[] } }
    }
  }
}

/** The shape of a data stamp, as `private.data_packs.version` accepts it. */
export const STAMP_RE = /^[0-9A-Za-z._:-]{1,40}$/
const ENGINE_RE = /^[0-9A-Za-z._-]{1,16}$/
const LEAGUE_RE = /^[a-z][a-z0-9-]{1,30}$/
const FORMATION_RE = /^[0-9a-z-]{3,16}$/

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
