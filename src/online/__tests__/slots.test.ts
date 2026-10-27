import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { h2hSpin, newH2HDraft } from '@engine/h2h'
import type { Game, GameSettings } from '@game/types'
import type { H2HGame } from '@game/store'
import { beginSeason, createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { compareProgress, deviceLabel, deviceSlotsLine, gameSlot, whereLabel, progressKey, saveMeta, slotContents, slotIdentity, type SlotValue } from '../core/slots'

const u = loadTestUniverse()

function drafted(settings: GameSettings): Game {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

function quickGame(): Game {
  const g = drafted(dailyGameSettings(u, 'daily-2026-10-25'))
  runQuickSeason(g, u)
  return g
}

function managedGame(mode: 'season' | 'dynasty', seed: string): Game {
  const g = drafted({ mode, seed, formationId: '4-4-2', teamName: 'Slot Town', shortName: 'ST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated' })
  beginSeason(g, u)
  return g
}

function hotSeat(spins: number): H2HGame {
  const rng = new Rng('slots-h2h')
  const draft = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, respins: 0, hardMode: false, leagues: ['england'], twists: false })
  for (let i = 0; i < spins; i++) {
    h2hSpin(u, draft, rng)
    draft.picking = null
    draft.current = null
  }
  return { managers: [{ name: 'Ana', shortName: 'ANA', formationId: '4-3-3', hostClubId: 'arsenal' }, { name: 'Ben', shortName: 'BEN', formationId: '4-4-2', hostClubId: 'chelsea' }], leagueId: 'england', wheelLeagues: ['england'], leagueSeason: 2020, difficulty: 'calibrated', seed: 'slots-h2h', rngState: rng.getState(), draft, result: null, hardMode: false }
}

describe('cloud-save slots', () => {
  const quick = quickGame()
  const season = managedGame('season', 'SLOT-SEAS')
  const dynasty = managedGame('dynasty', 'SLOT-DYNA')

  it('puts each game in its slot: Dailies and Quick Drafts share one, the active game wins, the hot-seat game is the fourth', () => {
    expect(gameSlot(quick)).toBe('quick')
    expect(gameSlot(season)).toBe('season')
    expect(gameSlot(dynasty)).toBe('dynasty')
    const c = slotContents({ game: season, parked: { dynasty, quick }, h2h: hotSeat(2) })
    expect(Object.keys(c).sort()).toEqual(['dynasty', 'h2h', 'quick', 'season'])
    expect(c.season).toMatchObject({ kind: 'game', active: true })
    expect(c.dynasty).toMatchObject({ kind: 'game', active: false })
    expect(slotContents({ game: null, parked: {}, h2h: null })).toEqual({})
  })

  it('identifies a game by its id and the hot-seat game by its seed, hosts and shapes', () => {
    const c = slotContents({ game: quick, parked: {}, h2h: hotSeat(1) })
    expect(slotIdentity(c.quick!)).toBe(quick.id)
    const id = slotIdentity(c.h2h!)
    expect(id).toMatch(/^h2h-[0-9a-z]+$/)
    // Further along, same game
    expect(slotIdentity(slotContents({ game: null, parked: {}, h2h: hotSeat(3) }).h2h!)).toBe(id)
    const other = hotSeat(1)
    other.managers[1] = { ...other.managers[1], hostClubId: 'everton' }
    expect(slotIdentity({ slot: 'h2h', kind: 'h2h', h2h: other })).not.toBe(id)
  })

  it('orders progress across phases, matchweeks, seasons and spins', () => {
    const v = (g: Game): SlotValue => ({ slot: gameSlot(g)!, kind: 'game', game: g, active: true })
    const fresh = createGame(season.settings)
    const midDraft = drafted(season.settings)
    const pre = season
    const week5 = structuredClone(season)
    week5.phase = 'week'
    week5.season!.matchweek = 5
    const week6 = structuredClone(week5)
    week6.season!.matchweek = 6
    const summary = structuredClone(week6)
    summary.phase = 'summary'
    const nextYear = structuredClone(fresh)
    nextYear.year = 2
    const order = [fresh, midDraft, pre, week5, week6, summary, nextYear].map((g) => progressKey(v(g)))
    for (let i = 1; i < order.length; i++) expect(compareProgress(order[i], order[i - 1])).toBeGreaterThan(0)
    expect(compareProgress(order[3], order[3])).toBe(0)
    expect(compareProgress([1, 2], [1, 2, 0])).toBe(0)
    const h = (n: number): SlotValue => ({ slot: 'h2h', kind: 'h2h', h2h: hotSeat(n) })
    expect(compareProgress(progressKey(h(3)), progressKey(h(1)))).toBeGreaterThan(0)
  })

  it('summarises a slot in well under 2 KB', () => {
    const ctx = { dataVersion: u.generatedAt, engineVersion: '4', appBuild: 'test', deviceLabel: 'Safari · iPhone' }
    const c = slotContents({ game: quick, parked: { season, dynasty }, h2h: hotSeat(2) })
    for (const value of Object.values(c)) {
      const meta = saveMeta(value!, ctx)
      expect(JSON.stringify(meta).length).toBeLessThan(2048)
      expect(meta.dataVersion).toBe(u.generatedAt)
    }
    const q = saveMeta(c.quick!, ctx)
    expect(q).toMatchObject({ mode: 'daily', teamName: 'Touchline XI', phase: 'summary', points: quick.quickResult!.points })
    expect(saveMeta(c.season!, ctx)).toMatchObject({ mode: 'season', phase: 'preseason', points: null })
    expect(saveMeta(c.h2h!, ctx)).toMatchObject({ mode: 'h2h', teamName: 'Ana v Ben', phase: 'draft' })
    const long = structuredClone(quick)
    long.settings = { ...long.settings, teamName: 'x'.repeat(500) }
    expect(saveMeta({ slot: 'quick', kind: 'game', game: long, active: true }, ctx).teamName).toHaveLength(28)
  })

  it('labels a device by browser family and system only', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari · iPhone')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')).toBe('Chrome · iPhone')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge · Windows')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox · Mac')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36')).toBe('Samsung Internet · Android')
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1')).toBe('Safari · iPad')
    expect(deviceLabel('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome · ChromeOS')
    expect(deviceLabel('curl/8.0')).toBe('Browser · device')
  })
})

describe('the Account screen\'s slot words', () => {
  it('names where a row\'s game stands, an arena run by its matches', () => {
    expect(whereLabel({ phase: 'draft', matchweek: 0 })).toBe('drafting')
    expect(whereLabel({ phase: 'week', matchweek: 12, mode: 'season' })).toBe('matchweek 12')
    expect(whereLabel({ phase: 'summary', matchweek: 38, mode: 'season' })).toBe('season complete')
    expect(whereLabel({ phase: 'summary', matchweek: 38, mode: 'runin' })).toBe('run-in complete')
    expect(whereLabel({ phase: 'week', matchweek: 0, mode: 'arena', arena: { format: 'cup', step: 1, over: false } })).toBe('1 match played')
    expect(whereLabel({ phase: 'week', matchweek: 0, mode: 'arena', arena: { format: 'gauntlet', step: 3, over: false } })).toBe('3 matches played')
    expect(whereLabel({ phase: 'week', matchweek: 0, mode: 'arena', arena: { format: 'cup', step: 3, over: true } })).toBe('run over')
  })

  it('lists the slots that hold a game on this device, in slot order', () => {
    expect(deviceSlotsLine({ game: null, parked: {}, h2h: null })).toBe('none on this device yet')
    const s = managedGame('season', 'words-1')
    const arena = { ...s, id: 'words-arena', settings: { ...s.settings, mode: 'arena' as const } }
    const runin = { ...s, id: 'words-runin', settings: { ...s.settings, mode: 'runin' as const } }
    expect(deviceSlotsLine({ game: s, parked: {}, h2h: null })).toBe('Season on this device')
    expect(deviceSlotsLine({ game: arena, parked: { runin, season: s }, h2h: null })).toBe('Season, Arena run and Run-in on this device')
  })
})
