/**
 * The Edge Function's request handler for Phase 1, written against small interfaces (`ServerDeps`) so the whole flow
 * runs in Vitest on real packs with fakes, and on Deno with the Supabase clients (`supabase/functions/touchline`).
 *
 * Ops (section 4 of the online plan): `daily.pin` / `weekly.pin` pin the day's or week's puzzle from the data the
 * live site serves; `daily.submit` / `weekly.submit` replay a posted run with the verifier and file the replay's
 * figures; `account.delete` removes a player's saves and then the account; `status` reports the engine and the live
 * build. Challenge codes need no op: `create_challenge` / `get_challenge` are database functions.
 *
 * The user id comes only from the verified JWT (`Caller`), never from the body. Logs carry the op, the outcome, the
 * duration and an 8-character user-id prefix; never a body or a token.
 */
import { decodeChallenge, type ChallengePayload } from '@engine/challenge'
import { dailyDateOf } from '@engine/rng'
import type { LoadedUniverse, MetaFile, PlayersFile } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import { dailyGameSettings } from '@game/logic/setup'
import type { BuildInfo } from '../buildInfo'
import { weekKeyOf, weekKeyOfSeed, weekStartOf, weeklyGameSettings, weeklyIsOpen } from '../weekly'
import { puzzleOf, settingsHash, verifyRanked, type PuzzlePin, type PuzzleSettings, type RankedEntry } from './dailyVerify'
import { archivePath, packFiles, puzzleLeagues, universeFromPacks, type LeaguePack } from './packs'
import { logId, parseBuildInfo, parseLeaguesIndex, parseRequest, type ServerRequest } from './validate'

export type BoardKind = PuzzlePin['kind']

/** A pin as the database stores it. */
export interface StoredPin extends PuzzlePin {
  createdAt: string
}

/** A registered data version (`private.data_packs`). `files` maps each pack file to its SHA-256. */
export interface DataPackRow {
  version: string
  leagues: string[]
  files: Record<string, string>
  firstSeenAt: string
}

/** The database, through the `svc_*` functions (service role) and the public puzzle tables. */
export interface ServerDb {
  rateLimit(bucket: string, userId: string, limit: number, windowSeconds: number): Promise<boolean>
  /** `date` is the puzzle date (Daily) or the Monday of the week (weekly), `YYYY-MM-DD`. */
  getPin(kind: BoardKind, date: string): Promise<StoredPin | null>
  pin(kind: BoardKind, date: string, settings: PuzzleSettings, hash: string, engine: string, data: string): Promise<StoredPin>
  submit(kind: BoardKind, userId: string, date: string, entry: RankedEntry): Promise<{ status: string } & Record<string, unknown>>
  dataPack(version: string): Promise<DataPackRow | null>
  registerDataPack(version: string, leagues: string[], files: Record<string, string>): Promise<{ status: 'ok' | 'mismatch'; pack: DataPackRow }>
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
  now(): Date
  log(line: Record<string, unknown>): void
}

/** The verified caller: from the JWT, never from the body. */
export interface Caller {
  userId: string
  isAnonymous: boolean
  jwt: string
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
  | 'invalid_payload'
  | 'invalid_team'
  | 'invalid_picks'
  | 'live_build_unavailable'
  | 'packs_unavailable'
  | 'unavailable'

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
  'account.delete': 5,
} as const

/** How long the live site's `build.json` is trusted per isolate. */
export const LIVE_BUILD_TTL_MS = 5 * 60 * 1000

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
  handle(caller: Caller, text: string): Promise<Reply>
}

export function createServer(deps: ServerDeps): Server {
  let liveCache: { at: number; value: BuildInfo } | null = null
  const pinCache = new Map<string, StoredPin>()
  const ensuring = new Map<string, Promise<DataPackRow | null>>()
  const universes = new Map<string, Promise<LoadedUniverse>>()

  async function liveBuild(): Promise<BuildInfo | null> {
    const at = deps.now().getTime()
    if (liveCache && at - liveCache.at < LIVE_BUILD_TTL_MS) return liveCache.value
    const bytes = await deps.fetchSite('build.json')
    let value: BuildInfo | null = null
    try {
      value = bytes ? parseBuildInfo(parseJson(bytes)) : null
    } catch {
      value = null
    }
    // A failure is not cached: the next request asks again
    if (value) liveCache = { at, value }
    return value
  }

  /** Make sure `version` is archived and registered; null when it is neither registered nor served live now. */
  function ensurePacks(version: string): Promise<DataPackRow | null> {
    const running = ensuring.get(version)
    if (running) return running
    const job = (async () => {
      const known = await deps.db.dataPack(version)
      if (known) return known
      const live = await liveBuild()
      if (!live || live.data !== version) return null
      const indexBytes = await deps.fetchSite('data/leagues.json')
      if (!indexBytes) throw refuse(503, 'packs_unavailable', 'The live site did not serve leagues.json')
      const index = parseLeaguesIndex(parseJson(indexBytes), version)
      if (!index.ok) throw refuse(503, 'packs_unavailable', index.reason)
      const leagues = index.value.leagues.map((l) => l.id)
      const bytesOf: Record<string, Uint8Array> = { 'leagues.json': indexBytes }
      for (const file of packFiles(leagues).slice(1)) {
        const b = await deps.fetchSite(`data/${file}`)
        if (!b) throw refuse(503, 'packs_unavailable', `The live site did not serve ${file}`)
        if (file.endsWith('/players.json')) {
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
    for (const id of leagues) packs[id] = { players: (await read(`${id}/players.json`)) as PlayersFile, meta: (await read(`${id}/meta.json`)) as MetaFile }
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
    const pinned = await deps.db.dataPack(pin.dataVersion)
    if (!pinned) throw refuse(503, 'packs_unavailable', `The pinned data ${pin.dataVersion} is not registered`)
    // Data other than the pin's ranks only when the live site served it after the pin was made (a mid-day rebuild)
    let allowed = false
    let reg = pinned
    if (c.data !== pin.dataVersion && /^[0-9A-Za-z._:-]{1,40}$/.test(c.data)) {
      const other = await ensurePacks(c.data)
      if (other && Date.parse(other.firstSeenAt) > Date.parse(pin.createdAt)) {
        allowed = true
        reg = other
      }
    }
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

  async function route(caller: Caller, req: ServerRequest, now: Date): Promise<Reply> {
    if (req.op === 'status') {
      return { status: 200, body: { status: 'ok', engine: ENGINE_VERSION, live: await liveBuild(), today: dayKey(now), week: weekKeyOf(now) } }
    }
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
      case 'account.delete':
        return deleteAccount(caller)
    }
  }

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
          deps.log({ level: 'error', event: 'unexpected', op, user: logId(caller.userId), reason: e instanceof Error ? e.message : String(e) })
          reply = { status: 503, body: { status: 503, code: 'unavailable', reason: 'The server could not finish this request; it is safe to retry' } }
        }
      }
      deps.log({ op, status: reply.status, outcome: String(reply.body.code ?? reply.body.status), ms: deps.now().getTime() - started, user: logId(caller.userId) })
      return reply
    },
  }
}
