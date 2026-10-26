import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { ENGINE_VERSION } from '@engine/version'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomSeasons, roomWheel, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { autoChoice, playHotSeat } from '@game/__tests__/roomHelpers'
import { guestSubject, type Reply, type Requester } from '../server/service'
import { parseRequest } from '../server/validate'
import { ALICE, BOB, VISITOR, VISITOR2, makeHarness } from './serverHarness'

const u = loadTestUniverse()
const STAMP = u.generatedAt
const LIVE = { engine: ENGINE_VERSION, data: STAMP, builtAt: '2026-10-26T00:05:00Z' }
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'calibrated', hardMode: false }
const CLUBS = roomClubs(u, SETTINGS)
const ANA = { name: 'Ana', formationId: '4-3-3', hostClubId: CLUBS[2] }
const BEN = { name: 'Ben', formationId: '4-4-2', hostClubId: CLUBS[9] }
const T = 180000

type H = ReturnType<typeof makeHarness>
const call = (h: H, body: unknown, who: Requester = VISITOR): Promise<Reply> => h.server.handle(who, JSON.stringify(body))
const create = (h: H, who: Requester = VISITOR, extra: Record<string, unknown> = {}) => call(h, { op: 'room.create', settings: SETTINGS, manager: ANA, engine: ENGINE_VERSION, data: STAMP, ...extra }, who)
const join = (h: H, code: string, who: Requester = VISITOR2, manager: unknown = BEN) => call(h, { op: 'room.join', code, manager, engine: ENGINE_VERSION, data: STAMP }, who)
const roomOf = (r: Reply) => r.body.room as RoomView

/** A room made and joined: the code, both tokens and the room as it stands. */
async function started(h: H) {
  const a = await create(h)
  const code = roomOf(a).code
  const b = await join(h, code)
  return { code, tokens: [String(a.body.token), String(b.body.token)] as [string, string], room: roomOf(b) }
}

/** The pick the assistant would make for the seat to move, from the public view only. */
function nextPick(room: RoomView) {
  const managers = room.managers as [H2HManager, H2HManager]
  return autoChoice(u, draftFromEvents(u, room.settings, managers, room.events))
}

describe('rooms need no account', () => {
  it('lets a guest make a room: a code, seat 0, a token, and a public view without the seed', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const r = await create(h)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ status: 'ok', seat: 0 })
    expect(String(r.body.token)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const room = roomOf(r)
    expect(room).toMatchObject({ status: 'waiting', version: 0, seed: null, turn: null, engineVersion: ENGINE_VERSION, dataVersion: STAMP, settings: SETTINGS })
    expect(room.managers).toEqual([{ name: 'Ana', shortName: 'A', formationId: '4-3-3', hostClubId: CLUBS[2] }, null])
    // Only the hash is stored; the reply carries the token once
    const row = h.rooms.get(room.code)!
    expect(row.seat0Hash).toMatch(/^[0-9a-f]{64}$/)
    expect(row.seat0Hash).not.toContain(String(r.body.token))
    expect(row.seat0User).toBeNull()
    expect(JSON.stringify(room)).not.toContain(row.seed)
  }, T)

  it('keeps guests to the rooms: every other op answers 401', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    for (const body of [{ op: 'daily.pin' }, { op: 'weekly.pin' }, { op: 'account.delete', confirm: 'delete my account' }, { op: 'room.resume', code: 'K7Q2MX9A' }]) {
      const r = await call(h, body)
      expect(r.status, body.op).toBe(401)
      expect(r.body.code).toBe('unauthorised')
    }
    expect((await call(h, { op: 'status' })).status).toBe(200)
  })

  it('records a signed-in creator\'s account on the seat, never in the view', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const r = await create(h, ALICE)
    expect(h.rooms.get(roomOf(r).code)!.seat0User).toBe(ALICE.userId)
    expect(JSON.stringify(r.body.room)).not.toContain(ALICE.userId)
  }, T)

  it('meters guests by a hash of their address', async () => {
    const sha = async (b: Uint8Array) => (await import('node:crypto')).createHash('sha256').update(b).digest('hex')
    const a = await guestSubject('203.0.113.7', sha)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await guestSubject(' 203.0.113.7 ', sha)).toBe(a)
    expect(await guestSubject('203.0.113.8', sha)).not.toBe(a)
    expect(a).not.toContain('203')
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    h.limits.set(`room.create|${VISITOR.subject}`, 30)
    expect((await create(h)).body.code).toBe('rate_limited')
    expect((await create(h, VISITOR2)).status).toBe(200)
  }, T)
})

describe('making and joining a room', () => {
  it('refuses a stale client (engine or data) and settings the hot-seat setup could not make', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    expect((await create(h, VISITOR, { engine: 'old' })).body.code).toBe('engine_mismatch')
    expect((await create(h, VISITOR, { data: '2020-01-01' })).body).toMatchObject({ code: 'data_mismatch', liveData: STAMP })
    expect((await create(h, VISITOR, { settings: { ...SETTINGS, leagueSeason: 1950 } })).body.code).toBe('invalid_room')
    expect((await create(h, VISITOR, { settings: { ...SETTINGS, wheelLeagues: ['spain'] } })).body.code).toBe('invalid_room')
    expect((await create(h, VISITOR, { manager: { ...ANA, hostClubId: 'nowhere' } })).body.code).toBe('invalid_manager')
    expect((await create(h, VISITOR, { manager: { ...ANA, name: 'A​na' } })).body.code).toBe('invalid_manager')
    const stale = makeHarness(new Date('2026-10-26T10:00:00Z'), { ...LIVE, engine: 'old' })
    expect((await create(stale)).body.code).toBe('engine_mismatch')
    expect(h.rooms.size).toBe(0)
  }, T)

  it('starts the draft when the second manager joins: the spins up to the first pick, nobody else gets in', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = await create(h)
    const code = roomOf(a).code
    expect((await join(h, code, VISITOR2, { ...BEN, name: 'ana' })).body.code).toBe('invalid_manager')
    expect((await join(h, code, VISITOR2, { ...BEN, hostClubId: ANA.hostClubId })).body.code).toBe('invalid_manager')
    const b = await join(h, code.toLowerCase().replace(/^(....)/, '$1-'))
    expect(b.status).toBe(200)
    expect(b.body.seat).toBe(1)
    const room = roomOf(b)
    expect(room.status).toBe('drafting')
    expect(room.events.length).toBeGreaterThan(0)
    expect(room.events.every((e) => e.t === 's')).toBe(true)
    expect(room.turn).toBe(draftFromEvents(u, room.settings, room.managers as [H2HManager, H2HManager], room.events).picking)
    expect(room.seed).toBeNull()
    expect((await join(h, code, BOB)).body.code).toBe('room_full')
    expect((await join(h, 'ZZZZZZZZ')).status).toBe(404)
  }, T)

  it('closes a room nobody joins within 30 minutes', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const code = roomOf(await create(h)).code
    h.clock.now = new Date('2026-10-26T10:31:00Z')
    const r = await join(h, code)
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'room_closed', roomStatus: 'expired' })
  }, T)
})

describe('the draft, pick by pick', () => {
  it('takes a pick only from the seat to move, with its own token, on the version it saw', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { code, tokens, room } = await started(h)
    const c = nextPick(room)
    const other = c.seat === 0 ? 1 : 0
    const body = (token: string, extra: Record<string, unknown> = {}) => ({ op: 'room.pick', code, token, version: room.version, playerSeasonId: c.p, slotId: c.k, ...extra })
    expect((await call(h, body(tokens[other]))).body.code).toBe('not_your_turn')
    expect((await call(h, body('x'.repeat(43)))).body.code).toBe('not_seated')
    expect((await call(h, body(tokens[c.seat], { version: room.version + 1 }))).body.code).toBe('stale')
    const wrong = u.clubSeasons.find((cs) => cs.season === SEASON - 3)!.squad[0].id
    const bad = await call(h, body(tokens[c.seat], { playerSeasonId: wrong }))
    expect(bad.status).toBe(422)
    expect(bad.body.code).toBe('invalid_pick')
    const ok = await call(h, body(tokens[c.seat]))
    expect(ok.status).toBe(200)
    const after = roomOf(ok)
    expect(after.version).toBe(room.version + 1)
    expect(after.events.slice(0, room.events.length)).toEqual(room.events)
    expect(after.events[room.events.length]).toEqual({ t: 'p', seat: c.seat, p: c.p, k: c.k })
  }, T)

  it('plays a whole room to the season, the same as a hot-seat game on the revealed seed', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const s = await started(h)
    let room = s.room
    const toks = s.tokens
    let guard = 0
    while (room.status === 'drafting' && guard++ < 60) {
      const c = nextPick(room)
      const r = await call(h, { op: 'room.pick', code: room.code, token: toks[c.seat], version: room.version, playerSeasonId: c.p, slotId: c.k }, c.seat === 0 ? VISITOR : VISITOR2)
      expect(r.status, JSON.stringify(r.body)).toBe(200)
      room = roomOf(r)
    }
    expect(room.status).toBe('finished')
    expect(room.turn).toBeNull()
    expect(room.seed).toMatch(/^room-/)
    const hot = playHotSeat(u, room.seed!, room.settings, room.managers as [H2HManager, H2HManager])
    expect(room.result).toEqual(hot.result)
    expect(draftFromEvents(u, room.settings, room.managers as [H2HManager, H2HManager], room.events).drafts.map((d) => d.lineup)).toEqual(hot.draft.drafts.map((d) => d.lineup))
    // No log line carries a token
    expect(JSON.stringify(h.logs)).not.toContain('tok0000')
    expect(h.logs.filter((l) => l.op === 'room.pick').every((l) => l.user === 'guest')).toBe(true)
  }, T)

  it('times a draft out after 15 idle minutes, and lets either manager leave', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { code, tokens, room } = await started(h)
    h.clock.now = new Date('2026-10-26T10:16:00Z')
    const c = nextPick(room)
    const late = await call(h, { op: 'room.pick', code, token: tokens[c.seat], version: room.version, playerSeasonId: c.p, slotId: c.k })
    expect(late.body).toMatchObject({ code: 'room_closed', roomStatus: 'timed_out' })
    const h2 = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const s2 = await started(h2)
    expect((await call(h2, { op: 'room.leave', code: s2.code, token: 'y'.repeat(43) })).body.code).toBe('not_seated')
    const left = await call(h2, { op: 'room.leave', code: s2.code, token: s2.tokens[1] })
    expect(roomOf(left).status).toBe('left')
    expect((await call(h2, { op: 'room.leave', code: s2.code, token: s2.tokens[0] })).body.code).toBe('room_closed')
  }, T)

  it('gives a signed-in manager their seat back with a new token', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = await create(h, ALICE)
    const code = roomOf(a).code
    expect((await call(h, { op: 'room.resume', code }, BOB)).body.code).toBe('not_seated')
    const r = await call(h, { op: 'room.resume', code }, ALICE)
    expect(r.status).toBe(200)
    expect(r.body.seat).toBe(0)
    expect(r.body.token).not.toBe(a.body.token)
    expect((await call(h, { op: 'room.leave', code, token: String(a.body.token) })).body.code).toBe('not_seated')
    expect(roomOf(await call(h, { op: 'room.leave', code, token: String(r.body.token) })).status).toBe('left')
  }, T)

  it('plays a room on the wheel of every league, on the server\'s own universe of those packs', async () => {
    const all = loadTestUniverse(['england', 'france', 'germany', 'italy', 'netherlands', 'portugal', 'spain'])
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const settings = { ...SETTINGS, wheelLeagues: roomWheel(all, 'england', 'all') }
    const a = await create(h, VISITOR, { settings })
    expect(a.status, JSON.stringify(a.body)).toBe(200)
    const b = await join(h, roomOf(a).code)
    const room = roomOf(b)
    const t0 = Date.now()
    const c = autoChoice(all, draftFromEvents(all, room.settings, room.managers as [H2HManager, H2HManager], room.events))
    const r = await call(h, { op: 'room.pick', code: room.code, token: [a.body.token, b.body.token][c.seat], version: room.version, playerSeasonId: c.p, slotId: c.k })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    // Warm (the universe cached by the join): a pick replays the room in well under a second
    expect(Date.now() - t0).toBeLessThan(2000)
  }, T)
})

describe('room requests', () => {
  it('refuses malformed room bodies before any work', () => {
    const bad = [
      { op: 'room.create', settings: { ...SETTINGS, extra: 1 }, manager: ANA, engine: '4', data: STAMP },
      { op: 'room.create', settings: SETTINGS, manager: { ...ANA, shortName: 'X' }, engine: '4', data: STAMP },
      { op: 'room.join', code: 'O0O0O0O0', manager: BEN, engine: '4', data: STAMP },
      { op: 'room.pick', code: 'K7Q2MX9A', token: 'short', version: 1, playerSeasonId: 'x', slotId: 'GK' },
      { op: 'room.pick', code: 'K7Q2MX9A', token: 'x'.repeat(43), version: -1, playerSeasonId: 'x', slotId: 'GK' },
      { op: 'room.leave', code: 'K7Q2MX9A' },
      { op: 'room.resume', code: 'K7Q2MX9A', token: 'x'.repeat(43) },
    ]
    for (const b of bad) expect(parseRequest(JSON.stringify(b)).ok, JSON.stringify(b)).toBe(false)
    expect(parseRequest(JSON.stringify({ op: 'room.pick', code: 'k7q2-mx9a', token: 'x'.repeat(43), version: 3, playerSeasonId: 'p@2025@c', slotId: 'bench' }))).toMatchObject({ ok: true, value: { code: 'K7Q2MX9A' } })
  })
})
