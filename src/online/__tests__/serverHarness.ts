/**
 * In-memory stand-ins for what the Edge Function talks to (the database's svc_* functions, the two Storage buckets,
 * Auth admin and the live site), with the same contracts as the SQL: a pin is written once and returned unchanged
 * after, the first entry per account and board stands, a data version registers once. The live site serves
 * `public/data` from disk, optionally restamped to simulate a rebuild. Used by service.test.ts.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { autoDraft } from '@engine/draft'
import { encodeChallenge } from '@engine/challenge'
import { Rng } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import type { Game, GameSettings } from '@game/types'
import { createGame } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { challengeFromGame } from '@game/logic/challenge'
import type { BuildInfo } from '../buildInfo'
import type { PuzzleSettings, RankedEntry } from '../server/dailyVerify'
import type { H2HManager, H2HResult } from '@game/logic/h2h'
import type { RoomEvent, RoomSettings, RoomStatus, RoomView } from '@game/logic/h2hRoom'
import { createServer, type BoardKind, type Caller, type DataPackRow, type Guest, type RoomWrite, type ServerDeps, type StoredPin } from '../server/service'
import type { ChaseAttempt } from '../server/chaseVerify'
import { CHASE_ATTEMPTS_PER_DAY, CHASE_ATTEMPT_HOURS } from '../chase'

export const DATA = path.resolve(__dirname, '..', '..', '..', 'public', 'data')
const enc = new TextEncoder()

export interface Harness {
  deps: ServerDeps
  clock: { now: Date }
  site: { build: BuildInfo | null; stamp: string | null; served: string[] }
  pins: Map<string, StoredPin>
  packs: Map<string, DataPackRow>
  entries: Map<string, { entry: RankedEntry; id: number }>
  /** 38-0 chase attempts by code, with the account they were issued to; chase entries by code. */
  attempts: Map<string, ChaseAttempt & { userId: string }>
  chaseEntries: Map<string, { entry: RankedEntry; userId: string; id: number }>
  archive: Map<string, Uint8Array>
  saves: Map<string, Uint8Array>
  deleted: string[]
  signedOut: string[]
  limits: Map<string, number>
  logs: Array<Record<string, unknown>>
  rooms: Map<string, FakeRoom>
  server: ReturnType<typeof createServer>
}

/** A pack file of `public/data`, restamped to `stamp` when given (the bytes of a same-content rebuild). */
export function siteFile(file: string, stamp: string | null): Uint8Array | null {
  let text: string
  try {
    text = readFileSync(path.join(DATA, file), 'utf8')
  } catch {
    return null
  }
  if (stamp && (file === 'leagues.json' || file.endsWith('/players.json') || file.endsWith('/players-classic.json'))) text = text.replace(/"generatedAt":"[^"]*"/, `"generatedAt":"${stamp}"`)
  return enc.encode(text)
}

/** A row of `private.h2h_rooms` as the fake keeps it (the SQL's columns). */
export interface FakeRoom {
  code: string
  seed: string
  settings: RoomSettings
  managers: [H2HManager, H2HManager | null]
  seat0Hash: string
  seat1Hash: string | null
  seat0User: string | null
  seat1User: string | null
  events: RoomEvent[]
  turn: 0 | 1 | null
  result: H2HResult | null
  status: RoomStatus
  version: number
  engine: string
  data: string
  createdAt: number
  expiresAt: number
  lastMoveAt: number | null
  endedAt: number | null
}

const MIN = 60000
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const codeOfN = (n: number, len: number) => Array.from({ length: len }, (_, i) => ALPHA[Math.floor(n / 32 ** i) % 32]).join('')

/** The SQL's `private.h2h_room_status`: deadlines applied on read. */
function roomStatusAt(r: FakeRoom, now: number): RoomStatus {
  if (r.status === 'waiting' && now >= r.expiresAt) return 'expired'
  if (r.status === 'drafting' && r.lastMoveAt !== null && now >= r.lastMoveAt + 15 * MIN) return 'timed_out'
  return r.status
}

/** The SQL's `private.h2h_room_json`. */
export function fakeRoomView(r: FakeRoom, now: number): RoomView {
  const status = roomStatusAt(r, now)
  const ended = status === 'expired' ? (r.endedAt ?? r.expiresAt) : status === 'timed_out' ? (r.endedAt ?? (r.lastMoveAt ?? 0) + 15 * MIN) : r.endedAt
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString())
  return structuredClone({
    code: r.code, status, settings: r.settings, managers: r.managers, events: r.events, version: r.version, turn: status === 'drafting' ? r.turn : null, result: r.result,
    seed: r.status === 'finished' ? r.seed : null, engineVersion: r.engine, dataVersion: r.data, createdAt: iso(r.createdAt)!, expiresAt: iso(r.expiresAt)!,
    idleAt: r.status === 'drafting' && r.lastMoveAt !== null ? iso(r.lastMoveAt + 15 * MIN) : null, endedAt: iso(ended),
  })
}

export function makeHarness(start = new Date('2026-10-25T12:00:00Z'), build: BuildInfo | null = null): Harness {
  const h = {
    clock: { now: start },
    site: { build, stamp: null as string | null, served: [] as string[] },
    pins: new Map<string, StoredPin>(),
    packs: new Map<string, DataPackRow>(),
    entries: new Map<string, { entry: RankedEntry; id: number }>(),
    attempts: new Map<string, ChaseAttempt & { userId: string }>(),
    chaseEntries: new Map<string, { entry: RankedEntry; userId: string; id: number }>(),
    archive: new Map<string, Uint8Array>(),
    saves: new Map<string, Uint8Array>(),
    deleted: [] as string[],
    signedOut: [] as string[],
    limits: new Map<string, number>(),
    logs: [] as Array<Record<string, unknown>>,
    rooms: new Map<string, FakeRoom>(),
  } as Harness
  let nextId = 1
  let nextRoom = 1
  let nextToken = 1
  const now = () => h.clock.now.getTime()
  /** File a passed deadline (the SQL's `private.h2h_room_settle`). */
  const settle = (r: FakeRoom) => {
    const s = roomStatusAt(r, now())
    if (s !== r.status) {
      r.endedAt = s === 'expired' ? r.expiresAt : (r.lastMoveAt ?? 0) + 15 * MIN
      r.status = s
      r.turn = null
      r.version++
    }
  }
  const out = (r: FakeRoom, status: RoomWrite['status'] = 'ok', extra: Partial<RoomWrite> = {}): RoomWrite => ({ status, room: fakeRoomView(r, now()), ...extra })
  let nextCode = 0
  // Deterministic stand-ins for private.random_code(10): AAAAAAAAAB, AAAAAAAAAC, ...
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const codeOf = (n: number) => Array.from({ length: 10 }, (_, i) => ALPHABET[Math.floor(n / 32 ** (9 - i)) % 32]).join('')
  const dayOf = (iso: string) => iso.slice(0, 10)
  const deps: ServerDeps = {
    randomToken: () => `tok${String(nextToken++).padStart(40, '0')}`,
    now: () => h.clock.now,
    log: (line) => h.logs.push(line),
    sha256Hex: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
    fetchSite: async (p) => {
      h.site.served.push(p)
      if (p === 'build.json') return h.site.build ? enc.encode(JSON.stringify(h.site.build)) : null
      if (!p.startsWith('data/')) return null
      return siteFile(p.slice(5), h.site.stamp)
    },
    storage: {
      getPack: async (p) => h.archive.get(p) ?? null,
      putPack: async (p, bytes) => {
        if (!h.archive.has(p)) h.archive.set(p, bytes)
      },
      listSaves: async (uid) => [...h.saves.keys()].filter((k) => k.startsWith(`${uid}/`)),
      removeSaves: async (paths) => {
        for (const p of paths) h.saves.delete(p)
      },
    },
    auth: {
      signOutEverywhere: async (jwt) => {
        h.signedOut.push(jwt)
      },
      deleteUser: async (uid) => {
        h.deleted.push(uid)
      },
    },
    db: {
      rateLimit: async (bucket, uid, limit) => {
        const k = `${bucket}|${uid}`
        const n = (h.limits.get(k) ?? 0) + 1
        h.limits.set(k, n)
        return n <= limit
      },
      getPin: async (kind, date) => h.pins.get(`${kind}|${date}`) ?? null,
      pin: async (kind: BoardKind, date: string, settings: PuzzleSettings, hash: string, engine: string, data: string) => {
        const k = `${kind}|${date}`
        if (!h.pins.has(k)) {
          const key = kind === 'daily' ? date : settings.seed.slice('weekly-'.length)
          h.pins.set(k, { kind, key, seed: settings.seed, settings: JSON.parse(JSON.stringify(settings)) as PuzzleSettings, settingsHash: hash, engineVersion: engine, dataVersion: data, createdAt: h.clock.now.toISOString() })
        }
        return h.pins.get(k)!
      },
      submit: async (kind, uid, date, entry) => {
        const k = `${kind}|${date}|${uid}`
        const prior = h.entries.get(k)
        let status = 'ranked'
        if (prior) status = prior.entry.draft_fingerprint === entry.draft_fingerprint ? 'duplicate' : 'already_submitted'
        else h.entries.set(k, { entry, id: nextId++ })
        const board = [...h.entries.entries()].filter(([key]) => key.startsWith(`${kind}|${date}|`))
        const mine = h.entries.get(k)!
        const position = 1 + board.filter(([, e]) => e.entry.points > mine.entry.points).length
        return { status, entryId: mine.id, position, total: board.length, entry: { points: mine.entry.points } }
      },
      chaseStart: async (uid, leagueId, formationId, options, engine, data) => {
        const today = h.clock.now.toISOString().slice(0, 10)
        const used = [...h.attempts.values()].filter((a) => a.userId === uid && dayOf(a.createdAt) === today).length
        if (used >= CHASE_ATTEMPTS_PER_DAY) return { status: 'limit', cap: CHASE_ATTEMPTS_PER_DAY, left: 0, resetsAt: `${today}T24:00:00Z` }
        const code = codeOf(++nextCode)
        const attempt: ChaseAttempt = { code, seed: `chase-${code}`, leagueId, formationId, ratings: options.ratings, benchPicks: options.benchPicks, engineVersion: engine, dataVersion: data, createdAt: h.clock.now.toISOString(), expiresAt: new Date(h.clock.now.getTime() + CHASE_ATTEMPT_HOURS * 3600000).toISOString(), submittedAt: null }
        h.attempts.set(code, { ...attempt, userId: uid })
        return { status: 'ok', cap: CHASE_ATTEMPTS_PER_DAY, left: CHASE_ATTEMPTS_PER_DAY - used - 1, attempt }
      },
      chaseAttempt: async (uid, code) => {
        const a = h.attempts.get(code)
        if (!a || a.userId !== uid) return null
        const { userId: _owner, ...attempt } = a
        void _owner
        return attempt
      },
      chaseSubmit: async (uid, code, entry) => {
        const a = h.attempts.get(code)
        if (!a || a.userId !== uid) return { status: 'no_attempt' }
        const prior = h.chaseEntries.get(code)
        let status = 'ranked'
        if (prior) status = prior.entry.draft_fingerprint === entry.draft_fingerprint ? 'duplicate' : 'already_submitted'
        else if (h.clock.now.getTime() >= Date.parse(a.expiresAt)) return { status: 'closed' }
        else {
          h.chaseEntries.set(code, { entry, userId: uid, id: nextId++ })
          a.submittedAt = h.clock.now.toISOString()
        }
        const mine = h.chaseEntries.get(code)!
        const dropped = (e: RankedEntry) => 3 * (e.won + e.drawn + e.lost) - e.points
        // Each account's best run: the board the SQL ranks
        const best = new Map<string, RankedEntry>()
        for (const x of h.chaseEntries.values()) if (!best.has(x.userId) || dropped(x.entry) < dropped(best.get(x.userId)!)) best.set(x.userId, x.entry)
        const myBest = best.get(uid)!
        const position = 1 + [...best.entries()].filter(([u, e]) => u !== uid && dropped(e) < dropped(myBest)).length
        const games = mine.entry.won + mine.entry.drawn + mine.entry.lost
        return { status, entryId: mine.id, position, total: best.size, weekPosition: position, weekTotal: best.size, perfect: mine.entry.drawn === 0 && mine.entry.lost === 0, games, entry: { points: mine.entry.points, games } }
      },
      dataPack: async (version) => h.packs.get(version) ?? null,
      registerDataPack: async (version, leagues, files) => {
        if (!h.packs.has(version)) h.packs.set(version, { version, leagues, files, firstSeenAt: h.clock.now.toISOString() })
        const pack = h.packs.get(version)!
        return { status: JSON.stringify(pack.files) === JSON.stringify(files) ? 'ok' : 'mismatch', pack }
      },
      roomCreate: async (settings, manager, seatHash, userId, engine, data) => {
        const open = [...h.rooms.values()].filter((r) => ['waiting', 'drafting'].includes(roomStatusAt(r, now()))).length
        if (open >= 300) return { status: 'busy' }
        const n = nextRoom++
        const r: FakeRoom = { code: `K7${codeOfN(n, 6)}`, seed: `room-${codeOfN(n * 7919, 12)}`, settings: structuredClone(settings), managers: [structuredClone(manager), null], seat0Hash: seatHash, seat1Hash: null, seat0User: userId, seat1User: null, events: [], turn: null, result: null, status: 'waiting', version: 0, engine, data, createdAt: now(), expiresAt: now() + 30 * MIN, lastMoveAt: null, endedAt: null }
        h.rooms.set(r.code, r)
        return out(r)
      },
      roomGet: async (code) => {
        const r = h.rooms.get(code)
        return r ? { room: fakeRoomView(r, now()), seed: r.seed, seat0Hash: r.seat0Hash, seat1Hash: r.seat1Hash, seat0User: r.seat0User, seat1User: r.seat1User } : null
      },
      roomJoin: async (code, manager, seatHash, userId, events, turn, expectVersion) => {
        const r = h.rooms.get(code)
        if (!r) return { status: 'missing' }
        settle(r)
        if (r.status !== 'waiting') return out(r, r.status === 'drafting' || r.status === 'finished' ? 'full' : 'closed')
        if (r.version !== expectVersion) return out(r, 'conflict')
        if (seatHash === r.seat0Hash || !events.length) return { status: 'bad' }
        Object.assign(r, { managers: [r.managers[0], structuredClone(manager)], seat1Hash: seatHash, seat1User: userId, events: structuredClone(events), turn, status: 'drafting', lastMoveAt: now(), version: r.version + 1 })
        return out(r)
      },
      roomMove: async (code, seat, seatHash, expectVersion, events, turn, result) => {
        const r = h.rooms.get(code)
        if (!r) return { status: 'missing' }
        if (seatHash !== (seat === 0 ? r.seat0Hash : r.seat1Hash)) return { status: 'not_seated' }
        settle(r)
        if (r.status !== 'drafting') return out(r, 'closed')
        if (r.turn !== seat) return out(r, 'not_your_turn')
        if (r.version !== expectVersion) return out(r, 'conflict')
        const first = events[0]
        if (!first || first.t !== 'p' || first.seat !== seat || (result === null && turn === null)) return { status: 'bad' }
        r.events = [...r.events, ...structuredClone(events)]
        r.turn = result ? null : turn
        r.result = result ? structuredClone(result) : null
        r.status = result ? 'finished' : 'drafting'
        r.endedAt = result ? now() : null
        r.lastMoveAt = now()
        r.version++
        return out(r)
      },
      roomLeave: async (code, seatHash) => {
        const r = h.rooms.get(code)
        if (!r) return { status: 'missing' }
        if (seatHash !== r.seat0Hash && seatHash !== r.seat1Hash) return { status: 'not_seated' }
        settle(r)
        if (r.status !== 'waiting' && r.status !== 'drafting') return out(r, 'closed')
        Object.assign(r, { status: 'left', turn: null, endedAt: now(), version: r.version + 1 })
        return out(r)
      },
      roomReseat: async (code, userId, seatHash) => {
        const r = h.rooms.get(code)
        if (!r) return { status: 'missing' }
        const seat = r.seat0User === userId ? 0 : r.seat1User === userId ? 1 : null
        if (seat === null) return { status: 'not_seated' }
        settle(r)
        if (r.status !== 'waiting' && r.status !== 'drafting') return out(r, 'closed')
        if (seat === 0) r.seat0Hash = seatHash
        else r.seat1Hash = seatHash
        return out(r, 'ok', { seat })
      },
    },
  }
  h.deps = deps
  h.server = createServer(deps)
  return h
}

export const ALICE: Caller = { userId: '11111111-1111-4111-8111-111111111111', isAnonymous: false, jwt: 'jwt-alice' }
export const BOB: Caller = { userId: '22222222-2222-4222-8222-222222222222', isAnonymous: false, jwt: 'jwt-bob' }
export const GUEST: Caller = { userId: '44444444-4444-4444-8444-444444444444', isAnonymous: true, jwt: 'jwt-guest' }
/** A guest with no account at all (the publishable key, no JWT), as the Edge Function hands it over. */
export const VISITOR: Guest = { guest: true, subject: '55555555-5555-4555-8555-555555555555' }
export const VISITOR2: Guest = { guest: true, subject: '66666666-6666-4666-8666-666666666666' }

/** A game played the way the store's Auto-complete plays it, after `before` (spins, re-spins, picks) if given. */
export function autoPlayed(u: LoadedUniverse, settings: GameSettings, before?: (g: Game, rng: Rng) => void): Game {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  before?.(g, rng)
  const d = g.draft!
  if (d.current) d.history.push({ ...d.current, pickedId: null, slotId: null, skipped: true, ...(d.twist ? { twist: d.twist } : {}) })
  d.current = null
  d.twist = null
  autoDraft(u, d, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

export const submitBody = (op: 'daily.submit' | 'weekly.submit' | 'chase.submit', g: Game, u: LoadedUniverse, encoded?: string) =>
  JSON.stringify({ op, encoded: encoded ?? encodeChallenge(challengeFromGame(g, u, 'Tester')!), teamName: g.settings.teamName, shortName: g.settings.shortName })
