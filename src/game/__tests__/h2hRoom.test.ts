import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { h2hComplete, type H2HDraft } from '@engine/h2h'
import type { H2HManager } from '@game/logic/h2h'
import { autoChoice, playHotSeat, playRoom } from './roomHelpers'
import { HIDDEN_CHARS } from '../../online/server/dailyVerify'
import { cleanSettings, draftFromEvents, isRoomLog, replayRoom, roomClubs, roomManager, roomName, roomPick, roomSeasons, roomShortName, roomStart, roomWheel, RoomMoveError, RoomReplayError, settingsProblem, type RoomEvent, type RoomSettings } from '@game/logic/h2hRoom'

const u = loadTestUniverse()
const SEASON = Math.max(...roomSeasons(u, 'england'))
const SETTINGS: RoomSettings = { leagueId: 'england', wheelLeagues: ['england'], leagueSeason: SEASON, difficulty: 'calibrated', hardMode: false }
const clubs = roomClubs(u, SETTINGS)
const MANAGERS: [H2HManager, H2HManager] = [
  { name: 'Ana', shortName: 'A', formationId: '4-3-3', hostClubId: clubs[3] },
  { name: 'Ben', shortName: 'B', formationId: '4-4-2', hostClubId: clubs[7] },
]

describe('an online room replays exactly like the hot-seat head-to-head', () => {
  it('gives the same squads and the same season as a hot-seat game on the same seed and picks', () => {
    for (const seed of ['room-AAAAAAAAAA', 'room-K7Q2MX9ABC', 'room-ZZ23456789']) {
      const room = playRoom(u, seed, SETTINGS, MANAGERS)
      const hot = playHotSeat(u, seed, SETTINGS, MANAGERS)
      const rebuilt = draftFromEvents(u, SETTINGS, MANAGERS, room.events)
      expect(h2hComplete(rebuilt)).toBe(true)
      expect(rebuilt.drafts.map((d) => d.lineup)).toEqual(hot.draft.drafts.map((d) => d.lineup))
      expect(room.result).toEqual(hot.result)
      // The result is plain JSON (it is stored as jsonb) and small
      expect(JSON.parse(JSON.stringify(room.result))).toEqual(room.result)
      expect(JSON.stringify(room.result).length).toBeLessThan(32000)
    }
  }, 120000)

  it('rebuilds the same draft from the public log (no seed) as the server does from the seed', () => {
    const seed = 'room-PUBLICLOG2'
    const room = playRoom(u, seed, SETTINGS, MANAGERS)
    for (let n = 0; n <= room.events.length; n += 5) {
      const part = room.events.slice(0, n)
      // Cut at a spin that has picks after it the server would have made: only whole steps are ever stored, so check the prefix replays both ways
      let server: H2HDraft | null = null
      try {
        server = replayRoom(u, seed, SETTINGS, MANAGERS, part).draft
      } catch {
        server = null
      }
      if (server) expect(draftFromEvents(u, SETTINGS, MANAGERS, part)).toEqual(server)
    }
  }, 60000)

  it('does not depend on leagues loaded beyond the room\'s own', () => {
    const wide = loadTestUniverse(['england', 'spain'])
    const seed = 'room-WIDEUNIV23'
    const a = playRoom(u, seed, SETTINGS, MANAGERS)
    const b = playRoom(wide, seed, SETTINGS, MANAGERS)
    expect(b.events).toEqual(a.events)
    expect(b.result).toEqual(a.result)
  }, 120000)
})

describe('the server refuses what the engine refuses', () => {
  const seed = 'room-REFUSALS2'
  const start = roomStart(u, seed, SETTINGS, MANAGERS)
  const h = draftFromEvents(u, SETTINGS, MANAGERS, start.events)
  const c = autoChoice(u, h)

  it('takes a pick only from the seat whose turn it is', () => {
    expect(start.turn).toBe(h.picking)
    const other = (c.seat === 0 ? 1 : 0) as 0 | 1
    expect(() => roomPick(u, seed, SETTINGS, MANAGERS, start.events, other, c.p, c.k)).toThrow(RoomMoveError)
    expect(() => roomPick(u, seed, SETTINGS, MANAGERS, start.events, c.seat, c.p, c.k)).not.toThrow()
  })

  it('refuses a player not in the squad on the wheel, an unknown slot and a filled slot', () => {
    const elsewhere = u.clubSeasons.find((cs) => `${cs.clubId}@${cs.season}` !== (start.events[start.events.length - 1] as { cs: string }).cs)!.squad[0].id
    expect(() => roomPick(u, seed, SETTINGS, MANAGERS, start.events, c.seat, elsewhere, c.k)).toThrow(/not in the current squad/)
    expect(() => roomPick(u, seed, SETTINGS, MANAGERS, start.events, c.seat, c.p, 'nowhere')).toThrow(RoomMoveError)
  })

  it('catches a stored spin the seed does not give (a tampered log)', () => {
    const tampered: RoomEvent[] = [{ t: 's', cs: `${clubs[0]}@${SEASON}` }, ...start.events.slice(1)]
    if (tampered[0].t === 's' && start.events[0].t === 's' && tampered[0].cs === start.events[0].cs) tampered[0] = { t: 's', cs: `${clubs[1]}@${SEASON}` }
    expect(() => replayRoom(u, seed, SETTINGS, MANAGERS, tampered)).toThrow(RoomReplayError)
    expect(() => replayRoom(u, seed, SETTINGS, MANAGERS, tampered)).toThrow(/the seed lands on/)
  })

  it('checks the shape of a stored log', () => {
    expect(isRoomLog(start.events)).toBe(true)
    expect(isRoomLog([{ t: 'p', seat: 2, p: 'x', k: 'GK' }])).toBe(false)
    expect(isRoomLog([{ t: 'x' }])).toBe(false)
    expect(isRoomLog('nope')).toBe(false)
  })
})

describe('room settings and managers', () => {
  it('accepts the hot-seat setup\'s choices and nothing else', () => {
    expect(settingsProblem(u, SETTINGS)).toBeNull()
    expect(settingsProblem(u, { ...SETTINGS, wheelLeagues: roomWheel(u, 'england', 'all') })).toBeNull()
    expect(settingsProblem(u, { ...SETTINGS, leagueId: 'mars' })).toMatch(/league/)
    expect(settingsProblem(u, { ...SETTINGS, wheelLeagues: ['spain'] })).toMatch(/wheel/)
    expect(settingsProblem(u, { ...SETTINGS, leagueSeason: 1850 })).toMatch(/season/)
    expect(settingsProblem(u, { ...SETTINGS, difficulty: 'hard' as unknown as 'calibrated' })).toMatch(/Difficulty/)
    expect(cleanSettings({ ...SETTINGS, extra: 1 } as RoomSettings)).toEqual(SETTINGS)
  })

  it('checks names, shapes and clubs, and keeps the two seats apart', () => {
    const ok = roomManager(u, SETTINGS, { name: '  Ana   Lu ', formationId: '4-3-3', hostClubId: clubs[0] }, null)
    expect(ok).toEqual({ ok: true, manager: { name: 'Ana Lu', shortName: 'AL', formationId: '4-3-3', hostClubId: clubs[0] } })
    const first = ok.ok ? ok.manager : null
    expect(roomManager(u, SETTINGS, { name: 'ana lu', formationId: '4-4-2', hostClubId: clubs[1] }, first)).toMatchObject({ ok: false })
    expect(roomManager(u, SETTINGS, { name: 'Ben', formationId: '4-4-2', hostClubId: clubs[0] }, first)).toMatchObject({ ok: false })
    expect(roomManager(u, SETTINGS, { name: 'Ben', formationId: '9-9-9', hostClubId: clubs[1] }, first)).toMatchObject({ ok: false })
    expect(roomManager(u, SETTINGS, { name: 'Ben', formationId: '4-4-2', hostClubId: 'nowhere' }, first)).toMatchObject({ ok: false })
    expect(roomName('')).toBeNull()
    expect(roomName('x'.repeat(25))).toBeNull()
    expect(roomName('Ana​Lu')).toBeNull()
    expect(roomName('<b>')).toBeNull()
    expect(roomShortName('Touchline Eleven')).toBe('TE')
  })

  it('uses the boards\' own hidden-character rule', () => {
    for (let c = 0; c < 0x10000; c++) {
      const ch = String.fromCharCode(c)
      if (c >= 0xd800 && c < 0xe000) continue
      // White space collapses to one plain space; every other hidden character refuses the name
      if (HIDDEN_CHARS.test(ch) && !/\s/.test(ch)) expect(roomName(`A${ch}B`), `U+${c.toString(16)}`).toBeNull()
    }
  })
})
