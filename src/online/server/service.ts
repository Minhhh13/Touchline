/**
 * The Edge Function's request handler for Phase 1, written against small interfaces (`ServerDeps`) so the whole flow
 * runs in Vitest on real packs with fakes, and on Deno with the Supabase clients (`supabase/functions/touchline`).
 *
 * Ops (section 4 of the online plan): `daily.pin` / `weekly.pin` pin the day's or week's puzzle from the data the
 * live site serves; `daily.submit` / `weekly.submit` replay a posted run with the verifier and file the replay's
 * figures; `chase.start` issues a 38-0 chase attempt (a server-drawn wheel, at most five a day) and `chase.submit`
 * replays and files a run played on one (docs/ONLINE.md section 5d); `account.delete` removes a player's saves and then the account; `status` reports the engine and the live
 * build. Challenge codes need no op: `create_challenge` / `get_challenge` are database functions.
 *
 * Phase 2 adds the online head-to-head rooms (`room.create`, `room.join`, `room.pick`, `room.leave`, `room.resume`;
 * docs/ONLINE.md section 5e), the only ops a guest may call: anonymous sign-ins are off, so a guest is a request with
 * the project's publishable key and no JWT (`Guest`), metered by a hash of its address. A seat is held by a random
 * token the server issues once and stores only hashed; every pick is checked by replaying the room from its seed
 * (`roomPick` in src/game/logic/h2hRoom.ts), and the server files the spins, the picks and the season itself.
 *
 * The user id comes only from the verified JWT (`Caller`), never from the body. Logs carry the op, the outcome, the
 * duration and an 8-character user-id prefix; never a body or a token.
 */
import { decodeChallenge, isArenaPayload, type ChallengePayload } from '@engine/challenge'
import { dailyDateOf } from '@engine/rng'
import type { LoadedUniverse, MetaFile, PlayersFile } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings } from '@game/logic/setup'
import type { H2HManager, H2HResult } from '@game/logic/h2h'
import { cleanSettings, isRoomLog, roomManager, roomPick, roomStart, RoomMoveError, settingsProblem, type RoomEvent, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import type { BuildInfo } from '../buildInfo'
import { weekKeyOf, weekKeyOfSeed, weekStartOf, weeklyGameSettings, weeklyIsOpen } from '../weekly'
import { CHASE_FORMATIONS, chaseCodeOfSeed } from '../chase'
import { puzzleOf, settingsHash, verifyRanked, type PuzzlePin, type PuzzleSettings, type RankedEntry } from './dailyVerify'
import { attemptOpen, verifyChase, type ChaseAttempt } from './chaseVerify'
import { casualIsOpen, casualLeagues, casualPostOf, casualSeedOf, casualSettings, verifyCasual, type CasualBoard, type CasualEntry, type CasualPin } from './casualVerify'
import { archivePath, classicFile, packFiles, puzzleLeagues, universeFromPacks, type LeaguePack } from './packs'
import { logId, parseBuildInfo, parseLeaguesIndex, parseRequest, ROOM_OPS, type ServerRequest } from './validate'

export type BoardKind = PuzzlePin['kind']

/** A pin as the database stores it. */
export interface StoredPin extends PuzzlePin {
  createdAt: string
}

/** A casual board's pin as the database stores it (`private.casual_puzzles`). */
export interface StoredCasualPin extends CasualPin {
  createdAt: string
}

/** A registered data version (`private.data_packs`). `files` maps each pack file to its SHA-256. */
export interface DataPackRow {
  version: string
  leagues: string[]
  files: Record<string, string>
  firstSeenAt: string
}

/** A room as the server reads it (`svc_h2h_room_get`): the public view plus what only the server may hold. */
export interface StoredRoom {
  room: RoomView
  seed: string
  seat0Hash: string
  seat1Hash: string | null
  seat0User: string | null
  seat1User: string | null
}

/** What a room writer answers: `ok` with the room, or why not (the SQL's own statuses). */
export interface RoomWrite {
  status: 'ok' | 'busy' | 'missing' | 'full' | 'closed' | 'conflict' | 'not_seated' | 'not_your_turn' | 'bad'
  room?: RoomView
  seat?: 0 | 1
}

/** The database, through the `svc_*` functions (service role) and the public puzzle tables. */
export interface ServerDb {
  rateLimit(bucket: string, userId: string, limit: number, windowSeconds: number): Promise<boolean>
  /** `date` is the puzzle date (Daily) or the Monday of the week (weekly), `YYYY-MM-DD`. */
  getPin(kind: BoardKind, date: string): Promise<StoredPin | null>
  pin(kind: BoardKind, date: string, settings: PuzzleSettings, hash: string, engine: string, data: string): Promise<StoredPin>
  submit(kind: BoardKind, userId: string, date: string, entry: RankedEntry): Promise<{ status: string } & Record<string, unknown>>
  /** `svc_chase_start`: `{ status: 'ok', attempt, left, cap, resetsAt }` or `{ status: 'limit', ... }`. */
  chaseStart(userId: string, leagueId: string, formationId: string, options: { ratings: 'season' | 'prime'; benchPicks: number }, engine: string, data: string): Promise<{ status: string; attempt?: ChaseAttempt } & Record<string, unknown>>
  /** `svc_chase_attempt`: the caller's own attempt by code, or null. */
  chaseAttempt(userId: string, code: string): Promise<ChaseAttempt | null>
  /** `svc_chase_submit`: `ranked` / `duplicate` / `already_submitted` with positions, or `closed` / `no_attempt`. */
  chaseSubmit(userId: string, code: string, entry: RankedEntry): Promise<{ status: string } & Record<string, unknown>>
  // the casual boards (svc_casual_*): the Daily Arena, the Weekly Challenge, the Run-in of the week
  casualGetPin(board: CasualBoard, key: string): Promise<StoredCasualPin | null>
  casualPin(board: CasualBoard, key: string, settings: PuzzleSettings, hash: string, engine: string, data: string): Promise<StoredCasualPin>
  /** `ranked` / `duplicate` / `already_submitted` with positions, or `closed` / `no_puzzle`. */
  casualSubmit(board: CasualBoard, userId: string, key: string, entry: CasualEntry): Promise<{ status: string } & Record<string, unknown>>
  dataPack(version: string): Promise<DataPackRow | null>
  registerDataPack(version: string, leagues: string[], files: Record<string, string>): Promise<{ status: 'ok' | 'mismatch'; pack: DataPackRow }>
  // online head-to-head rooms (svc_h2h_room_*)
  roomCreate(settings: RoomSettings, manager: H2HManager, seatHash: string, userId: string | null, engine: string, data: string): Promise<RoomWrite>
  roomGet(code: string): Promise<StoredRoom | null>
  roomJoin(code: string, manager: H2HManager, seatHash: string, userId: string | null, events: RoomEvent[], turn: 0 | 1, expectVersion: number): Promise<RoomWrite>
  roomMove(code: string, seat: 0 | 1, seatHash: string, expectVersion: number, events: RoomEvent[], turn: 0 | 1 | null, result: H2HResult | null): Promise<RoomWrite>
  roomLeave(code: string, seatHash: string): Promise<RoomWrite>
  roomReseat(code: string, userId: string, seatHash: string): Promise<RoomWrite>
}

export interface ServerStorage {
  /** A file of the private `packs` bucket, or null when it is not there. */
  getPack(path: string): Promise<Uint8Array | null>
  /** Upload into `packs`; never overwrites an object that is already there. */
  putPack(path: string, bytes: Uint8Array): Promise<void>
  /** Every object name in the `saves` bucket under `<userId>/`. */
  listSaves(userId: string): Promise<string[]>
  removeSaves(paths: string[]): Promise<void>
}

export interface ServerAuth {
  /** Revoke every session of the caller (deleting a user does not revoke tokens already issued). */
  signOutEverywhere(jwt: string): Promise<void>
  deleteUser(userId: string): Promise<void>
}

export interface ServerDeps {
  db: ServerDb
  storage: ServerStorage
  auth: ServerAuth
  /** GET a path of the live site (`build.json`, `data/leagues.json`, ...); null for anything but a 2xx answer. */
  fetchSite(path: string): Promise<Uint8Array | null>
  sha256Hex(bytes: Uint8Array): Promise<string>
  /** A fresh seat token: 32 random bytes, base64url (43 characters). */
  randomToken(): string
  now(): Date
  log(line: Record<string, unknown>): void
}

/** The verified caller: from the JWT, never from the body. */
export interface Caller {
  userId: string
  isAnonymous: boolean
  jwt: string
}

/** A request with the publishable key and no JWT: a guest, who may only play rooms. `subject` is a UUID made from a
 * hash of the client's address (`guestSubject`), the guest's rate-limit key; the address itself goes nowhere. */
export interface Guest {
  guest: true
  subject: string
}

export type Requester = Caller | Guest

const isGuest = (r: Requester): r is Guest => 'guest' in r && r.guest === true

/** The rate-limit subject of a guest: a UUID-shaped SHA-256 of the address (all guests without one share a key). */
export async function guestSubject(address: string | null, sha256Hex: (bytes: Uint8Array) => Promise<string>): Promise<string> {
  const h = await sha256Hex(new TextEncoder().encode(`touchline-guest:${(address ?? '').trim().toLowerCase()}`))
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export interface Reply {
  status: number
  body: Record<string, unknown>
}

export type ErrorCode =
  | 'bad_request'
  | 'guest'
  | 'rate_limited'
  | 'closed'
  | 'no_puzzle'
  | 'engine_mismatch'
  | 'data_mismatch'
  | 'puzzle_mismatch'
  | 'no_attempt'
  | 'invalid_payload'
  | 'invalid_team'
  | 'invalid_picks'
  | 'live_build_unavailable'
  | 'packs_unavailable'
  | 'unavailable'
  | 'unauthorised'
  | 'no_room'
  | 'room_closed'
  | 'room_full'
  | 'not_seated'
  | 'not_your_turn'
  | 'stale'
  | 'invalid_room'
  | 'invalid_manager'
  | 'invalid_pick'
  | 'rooms_busy'
  | 'hand_managed'

/** A failure with its HTTP status, as section 4.8 of the plan lists them. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    reason: string,
    readonly context: Record<string, string> = {},
  ) {
    super(reason)
  }
}

const refuse = (status: number, code: ErrorCode, reason: string, context?: Record<string, string>) => new Refusal(status, code, reason, context)

/** Per-route limits: calls per account per hour. */
export const LIMITS = {
  'daily.submit': 20,
  'weekly.submit': 20,
  'daily.pin': 30,
  'weekly.pin': 30,
  'chase.start': 12,
  'chase.submit': 20,
  'casual.submit': 30,
  'account.delete': 5,
  'room.create': 30,
  'room.join': 60,
  'room.pick': 900,
  'room.leave': 60,
  'room.resume': 30,
} as const

/** How long the live site's `build.json` is trusted per isolate. */
export const LIVE_BUILD_TTL_MS = 5 * 60 * 1000

/** The shortest gap between two fetches of `build.json` per isolate (a forced recheck, or a retry after a failure). */
export const LIVE_BUILD_RECHECK_MS = 30 * 1000

/** The leagues every pinned puzzle is computed on (both mappings are England-only by design). */
export const PUZZLE_LEAGUES = ['england']

/** Universes kept per isolate (England is about 18 MB; seven leagues about 63 MB). */
export const UNIVERSE_CACHE_SIZE = 2

const DAY = 86400000

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The database date of a board key: the Daily's own date, or the Monday of the week. */
export function pinDateOf(kind: BoardKind, key: string): string {
  if (kind === 'daily') return key
  const start = weekStartOf(key)
  if (!start) throw refuse(422, 'invalid_payload', `${key} is not an ISO week`)
  return dayKey(start)
}

/** Whether a puzzle can still be pinned and posted to: the Daily today or yesterday (UTC), the weekly while open. */
export function boardIsOpen(kind: BoardKind, key: string, now: Date): boolean {
  if (kind === 'weekly') return weeklyIsOpen(key, now)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const t = Date.parse(`${key}T00:00:00Z`)
  return t === today || t === today - DAY
}

const decoder = new TextDecoder()
const parseJson = (bytes: Uint8Array): unknown => JSON.parse(decoder.decode(bytes))

export interface Server {
  handle(caller: Requester, text: string): Promise<Reply>
}

export function createServer(deps: ServerDeps): Server {
  let liveCache: { at: number; value: BuildInfo } | null = null
  const pinCache = new Map<string, StoredPin>()
  const ensuring = new Map<string, Promise<DataPackRow | null>>()
  const universes = new Map<string, Promise<LoadedUniverse>>()

  let lastFetchAt = Number.NEGATIVE_INFINITY

  /**
   * The live site's build.json, trusted for LIVE_BUILD_TTL_MS. `fresh` asks again once the copy is older than
   * LIVE_BUILD_RECHECK_MS: a run on data the cached copy does not name may come from a deploy minutes old, and its
   * refusal (`data_mismatch`) is final for the client. Fetches, failed ones included, are at most one per
   * LIVE_BUILD_RECHECK_MS per isolate, so posts cannot turn the function into a request loop against the site.
   */
  async function liveBuild(fresh = false): Promise<BuildInfo | null> {
    const at = deps.now().getTime()
    if (liveCache && at - liveCache.at < (fresh ? LIVE_BUILD_RECHECK_MS : LIVE_BUILD_TTL_MS)) return liveCache.value
    if (at - lastFetchAt < LIVE_BUILD_RECHECK_MS) return liveCache && at - liveCache.at < LIVE_BUILD_TTL_MS ? liveCache.value : null
    lastFetchAt = at
    const bytes = await deps.fetchSite('build.json')
    let value: BuildInfo | null = null
    try {
      value = bytes ? parseBuildInfo(parseJson(bytes)) : null
    } catch {
      value = null
    }
    if (value) liveCache = { at, value }
    // A failed recheck keeps a copy that is still within its TTL
    else if (liveCache && at - liveCache.at < LIVE_BUILD_TTL_MS) return liveCache.value
    return value
  }

  /** Make sure `version` is archived and registered; null when it is neither registered nor served live now. */
  function ensurePacks(version: string): Promise<DataPackRow | null> {
    const running = ensuring.get(version)
    if (running) return running
    const job = (async () => {
      const known = await deps.db.dataPack(version)
      if (known) return known
      let live = await liveBuild()
      // The cached build.json may predate a deploy of this data: ask the site again before refusing it
      if (!live || live.data !== version) live = await liveBuild(true)
      if (!live || live.data !== version) return null
      const indexBytes = await deps.fetchSite('data/leagues.json')
      if (!indexBytes) throw refuse(503, 'packs_unavailable', 'The live site did not serve leagues.json')
      const index = parseLeaguesIndex(parseJson(indexBytes), version)
      if (!index.ok) throw refuse(503, 'packs_unavailable', index.reason)
      const leagues = index.value.leagues.map((l) => l.id)
      const bytesOf: Record<string, Uint8Array> = { 'leagues.json': indexBytes }
      for (const file of packFiles(leagues, index.value).slice(1)) {
        const b = await deps.fetchSite(`data/${file}`)
        if (!b) throw refuse(503, 'packs_unavailable', `The live site did not serve ${file}`)
        if (file.endsWith('/players.json') || file.endsWith('/players-classic.json')) {
          const stamp = (parseJson(b) as { generatedAt?: unknown }).generatedAt
          if (stamp !== version) throw refuse(503, 'packs_unavailable', `${file} is stamped ${String(stamp)}, not ${version}`)
        }
        bytesOf[file] = b
      }
      const files: Record<string, string> = {}
      for (const [file, b] of Object.entries(bytesOf)) files[file] = await deps.sha256Hex(b)
      for (const [file, b] of Object.entries(bytesOf)) await deps.storage.putPack(archivePath(version, file), b)
      const reg = await deps.db.registerDataPack(version, leagues, files)
      if (reg.status === 'mismatch') deps.log({ level: 'error', event: 'pack_mismatch', version, note: 'the live site serves other bytes under a registered stamp; the archived bytes win' })
      else deps.log({ event: 'pack_archived', version, leagues: leagues.length })
      return reg.pack
    })()
    ensuring.set(version, job)
    job.then(
      () => ensuring.delete(version),
      () => ensuring.delete(version),
    )
    return job
  }

  async function buildUniverse(reg: DataPackRow, leagues: string[]): Promise<LoadedUniverse> {
    const read = async (file: string): Promise<unknown> => {
      const expected = reg.files[file]
      if (!expected) throw refuse(503, 'packs_unavailable', `Data ${reg.version} has no ${file}`)
      const bytes = await deps.storage.getPack(archivePath(reg.version, file))
      if (!bytes) throw refuse(503, 'packs_unavailable', `The archive has no ${file} for ${reg.version}`)
      if ((await deps.sha256Hex(bytes)) !== expected) throw refuse(503, 'packs_unavailable', `The archived ${file} of ${reg.version} does not match its hash`)
      return parseJson(bytes)
    }
    const index = parseLeaguesIndex(await read('leagues.json'), reg.version)
    if (!index.ok) throw refuse(503, 'packs_unavailable', index.reason)
    const packs: Record<string, LeaguePack> = {}
    for (const id of leagues) {
      // A version archived with a classic pack rebuilds with it, as the browser that played on it did
      const classic = reg.files[classicFile(id)] ? ((await read(classicFile(id))) as PlayersFile) : undefined
      packs[id] = { players: (await read(`${id}/players.json`)) as PlayersFile, meta: (await read(`${id}/meta.json`)) as MetaFile, ...(classic ? { classic } : {}) }
    }
    return universeFromPacks(index.value, packs, leagues)
  }

  /** The universe of a registered version and some leagues, from a per-isolate cache of the last two. */
  function universe(reg: DataPackRow, leagues: string[]): Promise<LoadedUniverse> {
    const missing = leagues.filter((id) => !reg.leagues.includes(id))
    if (missing.length) return Promise.reject(refuse(409, 'data_mismatch', `Data ${reg.version} has no ${missing.join(', ')} pack`))
    // The registry lists leagues in the index's order, the order mergeUniverses uses
    const ordered = reg.leagues.filter((id) => leagues.includes(id))
    const key = `${reg.version}|${ordered.join(',')}`
    const hit = universes.get(key)
    if (hit) {
      universes.delete(key)
      universes.set(key, hit)
      return hit
    }
    const job = buildUniverse(reg, ordered)
    universes.set(key, job)
    job.catch(() => universes.delete(key))
    while (universes.size > UNIVERSE_CACHE_SIZE) universes.delete(universes.keys().next().value as string)
    return job
  }

  async function pinFor(kind: BoardKind, key: string, now: Date): Promise<StoredPin> {
    const cacheKey = `${kind}|${key}`
    const cached = pinCache.get(cacheKey)
    if (cached) return cached
    const date = pinDateOf(kind, key)
    const existing = await deps.db.getPin(kind, date)
    if (existing) {
      pinCache.set(cacheKey, existing)
      return existing
    }
    if (!boardIsOpen(kind, key, now)) throw refuse(409, 'closed', kind === 'daily' ? 'That Daily has closed' : 'That week has closed')
    const live = await liveBuild()
    if (!live) throw refuse(503, 'live_build_unavailable', 'The live site does not say which engine and data it serves')
    // Only the live engine pins, so a stale tab calling an old function cannot pin today on an old engine
    if (live.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `The live site runs engine ${live.engine}; this function runs ${ENGINE_VERSION}`, { liveEngine: live.engine })
    const reg = await ensurePacks(live.data)
    if (!reg) throw refuse(503, 'packs_unavailable', `Data ${live.data} could not be archived`)
    const u = await universe(reg, PUZZLE_LEAGUES)
    const full = kind === 'daily' ? dailyGameSettings(u, `daily-${key}`) : weeklyGameSettings(u, key)
    const settings = puzzleOf(full)
    if (puzzleLeagues(settings).some((id) => !PUZZLE_LEAGUES.includes(id))) throw refuse(503, 'unavailable', 'The puzzle mapping needs leagues the pin does not load')
    const stored = await deps.db.pin(kind, date, settings, settingsHash(settings), ENGINE_VERSION, live.data)
    pinCache.set(cacheKey, stored)
    return stored
  }

  const casualPins = new Map<string, StoredCasualPin>()

  /**
   * A casual board's pin, made by the first ranked post of the period as the Daily's is: only by the live engine, on
   * the data the live site serves, from the mode's own mapping (`casualSettings`).
   */
  async function casualPinFor(board: CasualBoard, key: string, now: Date): Promise<StoredCasualPin> {
    const cacheKey = `${board}|${key}`
    const cached = casualPins.get(cacheKey)
    if (cached) return cached
    const existing = await deps.db.casualGetPin(board, key)
    if (existing) {
      casualPins.set(cacheKey, existing)
      return existing
    }
    if (!casualIsOpen(board, key, now)) throw refuse(409, 'closed', 'That board has closed')
    const live = await liveBuild()
    if (!live) throw refuse(503, 'live_build_unavailable', 'The live site does not say which engine and data it serves')
    if (live.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `The live site runs engine ${live.engine}; this function runs ${ENGINE_VERSION}`, { liveEngine: live.engine })
    const reg = await ensurePacks(live.data)
    if (!reg) throw refuse(503, 'packs_unavailable', `Data ${live.data} could not be archived`)
    const seed = casualSeedOf(board, key)
    const leagues = casualLeagues(board, seed, reg.leagues)
    if (!leagues.length) throw refuse(503, 'unavailable', 'The puzzle names no league this data has')
    const u = await universe(reg, leagues)
    const full = casualSettings(u, board, seed)
    if (!full) throw refuse(503, 'unavailable', `Data ${live.data} has no puzzle for ${key}`)
    const settings = puzzleOf(full)
    const stored = await deps.db.casualPin(board, key, settings, settingsHash(settings), ENGINE_VERSION, live.data)
    casualPins.set(cacheKey, stored)
    return stored
  }

  async function submitCasual(caller: Caller, req: Extract<ServerRequest, { op: 'casual.submit' }>, now: Date): Promise<Reply> {
    const post = casualPostOf(req.board, req.encoded)
    if (!post) throw refuse(422, 'invalid_payload', req.board === 'arena' ? 'Not a Daily Arena run' : req.board === 'themed' ? 'Not a Weekly Challenge run' : 'Not a Run-in of the week')
    const { key } = post
    if (!casualIsOpen(req.board, key, now)) throw refuse(409, 'closed', 'That board has closed')
    const pin = await casualPinFor(req.board, key, now)
    const { reg, allowed } = await dataFor(pin.dataVersion, pin.createdAt, post.data)
    const u = await universe(reg, casualLeagues(req.board, pin.seed, reg.leagues))
    const verdict = verifyCasual(u, pin, { encoded: req.encoded, teamName: req.teamName, shortName: req.shortName }, now, () => allowed)
    if (!verdict.ok) throw refuse(verdict.status, verdict.code, verdict.reason, verdict.context)
    const e = verdict.entry
    const result = await deps.db.casualSubmit(req.board, caller.userId, key, e)
    if (result.status === 'closed') throw refuse(409, 'closed', 'That board has closed')
    if (result.status === 'no_puzzle') throw refuse(409, 'no_puzzle', 'There is no ranked puzzle for that period')
    return { status: 200, body: { ...result, board: req.board, key, official: { points: e.score, score: e.score, won: e.won, drawn: e.drawn, lost: e.lost, goalsFor: e.goals_for, goalsAgainst: e.goals_against, leaguePosition: e.league_position, trophy: e.trophy, detail: e.detail, claimMatched: e.claim_matched } } }
  }

  /** The board key a posted seed belongs to, or a refusal. */
  function keyOfPayload(kind: BoardKind, c: ChallengePayload): string {
    if (kind === 'daily') {
      const d = dailyDateOf(c.s.seed)
      if (!d) throw refuse(422, 'invalid_payload', 'Not a Daily')
      return dayKey(d)
    }
    const key = weekKeyOfSeed(c.s.seed)
    if (!key) throw refuse(422, 'invalid_payload', 'Not a weekly challenge')
    return key
  }

  /**
   * The registered data a run is verified on: the pin's (or attempt's) own, or the run's when the live site served it
   * after the pin was made (a mid-day rebuild), which is then `allowed` to rank.
   */
  async function dataFor(pinData: string, pinCreatedAt: string, runData: string): Promise<{ reg: DataPackRow; allowed: boolean }> {
    const pinned = await deps.db.dataPack(pinData)
    if (!pinned) throw refuse(503, 'packs_unavailable', `The pinned data ${pinData} is not registered`)
    if (runData !== pinData && /^[0-9A-Za-z._:-]{1,40}$/.test(runData)) {
      const other = await ensurePacks(runData)
      if (other && Date.parse(other.firstSeenAt) > Date.parse(pinCreatedAt)) return { reg: other, allowed: true }
    }
    return { reg: pinned, allowed: false }
  }

  /**
   * Issue a 38-0 chase attempt: only on the live engine and the data the live site serves (a stale tab is told to
   * reload before an attempt is spent), with the data archived first so the run can be verified on it later.
   */
  async function startChase(caller: Caller, req: { leagueId: string; formationId: string; ratings: 'season' | 'prime'; benchPicks: number; engine: string; data: string }): Promise<Reply> {
    if (req.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `This device runs engine ${req.engine}; the chase runs on engine ${ENGINE_VERSION}: reload`, { liveEngine: ENGINE_VERSION })
    if (!CHASE_FORMATIONS.includes(req.formationId)) throw refuse(422, 'invalid_payload', `${req.formationId} is not a shape the game knows`)
    let live = await liveBuild()
    if (live && live.data !== req.data) live = await liveBuild(true)
    if (!live) throw refuse(503, 'live_build_unavailable', 'The live site does not say which engine and data it serves')
    if (live.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `The live site runs engine ${live.engine}; this function runs ${ENGINE_VERSION}`, { liveEngine: live.engine })
    if (live.data !== req.data) throw refuse(409, 'data_mismatch', `This device has data from ${req.data}; the live site serves ${live.data}: reload to play the chase`, { liveData: live.data })
    const reg = await ensurePacks(live.data)
    if (!reg) throw refuse(503, 'packs_unavailable', `Data ${live.data} could not be archived`)
    if (!reg.leagues.includes(req.leagueId)) throw refuse(422, 'invalid_payload', `Data ${live.data} has no ${req.leagueId} league`)
    const result = await deps.db.chaseStart(caller.userId, req.leagueId, req.formationId, { ratings: req.ratings, benchPicks: req.benchPicks }, ENGINE_VERSION, live.data)
    if (result.status === 'limit') throw refuse(429, 'rate_limited', 'No chase runs left today: they come back at 00:00 UTC', { resetsAt: String(result.resetsAt ?? '') })
    if (result.status !== 'ok' || !result.attempt) throw refuse(503, 'unavailable', 'The attempt could not be issued')
    return { status: 200, body: result }
  }

  async function submitChase(caller: Caller, req: { encoded: string; teamName: string; shortName: string }, now: Date): Promise<Reply> {
    let c: ChallengePayload
    try {
      c = decodeChallenge(req.encoded.trim().replace(/^#?c=/, ''))
    } catch (e) {
      throw refuse(422, 'invalid_payload', e instanceof Error ? e.message : String(e))
    }
    const code = isArenaPayload(c) ? null : chaseCodeOfSeed(c.s.seed)
    if (!code) throw refuse(422, 'invalid_payload', 'Not a 38-0 chase run')
    // The user id comes from the JWT: another account's wheel, or a seed the server never issued, is not this account's run
    const attempt = await deps.db.chaseAttempt(caller.userId, code)
    if (!attempt) throw refuse(409, 'no_attempt', 'This wheel was not issued to this account: start a chase run from the World leaderboard')
    if (!attemptOpen(attempt, now)) throw refuse(409, 'closed', 'That chase run has closed')
    const { reg, allowed } = await dataFor(attempt.dataVersion, attempt.createdAt, c.data)
    const u = await universe(reg, [attempt.leagueId])
    const verdict = verifyChase(u, attempt, { encoded: req.encoded, teamName: req.teamName, shortName: req.shortName }, now, () => allowed)
    if (!verdict.ok) throw refuse(verdict.status, verdict.code, verdict.reason, verdict.context)
    const result = await deps.db.chaseSubmit(caller.userId, code, verdict.entry)
    if (result.status === 'closed') throw refuse(409, 'closed', 'That chase run has closed')
    if (result.status === 'no_attempt') throw refuse(409, 'no_attempt', 'This wheel was not issued to this account')
    return { status: 200, body: { ...result, key: code, official: { points: verdict.entry.points, won: verdict.entry.won, drawn: verdict.entry.drawn, lost: verdict.entry.lost, goalsFor: verdict.entry.goals_for, goalsAgainst: verdict.entry.goals_against, leaguePosition: verdict.entry.league_position, tier: verdict.entry.tier, claimMatched: verdict.entry.claim_matched } } }
  }

  async function submit(kind: BoardKind, caller: Caller, req: { encoded: string; teamName: string; shortName: string }, now: Date): Promise<Reply> {
    let c: ChallengePayload
    try {
      c = decodeChallenge(req.encoded.trim().replace(/^#?c=/, ''))
    } catch (e) {
      throw refuse(422, 'invalid_payload', e instanceof Error ? e.message : String(e))
    }
    const key = keyOfPayload(kind, c)
    if (!boardIsOpen(kind, key, now)) throw refuse(409, 'closed', kind === 'daily' ? 'That Daily has closed' : 'That week has closed')
    const pin = await pinFor(kind, key, now)
    const { reg, allowed } = await dataFor(pin.dataVersion, pin.createdAt, c.data)
    const u = await universe(reg, puzzleLeagues(pin.settings))
    const verdict = verifyRanked(u, pin, { encoded: req.encoded, teamName: req.teamName, shortName: req.shortName }, now, () => allowed)
    if (!verdict.ok) throw refuse(verdict.status, verdict.code, verdict.reason, verdict.context)
    const result = await deps.db.submit(kind, caller.userId, pinDateOf(kind, key), verdict.entry)
    if (result.status === 'closed') throw refuse(409, 'closed', kind === 'daily' ? 'That Daily has closed' : 'That week has closed')
    if (result.status === 'no_puzzle') throw refuse(409, 'no_puzzle', 'There is no ranked puzzle for that day')
    return { status: 200, body: { ...result, key, official: { points: verdict.entry.points, won: verdict.entry.won, drawn: verdict.entry.drawn, lost: verdict.entry.lost, goalsFor: verdict.entry.goals_for, goalsAgainst: verdict.entry.goals_against, leaguePosition: verdict.entry.league_position, tier: verdict.entry.tier, claimMatched: verdict.entry.claim_matched } } }
  }

  async function deleteAccount(caller: Caller): Promise<Reply> {
    // Supabase refuses to delete a user who still owns Storage objects, so the saves go first
    const paths = await deps.storage.listSaves(caller.userId)
    if (paths.some((p) => !p.startsWith(`${caller.userId}/`))) throw refuse(503, 'unavailable', 'The save listing strayed outside the caller folder')
    if (paths.length) await deps.storage.removeSaves(paths)
    try {
      await deps.auth.signOutEverywhere(caller.jwt)
    } catch (e) {
      deps.log({ level: 'warn', event: 'sign_out_failed', user: logId(caller.userId), reason: e instanceof Error ? e.message : String(e) })
    }
    await deps.auth.deleteUser(caller.userId)
    return { status: 200, body: { status: 'deleted', objects: paths.length } }
  }


  // ------------------------------------------------------------------ rooms

  const subjectOf = (who: Requester) => (isGuest(who) ? who.subject : who.userId)
  const userOf = (who: Requester) => (isGuest(who) ? null : who.userId)
  const hashToken = (token: string) => deps.sha256Hex(new TextEncoder().encode(token))

  /** The universe a room plays on: its registered data version, the leagues its settings name. */
  async function roomUniverse(dataVersion: string, s: RoomSettings): Promise<LoadedUniverse> {
    const reg = (await deps.db.dataPack(dataVersion)) ?? (await ensurePacks(dataVersion))
    if (!reg) throw refuse(409, 'data_mismatch', `Data ${dataVersion} is no longer served: reload the game`, { roomData: dataVersion })
    const leagues = [...new Set([s.leagueId, ...s.wheelLeagues])]
    if (leagues.some((id) => !reg.leagues.includes(id))) throw refuse(422, 'invalid_room', `Data ${dataVersion} does not have every league the room names`)
    return universe(reg, leagues)
  }

  async function storedRoom(code: string): Promise<StoredRoom> {
    const stored = await deps.db.roomGet(code)
    if (!stored) throw refuse(404, 'no_room', 'No room has that code (rooms are deleted a day after they end)')
    return stored
  }

  function closedRefusal(room: RoomView): Refusal {
    return refuse(409, 'room_closed', room.status === 'finished' ? 'That room has finished' : 'That room has closed', { roomStatus: room.status })
  }

  /** A writer's answer as a reply, or the refusal it stands for. */
  function written(w: RoomWrite, extra: Record<string, unknown> = {}): Reply {
    if (w.status === 'ok' && w.room) return { status: 200, body: { status: 'ok', ...extra, room: w.room } }
    if (w.status === 'busy') throw refuse(503, 'rooms_busy', 'Too many rooms are open just now: try again in a few minutes')
    if (w.status === 'missing') throw refuse(404, 'no_room', 'No room has that code')
    if (w.status === 'full') throw refuse(409, 'room_full', 'Two managers are already in that room')
    if (w.status === 'closed') throw w.room ? closedRefusal(w.room) : refuse(409, 'room_closed', 'That room has closed')
    if (w.status === 'conflict') throw refuse(409, 'stale', 'The room moved on: it reloads with the latest picks')
    if (w.status === 'not_seated') throw refuse(403, 'not_seated', 'This device does not hold a seat in that room')
    if (w.status === 'not_your_turn') throw refuse(409, 'not_your_turn', 'It is the other manager\'s pick')
    throw refuse(503, 'unavailable', 'The room could not be saved; it is safe to retry')
  }

  async function roomCreate(who: Requester, req: Extract<ServerRequest, { op: 'room.create' }>): Promise<Reply> {
    if (req.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `This server runs engine ${ENGINE_VERSION}: reload the game to play online`, { liveEngine: ENGINE_VERSION })
    let live = await liveBuild()
    if (live && live.data !== req.data) live = await liveBuild(true)
    if (!live) throw refuse(503, 'live_build_unavailable', 'The live site does not say which engine and data it serves')
    if (live.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `The live site runs engine ${live.engine}; this function runs ${ENGINE_VERSION}`, { liveEngine: live.engine })
    // Both managers play on the data the live site serves, so the joiner's device holds the same packs
    if (live.data !== req.data) throw refuse(409, 'data_mismatch', 'A newer version of the player data is live: reload the game to play online', { liveData: live.data })
    const reg = await ensurePacks(live.data)
    if (!reg) throw refuse(503, 'packs_unavailable', `Data ${live.data} could not be archived`)
    const u = await roomUniverse(live.data, req.settings)
    const problem = settingsProblem(u, req.settings)
    if (problem) throw refuse(422, 'invalid_room', problem)
    const settings = cleanSettings(req.settings)
    const m = roomManager(u, settings, req.manager, null)
    if (!m.ok) throw refuse(422, 'invalid_manager', m.reason)
    const token = deps.randomToken()
    const w = await deps.db.roomCreate(settings, m.manager, await hashToken(token), userOf(who), ENGINE_VERSION, live.data)
    return written(w, { seat: 0, token })
  }

  async function roomJoin(who: Requester, req: Extract<ServerRequest, { op: 'room.join' }>): Promise<Reply> {
    const stored = await storedRoom(req.code)
    const room = stored.room
    if (room.status === 'drafting' || room.status === 'finished') throw refuse(409, 'room_full', 'Two managers are already in that room')
    if (room.status !== 'waiting') throw closedRefusal(room)
    if (room.engineVersion !== ENGINE_VERSION || req.engine !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `That room plays on engine ${room.engineVersion}: reload the game`, { roomEngine: room.engineVersion })
    if (req.data !== room.dataVersion) throw refuse(409, 'data_mismatch', 'That room plays on another version of the player data: reload the game', { roomData: room.dataVersion })
    const host = room.managers[0]
    const u = await roomUniverse(room.dataVersion, room.settings)
    const m = roomManager(u, room.settings, req.manager, host)
    if (!m.ok) throw refuse(422, 'invalid_manager', m.reason)
    const managers: [H2HManager, H2HManager] = [host, m.manager]
    const step = roomStart(u, stored.seed, room.settings, managers)
    if (step.turn === null) throw refuse(503, 'unavailable', 'The draft could not start')
    const token = deps.randomToken()
    const w = await deps.db.roomJoin(req.code, m.manager, await hashToken(token), userOf(who), step.events, step.turn, room.version)
    return written(w, { seat: 1, token })
  }

  async function roomMove(req: Extract<ServerRequest, { op: 'room.pick' }>): Promise<Reply> {
    const stored = await storedRoom(req.code)
    const room = stored.room
    const hash = await hashToken(req.token)
    const seat: 0 | 1 | null = hash === stored.seat0Hash ? 0 : hash === stored.seat1Hash ? 1 : null
    if (seat === null) throw refuse(403, 'not_seated', 'This device does not hold a seat in that room')
    if (room.status !== 'drafting') throw closedRefusal(room)
    // A room opened on another engine replays its draft and season differently: only that engine's function may move it
    if (room.engineVersion !== ENGINE_VERSION) throw refuse(409, 'engine_mismatch', `That room plays on engine ${room.engineVersion}`, { roomEngine: room.engineVersion })
    if (req.version !== room.version) throw refuse(409, 'stale', 'The room moved on: it reloads with the latest picks')
    if (room.turn !== seat) throw refuse(409, 'not_your_turn', 'It is the other manager\'s pick')
    const managers = room.managers
    if (!managers[1] || !isRoomLog(room.events)) throw refuse(503, 'unavailable', 'The room record is incomplete')
    const u = await roomUniverse(room.dataVersion, room.settings)
    let step
    try {
      step = roomPick(u, stored.seed, room.settings, [managers[0], managers[1]], room.events, seat, req.playerSeasonId, req.slotId)
    } catch (e) {
      if (e instanceof RoomMoveError) throw refuse(422, 'invalid_pick', e.message)
      // The stored log does not replay: the room's own record is wrong, never the player's pick
      deps.log({ level: 'error', event: 'room_replay_failed', room: req.code.slice(0, 4), reason: e instanceof Error ? e.message : String(e) })
      throw refuse(503, 'unavailable', 'The room could not be replayed')
    }
    return written(await deps.db.roomMove(req.code, seat, hash, room.version, step.events, step.turn, step.result))
  }

  async function roomLeave(req: Extract<ServerRequest, { op: 'room.leave' }>): Promise<Reply> {
    return written(await deps.db.roomLeave(req.code, await hashToken(req.token)))
  }

  async function roomResume(who: Requester, req: Extract<ServerRequest, { op: 'room.resume' }>): Promise<Reply> {
    if (isGuest(who)) throw refuse(401, 'unauthorised', 'Sign in to take your seat back on this device')
    const token = deps.randomToken()
    const w = await deps.db.roomReseat(req.code, who.userId, await hashToken(token))
    return written(w, { seat: w.seat, token })
  }

  async function route(caller: Requester, req: ServerRequest, now: Date): Promise<Reply> {
    if (req.op === 'status') {
      return { status: 200, body: { status: 'ok', engine: ENGINE_VERSION, live: await liveBuild(), today: dayKey(now), week: weekKeyOf(now) } }
    }
    if ((ROOM_OPS as readonly string[]).includes(req.op)) {
      const limit = LIMITS[req.op]
      if (!(await deps.db.rateLimit(req.op, subjectOf(caller), limit, 3600))) throw refuse(429, 'rate_limited', `At most ${limit} ${req.op} calls an hour`)
      switch (req.op) {
        case 'room.create':
          return roomCreate(caller, req)
        case 'room.join':
          return roomJoin(caller, req)
        case 'room.pick':
          return roomMove(req)
        case 'room.leave':
          return roomLeave(req)
        case 'room.resume':
          return roomResume(caller, req)
      }
    }
    if (isGuest(caller)) throw refuse(401, 'unauthorised', 'Sign in first')
    if (caller.isAnonymous && req.op !== 'account.delete') throw refuse(403, 'guest', 'Guest sessions cannot post to the boards; sign in with an account')
    const limit = LIMITS[req.op]
    if (!(await deps.db.rateLimit(req.op, caller.userId, limit, 3600))) throw refuse(429, 'rate_limited', `At most ${limit} ${req.op} calls an hour`)
    switch (req.op) {
      case 'daily.pin':
      case 'weekly.pin': {
        const kind: BoardKind = req.op === 'daily.pin' ? 'daily' : 'weekly'
        const key = req.op === 'daily.pin' ? (req.date ?? dayKey(now)) : (req.week ?? weekKeyOf(now))
        const pin = await pinFor(kind, key, now)
        return { status: 200, body: { status: 'ok', pin } }
      }
      case 'daily.submit':
        return submit('daily', caller, req, now)
      case 'weekly.submit':
        return submit('weekly', caller, req, now)
      case 'chase.start':
        return startChase(caller, req)
      case 'chase.submit':
        return submitChase(caller, req, now)
      case 'casual.submit':
        return submitCasual(caller, req, now)
      case 'account.delete':
        return deleteAccount(caller)
      default:
        throw refuse(400, 'bad_request', 'Unknown operation')
    }
  }

  // A guest's log line names no subject at all (it is a hash of an address)
  const who = (r: Requester) => (isGuest(r) ? 'guest' : logId(r.userId))

  return {
    async handle(caller, text) {
      const now = deps.now()
      const started = now.getTime()
      let op = 'unknown'
      let reply: Reply
      try {
        const parsed = parseRequest(text)
        if (!parsed.ok) throw refuse(400, 'bad_request', parsed.reason)
        op = parsed.value.op
        reply = await route(caller, parsed.value, now)
      } catch (e) {
        if (e instanceof Refusal) reply = { status: e.status, body: { status: e.status, code: e.code, reason: e.message, ...e.context } }
        else {
          deps.log({ level: 'error', event: 'unexpected', op, user: who(caller), reason: e instanceof Error ? e.message : String(e) })
          reply = { status: 503, body: { status: 503, code: 'unavailable', reason: 'The server could not finish this request; it is safe to retry' } }
        }
      }
      deps.log({ op, status: reply.status, outcome: String(reply.body.code ?? reply.body.status), ms: deps.now().getTime() - started, user: who(caller) })
      return reply
    },
  }
}
