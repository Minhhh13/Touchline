import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { ENGINE_VERSION } from '@engine/version'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomSeasons, ROOM_IDLE_MINUTES, ROOM_WAIT_MINUTES, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { autoChoice } from '@game/__tests__/roomHelpers'
import { CALL_TIMEOUT_MS, CallTimeout, clockText, pollDelay, roomInviteText, roomMessage, RoomSession, turnClock, waitClock, type RoomTransport, type SeatRecord, type SeatStore } from '../rooms'
import type { Guest } from '../server/service'
import { fakeRoomView, makeHarness, VISITOR, VISITOR2 } from './serverHarness'

const u = loadTestUniverse()
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-26T00:05:00Z' }
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'calibrated', hardMode: false }
const CLUBS = roomClubs(u, SETTINGS)
const T = 180000
const VISITOR3: Guest = { guest: true, subject: '77777777-7777-4777-8777-777777777777' }

type H = ReturnType<typeof makeHarness>

/** A device as in roomSession.test.ts, with switches for a dead connection and an answer that never comes in time. */
function device(h: H, who: Guest) {
  let seats: Record<string, SeatRecord> = {}
  const store: SeatStore = { get: () => structuredClone(seats), set: (all) => void (seats = structuredClone(all)) }
  const timers: Array<{ fn: () => void; ms: number }> = []
  const net = { down: false, late: false, hang: false }
  const transport: RoomTransport = {
    invoke: async (body) => {
      if (net.down) throw new TypeError('Load failed')
      const r = await h.server.handle(who, JSON.stringify(body))
      return { status: r.status, body: r.body }
    },
    rpc: async <R,>(_fn: string, args: Record<string, unknown>): Promise<R> => {
      if (net.down) throw new TypeError('Load failed')
      if (net.hang) return new Promise<R>(() => {})
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
    report: () => {},
    now: () => h.clock.now.getTime(),
    visible: () => true,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => timers.splice(0),
    onFinished: () => {},
    signedIn: () => false,
    engine: ENGINE_VERSION,
    // `late`: the server did the work but the answer arrives after the deadline
    withTimeout: async (p) => {
      const v = await p
      if (net.late) throw new CallTimeout('timeout')
      return v
    },
  })
  return { session, timers, net, seats: () => seats }
}

const ANA = { name: 'Ana', formationId: '4-3-3', hostClubId: CLUBS[1] }
const BEN = { name: 'Ben', formationId: '4-4-2', hostClubId: CLUBS[5] }
const CAL = { name: 'Cal', formationId: '4-4-2', hostClubId: CLUBS[7] }

async function started(h: H) {
  const a = device(h, VISITOR)
  const b = device(h, VISITOR2)
  const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
  const code = made.ok ? made.code : ''
  await b.session.open(code)
  expect(await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)).toBe(true)
  await a.session.poll()
  return { a, b, code }
}

function choiceFor(view: RoomView) {
  return autoChoice(u, draftFromEvents(u, view.settings, view.managers as [H2HManager, H2HManager], view.events))
}

describe('a room under a bad connection', () => {
  it('a third device is told the room is full, what it can do, and then watches the draft', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { code } = await started(h)
    const c = device(h, VISITOR3)
    await c.session.open(code)
    // c opened the room before it filled: its screen still offers the join
    expect(await c.session.join(CAL, ENGINE_VERSION, u.generatedAt)).toBe(false)
    expect(c.session.state?.errorCode).toBe('room_full')
    expect(c.session.state?.error).toMatch(/watch the draft here, or make a room of your own/)
    await c.session.poll()
    expect(c.session.state).toMatchObject({ seat: null })
    expect(c.session.state?.view?.status).toBe('drafting')
  }, T)

  it('a dropped connection backs off, says so, and comes back by itself or on the browser\'s online event', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { a } = await started(h)
    a.net.down = true
    const waits: number[] = []
    for (let i = 0; i < 5; i++) {
      await a.session.poll()
      waits.push(a.timers.at(-1)!.ms)
    }
    expect(a.session.state).toMatchObject({ errorCode: 'network', failures: 5 })
    expect(a.session.state?.error).toMatch(/keeps trying, or tap Try again/)
    // longer and longer, never past 30 s
    expect(waits).toEqual([...waits].sort((x, y) => x - y))
    expect(Math.max(...waits)).toBe(30000)
    a.session.connectionChanged(false)
    expect(a.session.state?.errorCode).toBe('network')
    a.net.down = false
    a.session.connectionChanged(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(a.session.state).toMatchObject({ errorCode: null, error: null, failures: 0 })
    expect(a.session.state?.syncedAt).toBe(h.clock.now.getTime())
  }, T)

  it('a read that never answers (an iOS tab put away mid-request) stops blocking the next after the timeout', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { a, b } = await started(h)
    a.net.hang = true
    void a.session.poll()
    // b picks while a's read hangs
    const mover = a.session.state!.view!.turn === 1 ? b : a
    if (mover === b) {
      await b.session.poll()
      expect(await b.session.pick(choiceFor(b.session.state!.view!).p, choiceFor(b.session.state!.view!).k)).toBe(true)
    }
    const seen = a.session.state!.view!.version
    a.net.hang = false
    // straight away the hung read still holds the slot
    await a.session.poll()
    expect(a.session.state!.view!.version).toBe(seen)
    // the tab comes back later: the hung read no longer counts
    h.clock.now = new Date(h.clock.now.getTime() + CALL_TIMEOUT_MS + 1000)
    a.session.visibilityChanged()
    await new Promise((r) => setTimeout(r, 0))
    expect(a.session.state!.view!.version).toBe(h.rooms.get(a.session.state!.code)!.version)
  }, T)

  it('a pick whose answer comes too late is reported, and the room is read again to show it went in', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { a, b, code } = await started(h)
    const mover = a.session.state!.view!.turn === 0 ? a : b
    await mover.session.poll()
    const before = h.rooms.get(code)!.version
    const c = choiceFor(mover.session.state!.view!)
    mover.net.late = true
    expect(await mover.session.pick(c.p, c.k)).toBe(false)
    expect(mover.session.state?.errorCode).toBe('timeout')
    expect(mover.session.state?.error).toMatch(/If your pick is not in, make it again/)
    mover.net.late = false
    // the session's own read again, then one more once it settles
    await new Promise((r) => setTimeout(r, 0))
    await mover.session.poll()
    // the server took it: one pick, and the device now shows it
    expect(h.rooms.get(code)!.version).toBeGreaterThan(before)
    expect(mover.session.state!.view!.version).toBe(h.rooms.get(code)!.version)
    expect(mover.session.state?.errorCode).toBeNull()
  }, T)

  it('a room on an earlier engine refuses the pick and says to make a new room', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const { a, b, code } = await started(h)
    h.rooms.get(code)!.engine = String(Number(ENGINE_VERSION) - 1)
    const mover = a.session.state!.view!.turn === 0 ? a : b
    await mover.session.poll()
    const c = choiceFor(mover.session.state!.view!)
    expect(await mover.session.pick(c.p, c.k)).toBe(false)
    expect(mover.session.state?.errorCode).toBe('engine_mismatch')
    expect(mover.session.state?.error).toMatch(/earlier version.*make a new room/)
    expect(roomMessage('engine_mismatch', undefined, { roomEngine: '99' }, ENGINE_VERSION)).toMatch(/reload the page/)
  }, T)
})

describe('room words and clocks', () => {
  it('every refusal says what to do next, never the bare server reason', () => {
    const codes = ['network', 'timeout', 'rate_limited', 'rooms_busy', 'engine_mismatch', 'data_mismatch', 'no_room', 'room_full', 'room_closed', 'stale', 'not_your_turn', 'not_seated', 'invalid_pick', 'invalid_manager', 'invalid_room', 'bad_request', 'unavailable', '500']
    for (const code of codes) {
      const m = roomMessage(code, 'Raw reason', {}, ENGINE_VERSION)
      // the what-next half follows a colon: try, reload, wait, pick, check, make, change, sign in, watch, tap...
      expect(m, code).toMatch(/: .*\b(try|reload|wait|pick|check|make|change|sign in|watch|tap|yours opens|its result)\b/i)
      expect(m.endsWith('.'), code).toBe(true)
    }
    expect(roomMessage('invalid_manager', 'Ben is taken in this room: pick another name')).toBe('Ben is taken in this room: pick another name: change it and try again.')
    expect(roomMessage('room_closed', undefined, { roomStatus: 'finished' })).toMatch(/result/)
  })

  it('the turn clock runs from the last move, and the waiting clock from the room\'s making', () => {
    const now = Date.parse('2026-10-26T10:00:00Z')
    const idleAt = new Date(now + 10 * 60000).toISOString()
    const c = turnClock({ status: 'drafting', idleAt }, now)!
    expect(c.elapsed).toBe((ROOM_IDLE_MINUTES - 10) * 60000)
    expect(c.left).toBe(10 * 60000)
    expect(c.quiet).toBe(true)
    expect(turnClock({ status: 'drafting', idleAt: new Date(now + (ROOM_IDLE_MINUTES - 1) * 60000).toISOString() }, now)!.quiet).toBe(false)
    expect(turnClock({ status: 'drafting', idleAt: new Date(now - 5000).toISOString() }, now)).toMatchObject({ left: 0, elapsed: ROOM_IDLE_MINUTES * 60000 })
    expect(turnClock({ status: 'finished', idleAt }, now)).toBeNull()
    expect(turnClock({ status: 'drafting', idleAt: null }, now)).toBeNull()
    const w = waitClock({ status: 'waiting', expiresAt: new Date(now + (ROOM_WAIT_MINUTES - 2) * 60000).toISOString() }, now)!
    expect(w).toEqual({ elapsed: 2 * 60000, left: (ROOM_WAIT_MINUTES - 2) * 60000 })
    expect(clockText(42500)).toBe('0:42')
    expect(clockText(12 * 60000 + 5000)).toBe('12:05')
    expect(clockText(-3)).toBe('0:00')
  })

  it('backs off to 30 s on failures and keeps the hidden tab\'s floor', () => {
    const view = { status: 'drafting', turn: 1 } as RoomView
    expect([0, 1, 2, 3, 4, 9].map((f) => pollDelay(view, 0, true, f))).toEqual([2000, 6000, 12000, 24000, 30000, 30000])
    expect(pollDelay(view, 0, false, 1)).toBe(15000)
    expect(pollDelay({ status: 'left', turn: null } as RoomView, 0, true, 3)).toBeNull()
  })

  it('an invite names the host and the room, with no account needed', () => {
    expect(roomInviteText('Ana', 'K7Q2MX9A')).toBe('Ana invites you to a TouchLine head-to-head. Room K7Q2-MX9A, no account needed.')
    expect(roomInviteText(null, 'K7Q2MX9A')).toMatch(/^Join me for a TouchLine head-to-head\. Room K7Q2-MX9A/)
  })
})
