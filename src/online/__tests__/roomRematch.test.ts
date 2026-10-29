import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { ENGINE_VERSION } from '@engine/version'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomSeasons, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { autoChoice } from '@game/__tests__/roomHelpers'
import { rematchOf, RoomSession, roomInviteText, type RoomTransport, type SeatRecord, type SeatStore } from '../rooms'
import type { Guest } from '../server/service'
import { fakeRoomView, makeHarness, VISITOR, VISITOR2 } from './serverHarness'

const u = loadTestUniverse()
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-29T00:05:00Z' }
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'calibrated', hardMode: false }
const CLUBS = roomClubs(u, SETTINGS)
const T = 180000
const ANA = { name: 'Ana', formationId: '4-3-3', hostClubId: CLUBS[1] }
const BEN = { name: 'Ben', formationId: '3-5-2', hostClubId: CLUBS[5] }

type H = ReturnType<typeof makeHarness>

/** A device as roomSession.test.ts builds one: its own seat store (shared with a reload when given), a guest of the harness. */
function device(h: H, who: Guest, kept?: { seats: Record<string, SeatRecord> }) {
  const box = kept ?? { seats: {} as Record<string, SeatRecord> }
  const store: SeatStore = { get: () => structuredClone(box.seats), set: (all) => void (box.seats = structuredClone(all)) }
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
  const session = new RoomSession({ transport, seats: store, report: () => {}, now: () => h.clock.now.getTime(), visible: () => true, setTimer: () => 0, clearTimer: () => {}, onFinished: () => {}, signedIn: () => false })
  return { session, box }
}

/** Ana makes a room, Ben joins: both devices, the room's code. */
async function seated(h: H) {
  const a = device(h, VISITOR)
  const b = device(h, VISITOR2)
  const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
  const code = made.ok ? made.code : ''
  await b.session.open(code)
  expect(await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)).toBe(true)
  return { a, b, code }
}

describe('a rematch through room.create', () => {
  it('after a finished room: the same settings and manager, a note of who it is for, and the friend joins it', async () => {
    const h = makeHarness(new Date('2026-10-29T10:00:00Z'), LIVE)
    const { a, b, code } = await seated(h)
    for (let guard = 0; guard < 80; guard++) {
      await a.session.poll()
      const view = a.session.state!.view!
      if (view.status !== 'drafting') break
      const mover = view.turn === 0 ? a : b
      await mover.session.poll()
      const mine = mover.session.state!.view!
      const c = autoChoice(u, draftFromEvents(u, mine.settings, mine.managers as [H2HManager, H2HManager], mine.events))
      expect(await mover.session.pick(c.p, c.k)).toBe(true)
    }
    await b.session.poll()
    const done = b.session.state!.view!
    expect(done.status).toBe('finished')
    const rooms = h.rooms.size
    // Ben, who joined, asks for the rematch: he hosts it with his own name, shape and club
    const r = await b.session.rematch(done, 1, ENGINE_VERSION, u.generatedAt)
    expect(r).toMatchObject({ ok: true, reused: false })
    const next = r.ok ? r.code : ''
    expect(next).not.toBe(code)
    expect(h.rooms.size).toBe(rooms + 1)
    const fresh = b.session.state!
    expect(fresh).toMatchObject({ code: next, seat: 0, rematch: { of: code, opponent: 'Ana' } })
    expect(fresh.view?.status).toBe('waiting')
    expect(fresh.view?.settings).toEqual(done.settings)
    expect(fresh.view?.managers[0]).toMatchObject({ name: 'Ben', formationId: BEN.formationId, hostClubId: BEN.hostClubId })
    expect(b.box.seats[next]).toMatchObject({ seat: 0, rematchOf: code, opponent: 'Ana' })
    // Ana opens the code she was sent and takes the other seat: the rematch drafts
    await a.session.open(next)
    expect(a.session.state?.rematch).toBeNull()
    expect(await a.session.join(ANA, ENGINE_VERSION, u.generatedAt)).toBe(true)
    expect(a.session.state?.view?.status).toBe('drafting')
    // Ben presses Rematch on the old result again: the rematch already drafting opens, no second room
    await b.session.open(code)
    const again = await b.session.rematch(done, 1, ENGINE_VERSION, u.generatedAt)
    expect(again).toEqual({ ok: true, code: next, reused: true })
    expect(h.rooms.size).toBe(rooms + 1)
    expect(b.session.state?.code).toBe(next)
  }, T)

  it('a second press while the rematch waits opens it; once it has closed, a new one is made', async () => {
    const h = makeHarness(new Date('2026-10-29T10:00:00Z'), LIVE)
    const { a, b, code } = await seated(h)
    expect(await b.session.leave()).toBe(true)
    await a.session.poll()
    const left = a.session.state!.view!
    expect(left.status).toBe('left')
    const first = await a.session.rematch(left, 0, ENGINE_VERSION, u.generatedAt)
    expect(first).toMatchObject({ ok: true, reused: false })
    const one = first.ok ? first.code : ''
    expect(a.session.state?.rematch).toEqual({ of: code, opponent: 'Ben' })
    await a.session.open(code)
    expect(await a.session.rematch(left, 0, ENGINE_VERSION, u.generatedAt)).toEqual({ ok: true, code: one, reused: true })
    // Nobody joined in 30 minutes: the rematch expired, so the next press makes another
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 60000)
    await a.session.open(code)
    const third = await a.session.rematch(left, 0, ENGINE_VERSION, u.generatedAt)
    expect(third).toMatchObject({ ok: true, reused: false })
    expect(third.ok && third.code).not.toBe(one)
    expect(a.session.rematchMade(code)).toBe(third.ok ? third.code : '')
  }, T)

  it('a reload keeps who the rematch is for; a refused rematch stays on the old room', async () => {
    const h = makeHarness(new Date('2026-10-29T10:00:00Z'), LIVE)
    const { a, b } = await seated(h)
    await b.session.leave()
    await a.session.poll()
    const left = a.session.state!.view!
    const r = await a.session.rematch(left, 0, ENGINE_VERSION, u.generatedAt)
    const next = r.ok ? r.code : ''
    const reloaded = device(h, VISITOR, a.box)
    await reloaded.session.open(next)
    expect(reloaded.session.state).toMatchObject({ seat: 0, rematch: { of: left.code, opponent: 'Ben' } })
    // A build on another engine: refused, the screen keeps the room it was on
    const other = device(h, VISITOR)
    await other.session.open(left.code)
    const refused = await other.session.rematch(left, 0, '1', u.generatedAt)
    expect(refused.ok).toBe(false)
    expect(other.session.state?.code).toBe(left.code)
  }, T)
})

describe('rematch helpers', () => {
  it('keeps this seat as the manager and names the other', () => {
    const view = { code: 'K7Q2MX9A', managers: [{ name: 'Ana', shortName: 'ANA', formationId: '4-3-3', hostClubId: 'x' }, { name: 'Ben', shortName: 'BEN', formationId: '3-5-2', hostClubId: 'y' }] } as unknown as RoomView
    expect(rematchOf(view, 1)).toEqual({ manager: { name: 'Ben', formationId: '3-5-2', hostClubId: 'y' }, note: { of: 'K7Q2MX9A', opponent: 'Ana' } })
    expect(rematchOf({ ...view, managers: [view.managers[0], null] } as unknown as RoomView, 0)?.note.opponent).toBeNull()
    expect(rematchOf({ ...view, managers: [view.managers[0], null] } as unknown as RoomView, 1)).toBeNull()
  })

  it('words a rematch invite apart from a first one', () => {
    expect(roomInviteText('Ana', 'K7Q2MX9A')).toBe('Ana invites you to a TouchLine head-to-head. Room K7Q2-MX9A, no account needed.')
    expect(roomInviteText('Ana', 'K7Q2MX9A', { of: 'AAAAAAAA', opponent: 'Ben' })).toBe('Ben, rematch? Ana has a new TouchLine head-to-head room, same settings: K7Q2-MX9A, no account needed.')
    expect(roomInviteText(null, 'K7Q2MX9A', { of: 'AAAAAAAA', opponent: null })).toBe('Rematch? I have a new TouchLine head-to-head room, same settings: K7Q2-MX9A, no account needed.')
  })
})
