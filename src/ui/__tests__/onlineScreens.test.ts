/**
 * Round 9, the online screens: the "Play with a friend" flow rendered at every step of a room the fakes play through
 * (made, shared, joined, drafted, finished, left), the World boards' empty and offline states, and the Account panel's
 * sign-in words held equal to the online layer's English. Never a real Supabase project: the server harness only.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { ENGINE_VERSION } from '@engine/version'
import type { H2HManager } from '@game/logic/h2h'
import { draftFromEvents, roomClubs, roomSeasons, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { autoChoice } from '@game/__tests__/roomHelpers'
import { RoomSession, roomCodeFrom, type RoomTransport, type RoomUi, type SeatRecord, type SeatStore } from '../../online/rooms'
import { AUTH_MODES, authCopy, NOTE_CREATED, NOTE_EXISTING } from '../../online/core/authCopy'
import { onlineStore } from '../../online/state'
import type { Guest } from '../../online/server/service'
import { fakeRoomView, makeHarness, VISITOR, VISITOR2 } from '../../online/__tests__/serverHarness'
import { RoomScreen } from '../online/Rooms'
import { BoardState, DailyPlay } from '../online/WorldBoard'
import { authModes, authNoteText, authText } from '../online/authText'
import { markupProblems, show } from './qaSsr'

const u = loadTestUniverse()
const LIVE = { engine: ENGINE_VERSION, data: u.generatedAt, builtAt: '2026-10-26T00:05:00Z' }
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'calibrated', hardMode: false }
const CLUBS = roomClubs(u, SETTINGS)
const ANA = { name: 'Ana', formationId: '4-3-3', hostClubId: CLUBS[2] }
const BEN = { name: 'Ben', formationId: '4-4-2', hostClubId: CLUBS[7] }

type H = ReturnType<typeof makeHarness>

function device(h: H, who: Guest, clock: { at: number } = { at: 0 }) {
  let seats: Record<string, SeatRecord> = {}
  const store: SeatStore = { get: () => structuredClone(seats), set: (all) => void (seats = structuredClone(all)) }
  const transport: RoomTransport = {
    invoke: async (body) => {
      const r = await h.server.handle(who, JSON.stringify(body))
      return { status: r.status, body: r.body }
    },
    rpc: async <R,>(fn: string, args: Record<string, unknown>): Promise<R> => {
      if (fn !== 'h2h_peek') throw new Error(fn)
      const row = h.rooms.get(String(args.p_code))
      if (!row) return null as R
      return fakeRoomView(row, h.clock.now.getTime()) as R
    },
  }
  const session = new RoomSession({
    transport,
    seats: store,
    report: () => undefined,
    now: () => h.clock.now.getTime() + clock.at,
    visible: () => true,
    setTimer: () => 0,
    clearTimer: () => undefined,
    onFinished: () => undefined,
    signedIn: () => false,
    engine: ENGINE_VERSION,
  })
  return { session }
}

/** Render the room screen as a device sees its room: the markup, with the QA checks' problems. */
function screenOf(ui: RoomUi | null): { html: string; problems: string[] } {
  onlineStore.setState({ room: ui })
  Object.assign(onlineStore.getInitialState(), onlineStore.getState())
  const html = renderToString(createElement(RoomScreen))
  return { html, problems: markupProblems(html) }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('a room code from what the player puts in the box', () => {
  it('reads a typed code in any case or spacing, and a pasted link or invite text', () => {
    expect(roomCodeFrom('K7Q2-MX9A')).toBe('K7Q2MX9A')
    expect(roomCodeFrom(' k7q2 mx9a ')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('https://touchline.quest/#h=K7Q2MX9A')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('touchline.quest/#h=k7q2mx9a')).toBe('K7Q2MX9A')
    expect(roomCodeFrom('Ana invites you to a TouchLine head-to-head. Room K7Q2-MX9A, no account needed. https://touchline.quest/#h=K7Q2MX9A')).toBe('K7Q2MX9A')
  })
  it('refuses what is not a code: too short, letters a code never uses, a link to something else', () => {
    for (const bad of ['', 'K7Q2', 'K7Q2-MX9', 'IIII-OOOO', 'https://touchline.quest/#s=K7Q2MX9A', 'https://touchline.quest/#h=K7Q2MX9AB']) expect(roomCodeFrom(bad), bad).toBeNull()
  })
})

describe('Play with a friend, screen by screen against the fakes', () => {
  show({ universe: u, loadedLeagues: ['england'], game: null, screen: 'room' })

  it('makes a room, shows its code with the link, Copy code and the clock; the friend sees the join step; the draft and the result render for both', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    expect(made.ok).toBe(true)
    const code = made.ok ? made.code : ''

    const waiting = screenOf(a.session.state)
    expect(waiting.problems).toEqual([])
    expect(waiting.html).toContain('data-testid="room-waiting"')
    expect(waiting.html).toContain(`${code.slice(0, 4)}-${code.slice(4)}`)
    expect(waiting.html).toContain('data-testid="room-copy-code"')
    expect(waiting.html).toContain(`#h=${code}`)
    expect(text(waiting.html)).toContain('Play with a friend')

    // The friend opens the link: no seat yet, so the join step, naming the host
    await b.session.open(code)
    const join = screenOf(b.session.state)
    expect(join.problems).toEqual([])
    expect(join.html).toContain('data-testid="room-join"')
    expect(text(join.html)).toContain("Join Ana's room")
    expect(await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)).toBe(true)

    // The draft, from both seats: one is on the clock, the other waits for them by name
    await a.session.poll()
    const first = a.session.state!.view!
    expect(first.status).toBe('drafting')
    const turns = [screenOf(a.session.state), screenOf(b.session.state)]
    for (const s of turns) {
      expect(s.problems).toEqual([])
      expect(s.html).toContain('data-testid="room-draft"')
      expect(s.html).toContain('data-testid="room-turn-clock"')
    }
    const [mover, waiter] = first.turn === 0 ? [turns[0], turns[1]] : [turns[1], turns[0]]
    expect(mover.html).toContain('data-turn="mine"')
    expect(text(waiter.html)).toContain(`Waiting for ${first.turn === 0 ? 'Ana' : 'Ben'}`)
    expect(text(mover.html)).toMatch(/Times out in \d+:\d\d/)

    // Draft to the end, then the result for both seats and a Rematch
    for (let guard = 0; guard < 80; guard++) {
      await a.session.poll()
      const view = a.session.state!.view as RoomView
      if (view.status !== 'drafting') break
      const who = view.turn === 0 ? a : b
      await who.session.poll()
      const mine = who.session.state!.view!
      const c = autoChoice(u, draftFromEvents(u, mine.settings, mine.managers as [H2HManager, H2HManager], mine.events))
      expect(await who.session.pick(c.p, c.k)).toBe(true)
    }
    await b.session.poll()
    for (const d of [a, b]) {
      expect(d.session.state?.view?.status).toBe('finished')
      const r = screenOf(d.session.state)
      expect(r.problems).toEqual([])
      expect(r.html).toContain('data-testid="room-result"')
      expect(text(r.html)).toContain('Rematch')
      // Each seat can also open the other's rematch from its code
      expect(r.html).toContain('data-testid="room-rematch-code"')
      expect(text(r.html)).toContain(`Did ${d === a ? 'Ben' : 'Ana'} make the rematch?`)
    }
    // Ben's rematch: the waiting room says who it is for
    const done = b.session.state!.view!
    const again = await b.session.rematch(done, 1, ENGINE_VERSION, u.generatedAt)
    expect(again.ok).toBe(true)
    const rematch = screenOf(b.session.state)
    expect(rematch.problems).toEqual([])
    expect(rematch.html).toContain('data-testid="room-rematch-for"')
    expect(text(rematch.html)).toContain('Rematch with Ana')
    expect(text(rematch.html)).toContain('send Ana this new link')
  }, 180000)

  it('a friend who leaves mid-draft: the other seat is told who left and offered the same room again', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    const b = device(h, VISITOR2)
    const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
    const code = made.ok ? made.code : ''
    await b.session.open(code)
    await b.session.join(BEN, ENGINE_VERSION, u.generatedAt)
    expect(await b.session.leave()).toBe(true)
    await a.session.poll()
    const ended = screenOf(a.session.state)
    expect(ended.problems).toEqual([])
    expect(ended.html).toContain('data-testid="room-ended"')
    expect(text(ended.html)).toContain('Ben left')
    expect(ended.html).toContain('data-testid="room-rematch"')
    expect(ended.html).toContain('data-testid="room-join-rematch"')
  }, 60000)

  it('a code nobody holds, and a dropped connection before the room was read, each say what to do next', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const a = device(h, VISITOR)
    await a.session.open('ZZZZZZZZ')
    const missing = screenOf(a.session.state)
    expect(missing.problems).toEqual([])
    expect(missing.html).toContain('data-testid="room-missing"')
    const offline = screenOf({ code: 'ZZZZZZZZ', view: null, seat: null, error: 'The connection dropped.', errorCode: 'network', busy: false, missing: false, syncedAt: null, failures: 2 })
    expect(offline.problems).toEqual([])
    expect(offline.html).toContain('data-testid="room-retry"')
  }, 60000)

  it('lists the rooms this device holds newest first', async () => {
    const h = makeHarness(new Date('2026-10-26T10:00:00Z'), LIVE)
    const clock = { at: 0 }
    const a = device(h, VISITOR, clock)
    const codes: string[] = []
    for (let i = 0; i < 3; i++) {
      clock.at = i * 60000
      const made = await a.session.create(SETTINGS, ANA, ENGINE_VERSION, u.generatedAt)
      if (made.ok) codes.push(made.code)
    }
    expect(codes).toHaveLength(3)
    expect(a.session.openSeats()).toEqual([...codes].reverse())
  }, 60000)
})

describe('the World boards: empty, offline and failed states', () => {
  const render = (props: Parameters<typeof BoardState>[0]) => renderToString(createElement(BoardState, props))
  it('an empty board says nobody has posted, and on a board still open how to be first', () => {
    const open = render({ rows: [], error: null, retry: () => undefined, empty: 'Nobody has posted here yet.', hint: 'Be the first.' })
    expect(open).toContain('data-testid="board-empty"')
    expect(open).toContain('data-testid="board-empty-hint"')
    const past = render({ rows: [], error: null, retry: () => undefined, empty: 'Nobody has posted here yet.' })
    expect(past).not.toContain('board-empty-hint')
    expect(markupProblems(open)).toEqual([])
  })
  it('offline is its own notice with Try again, never the skeleton', () => {
    const html = render({ rows: null, error: 'You are offline.', offline: true, retry: () => undefined, empty: '' })
    expect(html).toContain('data-testid="board-offline"')
    expect(html).toContain('data-testid="board-retry"')
    expect(html).not.toContain('board-loading')
    expect(text(html)).not.toContain('Could not load the board')
    const failed = render({ rows: null, error: 'The server did not answer.', retry: () => undefined, empty: '' })
    expect(failed).toContain('data-testid="board-error"')
    expect(text(failed)).toContain('Could not load the board')
  })
})

describe("the World board's rotated Daily card", () => {
  it('uses the pack-free plan until the day\'s league loads', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
    try {
      const england = loadTestUniverse(['england'])
      show({ universe: england, loadedLeagues: ['england'], game: null, screen: 'world' })
      onlineStore.setState({ pins: { ...onlineStore.getState().pins, day: '2026-10-31', daily: null } })
      Object.assign(onlineStore.getInitialState(), onlineStore.getState())
      const html = renderToString(createElement(DailyPlay))
      expect(markupProblems(html)).toEqual([])
      expect(html).toContain('data-testid="world-play-daily"')
      expect(text(html)).toContain("Today's fixed wheel")
      expect(text(html)).toContain('La Liga')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the Account panel speaks the online layer English through the catalogue', () => {
  it('mirrors authCopy for both options, the switch and the notes', () => {
    for (const mode of ['signin', 'create'] as const) expect(authText(mode)).toEqual(authCopy(mode))
    expect(authModes()).toEqual(AUTH_MODES)
    expect(authNoteText(NOTE_CREATED)).toBe(NOTE_CREATED)
    expect(authNoteText(NOTE_EXISTING)).toBe(NOTE_EXISTING)
  })
})
