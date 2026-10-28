import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { ENGINE_VERSION } from '@engine/version'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomSeasons, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { autoChoice } from '@game/__tests__/roomHelpers'
import { liveSeats, pollDelay, RoomSession, SEAT_KEEP_MS, type RoomTransport, type RoomUi, type SeatRecord, type SeatStore } from '../rooms'
import type { Guest } from '../server/service'
import { fakeRoomView, makeHarness, VISITOR, VISITOR2 } from './serverHarness'

const u = loadTestUniverse()
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-26T00:05:00Z' }
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'realistic', hardMode: true }
const CLUBS = roomClubs(u, SETTINGS)
const T = 180000

type H = ReturnType<typeof makeHarness>

/** A device: its own seat store and timers, talking to the server harness as a guest and peeking at its rooms. */
function device(h: H, who: Guest) {
  let seats: Record<string, SeatRecord> = {}
  const store: SeatStore = { get: () => structuredClone(seats), set: (all) => void (seats = structuredClone(all)) }
  const timers: Array<{ fn: () => void; ms: number }> = []
  const states: Array<RoomUi | null> = []
  const finished: RoomView[] = []
  const transport: RoomTransport = {
    invoke: async (body) => {
      const r = await h.server.handle(who, JSON.stringify(body))
      return { status: r.status, body: r.body }
    },
    rpc: async <R,>(fn: string, args: Record<string, unknown>): Promise<R> => {
      if (fn !== 'h2h_peek') throw new Error(fn)
      const row = h.rooms.get(String(args.p_code))
      if (!row) return null as R
      const view = fakeRoomView(row, h.clock.now.getTime())
      if (args.p_since === row.version && view.status === row.status) return { unchanged: true, version: row.version, status: view.status } as R
      return view as R
    },
  }
  const session = new RoomSession({
    transport,
    seats: store,
    report: (ui) => states.push(ui),
    now: () => h.clock.now.getTime(),
    visible: () => true,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => timers.splice(0),
    onFinished: (room) => finished.push(room),
    signedIn: () => false,
  })
  return { session, timers, states, finished, seats: () => seats }
}

const ANA = { name: 'Ana', formationId: '4-3-3', hostClubId: CLUBS[1] }
const BEN = { name: 'Ben', formationId: '3-5-2', hostClubId: CLUBS[5] }

describe('two devices play a room through the session', () => {
  it('makes, shares, joins and drafts to the result, each device crediting it once', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    expect(made.ok).toBe(true)
    const code = made.ok ? made.code : ''
    expect(a.session.state).toMatchObject({ code, seat: 0, error: null })
    expect(a.seats()[code]).toMatchObject({ seat: 0 })
    expect(a.timers.at(-1)?.ms).toBe(3000)
    await b.session.open(code)
    expect(b.session.state).toMatchObject({ code, seat: null })
    expect(b.session.state?.view?.status).toBe('waiting')
    expect(await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)).toBe(true)
    expect(b.session.state?.seat).toBe(1)
    let guard = 0
    for (;;) {
      await a.session.poll()
      const view = (a.session.state?.view ?? null) as RoomView
      if (view.status !== 'drafting' || guard++ > 60) break
      const mover = view.turn === 0 ? a : b
      await mover.session.poll()
      const mine = mover.session.state!.view!
      const c = autoChoice(u, draftFromEvents(u, mine.settings, mine.managers as [H2HManager, H2HManager], mine.events))
      expect(await mover.session.pick(c.p, c.k), JSON.stringify(mover.session.state?.error)).toBe(true)
    }
    await b.session.poll()
    for (const d of [a, b]) {
      expect(d.session.state?.view?.status).toBe('finished')
      expect(d.session.state?.view?.result).not.toBeNull()
      // Finished: no more polling, one credit, and a second look credits nothing more
      expect(d.finished).toHaveLength(1)
      await d.session.open(code)
      expect(d.finished).toHaveLength(1)
    }
  }, T)

  it('reads the other manager leaving, stops polling, and forgets the seat it left', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    const code = made.ok ? made.code : ''
    await b.session.open(code)
    await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)
    expect(await b.session.leave()).toBe(true)
    expect(b.seats()[code]).toBeUndefined()
    a.timers.splice(0)
    await a.session.poll()
    expect(a.session.state?.view?.status).toBe('left')
    expect(a.timers).toHaveLength(0)
  }, T)

  it('says why a pick was refused and reads the room again', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    const code = made.ok ? made.code : ''
    await b.session.open(code)
    await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)
    await a.session.poll()
    const view = a.session.state!.view!
    const waiting = view.turn === 0 ? b : a
    expect(await waiting.session.pick('nobody', 'GK')).toBe(false)
    expect(waiting.session.state?.errorCode).toBe('not_your_turn')
    expect(waiting.session.state?.error).toMatch(/other manager/)
    // A code nobody holds
    const c = device(h, VISITOR)
    await c.session.open('ZZZZZZZZ')
    expect(c.session.state?.missing).toBe(true)
  }, T)
})

describe('a room abandoned mid-draft', () => {
  it('the other manager vanishes after a few picks: the room times out, polling stops, and a late pick is told why', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    const code = made.ok ? made.code : ''
    await b.session.open(code)
    await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)
    // three picks, then b's tab is closed in the middle of the draft (no leave)
    for (let i = 0; i < 3; i++) {
      await a.session.poll()
      await b.session.poll()
      const view = a.session.state!.view!
      const mover = view.turn === 0 ? a : b
      const mine = mover.session.state!.view!
      const c = autoChoice(u, draftFromEvents(u, mine.settings, mine.managers as [H2HManager, H2HManager], mine.events))
      expect(await mover.session.pick(c.p, c.k)).toBe(true)
    }
    await a.session.poll()
    expect(a.session.state?.view?.status).toBe('drafting')
    // a network drop on a's poll: said once, polling goes on, and the next answer clears it
    const rpc = a.session['d'].transport.rpc
    a.session['d'].transport.rpc = async () => {
      throw new Error('Load failed')
    }
    await a.session.poll()
    expect(a.session.state).toMatchObject({ errorCode: 'network' })
    expect(a.timers.length).toBeGreaterThan(0)
    a.session['d'].transport.rpc = rpc
    h.clock.now = new Date(h.clock.now.getTime() + 16 * 60000)
    a.timers.splice(0)
    await a.session.poll()
    expect(a.session.state?.view?.status).toBe('timed_out')
    expect(a.session.state?.errorCode).toBeNull()
    expect(a.timers).toHaveLength(0)
    // a pick sent from a screen still showing the draft is refused with the reason, never applied
    const before = h.rooms.get(code)!.version
    expect(await a.session.pick('nobody', 'GK')).toBe(false)
    expect(a.session.state?.errorCode).toMatch(/room_closed|not_your_turn|stale/)
    expect(h.rooms.get(code)!.version).toBe(before)
  }, T)
})

describe('session helpers', () => {
  it('polls fast while the other manager picks, slower otherwise, and stops once the room ends', () => {
    const view = (status: RoomView['status'], turn: 0 | 1 | null) => ({ status, turn }) as RoomView
    expect(pollDelay(null, null, true)).toBe(3000)
    expect(pollDelay(view('waiting', null), 0, true)).toBe(3000)
    expect(pollDelay(view('drafting', 1), 0, true)).toBe(2000)
    expect(pollDelay(view('drafting', 0), 0, true)).toBe(6000)
    expect(pollDelay(view('drafting', 0), null, true)).toBe(2000)
    expect(pollDelay(view('drafting', 1), 0, false)).toBe(15000)
    for (const s of ['finished', 'expired', 'timed_out', 'left'] as const) expect(pollDelay(view(s, null), 0, true)).toBeNull()
  })

  it('keeps seats for two days and drops anything malformed', () => {
    const now = Date.parse('2026-10-26T10:00:00Z')
    const kept = liveSeats({ K7Q2MX9A: { seat: 0, token: 't', at: now - 1000 }, K7Q2MX9B: { seat: 1, token: 't', at: now - SEAT_KEEP_MS - 1 }, bad: { seat: 0, token: 't', at: now }, K7Q2MX9C: { seat: 2, token: 't', at: now } as unknown as SeatRecord }, now)
    expect(Object.keys(kept)).toEqual(['K7Q2MX9A'])
  })
})
