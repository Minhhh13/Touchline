import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { dailySeed, Rng } from '@engine/rng'
import { autoDraft, isComplete } from '@engine/draft'
import { historyKey } from '@engine/challenge'
import type { LoadedUniverse } from '@engine/universe'
import { createGame, DAILY_EPOCHS, DAILY_FORMATIONS, DAILY_RULES, DAILY_SEASON, dailyGameSettings, dailyLeagueOf, dailyLoaded, dailyPlan, dailySettings, type DailySettings } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { settingsHash } from '../../online/server/dailyVerify'
import type { GameSettings } from '../types'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const all = loadTestUniverse(ALL)
const england = loadTestUniverse(['england'])
const DAY = 86400000
const START = Date.UTC(2026, 9, 30)

const seedAt = (t: number) => dailySeed(new Date(t))

/** The Daily mapping exactly as it was before the rotation (55831d7), written out so this test never follows a later change. */
function beforeRotation(u: LoadedUniverse, seed: string): DailySettings {
  const n = Number(seed.split('-').slice(1).join('')) || 0
  const complete = u.clubSeasons.filter((cs) => cs.complete && cs.leagueId === 'england' && !cs.classic)
  const seasons = [...new Set(complete.map((cs) => cs.season))].sort()
  const season = seasons[n % seasons.length]
  const clubs = complete.filter((cs) => cs.season === season).map((cs) => cs.clubId).sort()
  const host = clubs[(n * 7) % clubs.length]
  return { season, host, formationId: DAILY_FORMATIONS[(n * 3) % DAILY_FORMATIONS.length], leagueId: 'england', wheelLeagues: ['england'], difficulty: 'calibrated', rules: { ...DAILY_RULES, leagues: ['england'] }, seed, january: DAILY_SEASON.january, continental: DAILY_SEASON.continental }
}

/** An assistant's Daily: Auto-complete from the first spin, then the season. */
function played(u: LoadedUniverse, s: GameSettings) {
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

describe('the Daily before the rotation is untouched', { timeout: 120_000 }, () => {
  it('maps every date before 2026-10-30, and any seed that names no date, byte for byte as before', () => {
    const seeds = ['daily-', 'daily-x', 'quick-1', 'daily-2026-02-30']
    for (let t = Date.UTC(2024, 0, 1); t < START; t += DAY) seeds.push(seedAt(t))
    expect(seeds.at(-1)).toBe('daily-2026-10-29')
    for (const seed of seeds) {
      for (const u of [england, all]) {
        expect(JSON.stringify(dailySettings(u, seed)), seed).toBe(JSON.stringify(beforeRotation(u, seed)))
        expect(dailyLeagueOf(seed)).toBe('england')
      }
    }
    // The settings hash a ranked pin stores, as engine 7 shipped it (cd83e24, before the rotation): unchanged before the
    // rotation, and on its Premier League days (2026-10-30, 2026-11-06), whose puzzles are the original mapping's
    const shipped: Record<string, string> = { '2026-10-25': 'fa675o90yg', '2026-10-28': 'yp4v8pdkqv', '2026-10-29': '12fnfpl1u41', '2026-10-30': '13cylefa39', '2026-11-06': '1tz3j801ohd' }
    for (const [date, hash] of Object.entries(shipped)) {
      expect(settingsHash(dailyGameSettings(england, `daily-${date}`)), date).toBe(hash)
      expect(settingsHash(dailyGameSettings(all, `daily-${date}`)), date).toBe(hash)
    }
    expect(dailyGameSettings(england, 'daily-2026-10-25').rules).toEqual(DAILY_RULES)
  })

  it('keeps the first epoch as the original Premier League Daily, and the rotation as dated and literal', () => {
    expect(DAILY_EPOCHS[0]).toEqual({ from: null, leagues: ['england'] })
    expect(DAILY_EPOCHS[1]).toEqual({ from: 'daily-2026-10-30', leagues: ALL })
    // Literal, never the data index's order: a league added later must open a new epoch
    expect(all.available.slice(0, 7).map((l) => l.id)).toEqual(ALL)
  })
})

describe('the Daily rotation from 2026-10-30', { timeout: 600_000 }, () => {
  it('cycles through the seven leagues one a day, the Premier League first', () => {
    const fortnight = Array.from({ length: 14 }, (_, i) => `${seedAt(START + i * DAY).slice(6)} ${dailyLeagueOf(seedAt(START + i * DAY))}`)
    expect(fortnight).toEqual([
      '2026-10-30 england',
      '2026-10-31 spain',
      '2026-11-01 italy',
      '2026-11-02 germany',
      '2026-11-03 france',
      '2026-11-04 netherlands',
      '2026-11-05 portugal',
      '2026-11-06 england',
      '2026-11-07 spain',
      '2026-11-08 italy',
      '2026-11-09 germany',
      '2026-11-10 france',
      '2026-11-11 netherlands',
      '2026-11-12 portugal',
    ])
    expect(dailyLeagueOf('daily-2026-10-29')).toBe('england')
    // Across a leap day and years on: still one a day, in order
    expect(dailyLeagueOf('daily-2028-02-29')).toBe(ALL[Math.round((Date.UTC(2028, 1, 29) - START) / DAY) % 7])
    expect(dailyPlan('daily-2026-10-31')).toEqual({ seed: 'daily-2026-10-31', leagueId: 'spain', wheelLeagues: ['spain'], formationId: DAILY_FORMATIONS[(20261031 * 3) % 5] })
  })

  it('pins the puzzle of future dates', () => {
    const pins: Record<string, string> = {}
    for (const seed of ['daily-2026-10-30', 'daily-2026-10-31', 'daily-2026-11-01', 'daily-2026-11-02', 'daily-2026-11-03', 'daily-2026-11-04', 'daily-2026-11-05', 'daily-2027-01-01', 'daily-2027-06-15']) {
      const d = dailySettings(all, seed)
      pins[seed] = `${d.leagueId} ${d.season} ${d.host} ${d.formationId}`
    }
    expect(pins).toEqual(PINS)
  })

  it('is the original mapping on a Premier League day, and the same mapping on every league', () => {
    for (let i = 0; i < 365; i++) {
      const seed = seedAt(START + i * DAY)
      const d = dailySettings(all, seed)
      const league = dailyLeagueOf(seed)
      if (league === 'england') expect(JSON.stringify(d)).toBe(JSON.stringify(beforeRotation(all, seed)))
      expect(d.leagueId).toBe(league)
      expect(d.wheelLeagues).toEqual([league])
      expect(d.rules).toEqual({ ...DAILY_RULES, leagues: [league] })
      // A complete, standard season of the day's league, the host one of its clubs
      const host = all.clubSeasonByKey[`${d.host}@${d.season}`]
      expect(host?.leagueId, seed).toBe(league)
      expect(host.complete && !host.classic).toBe(true)
    }
  })

  it('depends on nothing but the day and its league pack: the other leagues loaded change nothing', () => {
    const runs: Record<string, string> = {}
    for (let i = 0; i < 7; i++) {
      const seed = seedAt(START + i * DAY)
      const league = dailyLeagueOf(seed)
      const own = loadTestUniverse([league])
      const withEngland = loadTestUniverse([...new Set(['england', league])])
      const ref = JSON.stringify(dailySettings(own, seed))
      expect(JSON.stringify(dailySettings(withEngland, seed))).toBe(ref)
      expect(JSON.stringify(dailySettings(all, seed))).toBe(ref)
      expect(dailyLoaded([league], seed)).toBe(true)
      expect(dailyLoaded(league === 'england' ? [] : ['england'], seed)).toBe(false)
      if (league === 'england') continue
      expect(() => dailySettings(england, seed)).toThrow(new RegExp(`needs the ${league} pack`))
      // The same assistant's Daily on the server's universe (the day's league alone) and on a browser's (England too, or all seven)
      const a = played(own, dailyGameSettings(own, seed))
      const b = played(withEngland, dailyGameSettings(withEngland, seed))
      const c = played(all, dailyGameSettings(all, seed))
      expect(historyKey(b.draft!.history)).toBe(historyKey(a.draft!.history))
      runs[seed] = `${historyKey(a.draft!.history)} ${a.quickResult!.points}`
      expect(JSON.stringify([b.quickResult, b.rngState, b.draft!.lineup])).toBe(JSON.stringify([a.quickResult, a.rngState, a.draft!.lineup]))
      expect(JSON.stringify([c.quickResult, c.rngState, c.draft!.lineup])).toBe(JSON.stringify([a.quickResult, a.rngState, a.draft!.lineup]))
      // A full season of the day's league: every club met twice
      const clubs = all.clubSeasons.filter((cs) => cs.leagueId === league && cs.season === a.settings.leagueSeason).length
      expect(a.quickResult!.results).toHaveLength(2 * (clubs - 1))
    }
    // The assistant's spins and points on the six rotated days of the first week (engine 7): re-baseline only with an engine bump or a data rebuild
    expect(runs).toEqual(RUNS)
  })

  it('never runs the wheel dry across a year of rotated days, and never lands on a classic season', () => {
    const leagues: Record<string, number> = {}
    for (let i = 0; i < 365; i++) {
      const seed = seedAt(START + i * DAY)
      const s = dailyGameSettings(all, seed)
      const g = createGame(s)
      const rng = Rng.fromState(g.rngState)
      autoDraft(all, g.draft!, rng)
      expect(isComplete(g.draft!), seed).toBe(true)
      for (const h of g.draft!.history) {
        const cs = all.clubSeasonByKey[`${h.clubId}@${h.season}`]
        expect(cs.leagueId, seed).toBe(s.leagueId)
        expect(cs.classic, seed).toBeFalsy()
      }
      leagues[s.leagueId] = (leagues[s.leagueId] ?? 0) + 1
    }
    // 365 days: one league a day, so 53 for the first and 52 for the others
    expect(leagues).toEqual({ england: 53, spain: 52, italy: 52, germany: 52, france: 52, netherlands: 52, portugal: 52 })
  })
})

/** The puzzles of the first rotated week and two later dates (league, season, host, shape), on the data of 2026-10-25. */
const PINS: Record<string, string> = {
  'daily-2026-10-30': 'england 2022 leicester-city 4-3-3',
  'daily-2026-10-31': 'spain 2023 sevilla 3-5-2',
  'daily-2026-11-01': 'italy 2021 inter 3-5-2',
  'daily-2026-11-02': 'germany 2022 koln 4-4-2',
  'daily-2026-11-03': 'france 2023 rennes 4-4-2-diamond',
  'daily-2026-11-04': 'netherlands 2024 fc-twente 4-2-3-1',
  'daily-2026-11-05': 'portugal 2025 nacional 4-3-3',
  'daily-2027-01-01': 'england 2021 everton 3-5-2',
  'daily-2027-06-15': 'france 2013 lille 4-3-3',
}

/** `historyKey` of the assistant's draft and the season's points on the first week's rotated days (engine 7, data of 2026-10-25). */
const RUNS: Record<string, string> = {
  'daily-2026-10-31': '6i3cd7yo1x 66',
  'daily-2026-11-01': '10kll9blg5n 58',
  'daily-2026-11-02': '1aaqs48lwxm 72',
  'daily-2026-11-03': 'z71xup9boy 51',
  'daily-2026-11-04': 'j3ldly76tb 51',
  'daily-2026-11-05': '1ibo7ns84kz 36',
}
