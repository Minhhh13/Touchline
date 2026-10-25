import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, canSpin, isComplete, respin, spin } from '@engine/draft'
import { previousArenaDailySeed, previousWeeklySeed, Rng } from '@engine/rng'
import { ACHIEVEMENTS, arenaShareText } from '@engine/awards'
import { createGame } from '../logic/setup'
import { arenaShareInput, beginArena, rungOpponent, simArenaToEnd } from '../logic/arena'
import { arenaAgainSettings, dailyArenaGameSettings, dailyArenaResult, dailyArenaSettings } from '../logic/arenaDaily'
import { weeklyGameSettings, weeklyNation, weeklyPlan, weeklySettings, weeklyTheme, WEEKLY_LEAGUE_COUNT } from '../logic/weekly'
import { WEEKLY_EPOCHS, WEEKLY_THEMES, type WeeklyThemeId } from '../logic/weeklyThemes'
import { fileStreakResult } from '../logic/streaks'
import { modeLabel, shareCardFooter } from '../logic/modes'
import type { Game, GameSettings } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { slotOf, useStore } from '../store'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const england = loadTestUniverse()

/** An arena game on its hub after a draft: the assistant's, or (`other`) one that re-spins the first spin first, so the squad differs. */
function arenaGame(settings: GameSettings, other = false): Game {
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  if (other) {
    spin(england, g.draft!, rng)
    respin(england, g.draft!, rng)
    g.draft!.history.push({ ...g.draft!.current!, pickedId: null, slotId: null, skipped: true })
    g.draft!.current = null
    g.draft!.twist = null
  }
  autoDraft(england, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, england)
  return g
}

const picks = (g: Game) => [...Object.values(g.lineup), ...g.bench].sort()

describe('Daily Arena', () => {
  it('pins the day to its puzzle: the Cup of 16 on odd dates, the Gauntlet on even ones, an England wheel', () => {
    expect(dailyArenaSettings('arena-2026-10-25')).toEqual({ seed: 'arena-2026-10-25', format: 'cup', size: 16, field: 'wheel', leagueId: 'england', wheelLeagues: ['england'], formationId: '4-3-3', difficulty: 'calibrated', twists: true })
    expect(dailyArenaSettings('arena-2026-10-26')).toEqual({ seed: 'arena-2026-10-26', format: 'gauntlet', leagueId: 'england', wheelLeagues: ['england'], formationId: '4-2-3-1', difficulty: 'calibrated', twists: true })
    expect(dailyArenaSettings('arena-2027-01-01')).toEqual({ seed: 'arena-2027-01-01', format: 'cup', size: 16, field: 'wheel', leagueId: 'england', wheelLeagues: ['england'], formationId: '4-2-3-1', difficulty: 'calibrated', twists: true })
    // A month's days carry both formats
    const formats = new Set(Array.from({ length: 30 }, (_, i) => dailyArenaSettings(`arena-2026-11-${String(i + 1).padStart(2, '0')}`).format))
    expect([...formats].sort()).toEqual(['cup', 'gauntlet'])
  })

  it('builds startable settings: an arena game marked daily, fourteen picks on a Gauntlet day and sixteen on a Cup day, no cap, no filter', () => {
    const cup = dailyArenaGameSettings(england, 'arena-2026-10-25', 'Arena Day XI')
    const gauntlet = dailyArenaGameSettings(england, 'arena-2026-10-26')
    expect(cup).toMatchObject({ mode: 'arena', seed: 'arena-2026-10-25', teamName: 'Arena Day XI', formationId: '4-3-3', wheelLeagues: ['england'], difficulty: 'calibrated', arena: { format: 'cup', size: 16, field: 'wheel', daily: true } })
    expect(gauntlet).toMatchObject({ mode: 'arena', formationId: '4-2-3-1', arena: { format: 'gauntlet', daily: true } })
    expect(cup.rules.squadSize).toBe(16)
    expect(gauntlet.rules.squadSize).toBe(14)
    for (const s of [cup, gauntlet]) {
      expect(s.rules).toMatchObject({ twists: true, hardMode: false, leagues: ['england'] })
      for (const k of ['budget', 'chain', 'onlyClub', 'onlyNation', 'fromSeason', 'toSeason'] as const) expect(s.rules[k], k).toBeUndefined()
    }
    // Played again on a new seed it is an ordinary run, off the streak
    expect(arenaAgainSettings(gauntlet, 'K7Q2-MX9A').arena?.daily).toBeUndefined()
    expect(arenaAgainSettings(gauntlet, 'K7Q2-MX9A').seed).toBe('K7Q2-MX9A')
  })

  it('on a Gauntlet day two different drafts climb the same ladder: the same opponents at rungs 1 to 3', () => {
    const s = dailyArenaGameSettings(england, 'arena-2026-10-26')
    const a = arenaGame(s)
    const b = arenaGame(s, true)
    expect(picks(a)).not.toEqual(picks(b))
    for (const rung of [1, 2, 3]) expect(rungOpponent(b.arena!, rung), `rung ${rung}`).toBe(rungOpponent(a.arena!, rung))
    expect(b.arena!.next).toBe(a.arena!.next)
    simArenaToEnd(a, england)
    simArenaToEnd(b, england)
    const both = Math.min(a.arena!.log.length, b.arena!.log.length, 3)
    for (let i = 0; i < both; i++) expect(b.arena!.log[i].opponent).toBe(a.arena!.log[i].opponent)
  }, 30000)

  it('on a Cup day two different drafts get the same first-round opponent and the same round-one draw', () => {
    const s = dailyArenaGameSettings(england, 'arena-2026-10-25')
    const a = arenaGame(s)
    const b = arenaGame(s, true)
    expect(picks(a)).not.toEqual(picks(b))
    expect(a.arena!.next).toBeTruthy()
    expect(b.arena!.next).toBe(a.arena!.next)
    expect(b.arena!.bracket!.rounds[0]).toEqual(a.arena!.bracket!.rounds[0])
  }, 30000)

  it('names the day in the labels and the share text, with no seed line', () => {
    const g = arenaGame(dailyArenaGameSettings(england, 'arena-2026-10-26'))
    expect(modeLabel(g, 'short')).toBe('Daily Arena · The Gauntlet')
    expect(modeLabel(g, 'share')).toBe('Daily Arena 2026-10-26 · The Gauntlet')
    expect(shareCardFooter(g)).toBe('Daily Arena 2026-10-26')
    simArenaToEnd(g, england)
    const text = arenaShareText(arenaShareInput(g, england)!).split('\n')
    expect(text[0]).toBe('TouchLine · Daily Arena 2026-10-26 · The Gauntlet')
    expect(text.some((l) => l.startsWith('Seed '))).toBe(false)
    const r = dailyArenaResult(g.arena!)
    expect(r.format).toBe('gauntlet')
    expect(r.label).toMatch(/^(\d+ rungs?|Gauntlet complete)$/)
  }, 30000)
})

describe('Weekly Challenge', () => {
  const all = loadTestUniverse(ALL)

  it('pins three weeks to their puzzles, across the 53-week year end', () => {
    expect(weeklySettings(all, 'weekly-2026-W43')).toEqual({ seed: 'weekly-2026-W43', week: '2026-W43', leagueId: 'england', wheelLeagues: ['england'], theme: 'teammate-chain', formationId: '3-5-2', season: 2019, host: 'liverpool', difficulty: 'calibrated', rules: { chain: true } })
    expect(weeklySettings(all, 'weekly-2026-W53')).toEqual({ seed: 'weekly-2026-W53', week: '2026-W53', leagueId: 'germany', wheelLeagues: ALL, theme: 'european-nights', formationId: '3-5-2', season: 2017, host: 'hoffenheim', difficulty: 'calibrated', rules: {} })
    expect(weeklySettings(all, 'weekly-2027-W01')).toEqual({ seed: 'weekly-2027-W01', week: '2027-W01', leagueId: 'italy', wheelLeagues: ['italy'], theme: 'early', formationId: '4-4-2', season: 2011, host: 'catania', difficulty: 'calibrated', rules: { fromSeason: 2008, toSeason: 2013 } })
  })

  it('rotates one theme a week through the epoch, so nine weeks running carry every theme once', () => {
    const themes = Array.from({ length: 9 }, (_, i) => weeklyTheme(`weekly-2026-W${43 + i}`))
    expect([...themes].sort()).toEqual((Object.keys(WEEKLY_THEMES) as WeeklyThemeId[]).sort())
    expect(themes).toEqual([...WEEKLY_EPOCHS[0].themes])
    // The order starts again after nine weeks: 2027-W01 is the epoch's twelfth week (2026 has 53)
    expect(weeklyTheme('weekly-2027-W01')).toBe(WEEKLY_EPOCHS[0].themes[11 % 9])
  })

  it('every theme yields startable settings: the wheel spins after createGame and the assistant completes the draft', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 9; i++) {
      const seed = `weekly-2026-W${43 + i}`
      const s = weeklyGameSettings(all, seed, 'Week XI')!
      expect(s, seed).not.toBeNull()
      expect(s.mode).toBe('weekly')
      expect(s.weekly?.theme).toBe(weeklyTheme(seed))
      seen.add(s.weekly!.theme)
      const g = createGame(s)
      expect(canSpin(all, g.draft!), seed).toBe(true)
      const rng = Rng.fromState(g.rngState)
      autoDraft(all, g.draft!, rng)
      expect(isComplete(g.draft!), seed).toBe(true)
      // The theme holds in the drafted XI: the era, the nation, the cap
      const drafted = Object.values(g.draft!.lineup).map((id) => all.index[id])
      if (s.rules.fromSeason !== undefined) expect(drafted.every((p) => p.season >= s.rules.fromSeason! && p.season <= (s.rules.toSeason ?? 9999)), seed).toBe(true)
      if (s.rules.onlyNation) expect(drafted.every((p) => p.nationality === s.rules.onlyNation), seed).toBe(true)
      if (s.rules.budget !== undefined) expect(g.draft!.spent!, seed).toBeLessThanOrEqual(s.rules.budget)
    }
    expect(seen.size).toBe(9)
  }, 60000)

  it('parks the bus in a 5-3-2 on Realistic, and picks one nation other than the league country’s own', () => {
    const bus = weeklySettings(all, 'weekly-2026-W50')!
    expect(bus.theme).toBe('park-the-bus')
    expect(bus.formationId).toBe('5-3-2')
    expect(bus.difficulty).toBe('realistic')
    for (const leagueId of ALL) {
      const nation = weeklyNation(all, leagueId, '4-3-3')
      const country = all.available.find((l) => l.id === leagueId)!.country
      expect(nation, leagueId).toBeTruthy()
      expect(all.nations[nation!]?.name, leagueId).not.toBe(country)
    }
  })

  it('needs the week’s packs: no settings until they load, while the plan names the league from the index alone', () => {
    expect(weeklyPlan(england, 'weekly-2026-W44').leagueId).toBe('spain')
    expect(weeklySettings(england, 'weekly-2026-W44')).toBeNull()
    expect(weeklyGameSettings(england, 'weekly-2026-W44')).toBeNull()
    // A European Nights week needs all seven
    expect(weeklySettings(loadTestUniverse(['germany']), 'weekly-2026-W53')).toBeNull()
    expect(weeklySettings(england, 'weekly-2026-W43')).not.toBeNull()
  })

  it('never moves a week when a league is appended to the index', () => {
    const extra = { ...all.available[0], id: 'scotland', name: 'Premiership', country: 'Scotland' }
    expect(WEEKLY_LEAGUE_COUNT).toBe(7)
    for (let w = 43; w <= 53; w++) expect(weeklyPlan({ available: [...all.available, extra] }, `weekly-2026-W${w}`)).toEqual(weeklyPlan(all, `weekly-2026-W${w}`))
  })

  it('labels the week with its theme and prints no seed on the card footer', () => {
    const s = weeklyGameSettings(all, 'weekly-2026-W46')!
    const g = createGame(s)
    expect(modeLabel(g, 'short')).toBe('Weekly · Moneyball')
    expect(modeLabel(g, 'share')).toBe('Weekly 2026-W46 · Moneyball')
    expect(shareCardFooter(g)).toBe('Weekly challenge 2026-W46 · £180M cap')
    expect(slotOf(g)).toBe('quick')
  })
})

describe('Today and this week: the streak books', () => {
  it('count consecutive days and weeks, reset after a gap and file one result per day or week', () => {
    let days = fileStreakResult<number>(undefined, 'arena-2026-12-30', 1, previousArenaDailySeed, 'arena-2027-01-05', 'arena-2027-01-04')
    for (const [seed, n] of [['arena-2026-12-31', 2], ['arena-2027-01-01', 3]] as const) days = fileStreakResult(days.book, seed, n, previousArenaDailySeed, 'arena-2027-01-05', 'arena-2027-01-04')
    expect(days.book.streak).toBe(3)
    expect(days.book.last).toBe('arena-2027-01-01')
    // A second run on the same day changes nothing
    const again = fileStreakResult(days.book, 'arena-2027-01-01', 9, previousArenaDailySeed, 'arena-2027-01-05', 'arena-2027-01-04')
    expect(again.filed).toBe(false)
    expect(again.book).toBe(days.book)
    // A missed day starts again at one
    expect(fileStreakResult(days.book, 'arena-2027-01-03', 4, previousArenaDailySeed, 'arena-2027-01-05', 'arena-2027-01-04').book).toMatchObject({ streak: 1, last: 'arena-2027-01-03' })
    let weeks = fileStreakResult<number>(undefined, 'weekly-2026-W52', 1, previousWeeklySeed, 'weekly-2027-W03', 'weekly-2027-W02')
    for (const seed of ['weekly-2026-W53', 'weekly-2027-W01']) weeks = fileStreakResult(weeks.book, seed, 2, previousWeeklySeed, 'weekly-2027-W03', 'weekly-2027-W02')
    expect(weeks.book).toMatchObject({ streak: 3, last: 'weekly-2027-W01' })
    expect(Object.keys(weeks.book.results)).toEqual(['weekly-2026-W52', 'weekly-2026-W53', 'weekly-2027-W01'])
    expect(fileStreakResult(weeks.book, 'weekly-2027-W03', 3, previousWeeklySeed, 'weekly-2027-W03', 'weekly-2027-W02').book.streak).toBe(1)
  })

  it('a Daily Arena run files Best runs and its own book, never a leaderboard row or the Daily; the seventh day running earns Arena Regular', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'arena-regular')).toBe(true)
    useStore.setState({ universe: england, loadedLeagues: ['england'], game: null, parked: {} })
    const seed = 'arena-2026-10-26'
    useStore.setState({ profile: { ...useStore.getState().profile, arenaDaily: { streak: 6, last: previousArenaDailySeed(seed), results: {} } } })
    const before = useStore.getState().profile
    const s = useStore.getState()
    s.startGame(dailyArenaGameSettings(england, seed, 'Streak XI'))
    expect(slotOf(useStore.getState().game!)).toBe('arena')
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    useStore.getState().simArenaToEnd()
    const g = useStore.getState().game!
    expect(g.phase).toBe('summary')
    const p = useStore.getState().profile
    expect(p.leaderboard).toHaveLength(before.leaderboard.length)
    expect(p.dailyResults).toEqual(before.dailyResults)
    expect(p.dailyStreak).toBe(before.dailyStreak)
    expect(p.arenaRuns).toHaveLength((before.arenaRuns?.length ?? 0) + 1)
    expect(p.arenaDaily!.streak).toBe(7)
    expect(p.arenaDaily!.results[seed]).toEqual(dailyArenaResult(g.arena!))
    expect(p.cabinet!.arenaDailies).toBe((before.cabinet?.arenaDailies ?? 0) + 1)
    expect(p.achievements['arena-regular']).toBeTruthy()
    // The same day again: another Best run, but the day's book and the cabinet's day count stand
    useStore.getState().startGame(dailyArenaGameSettings(england, seed, 'Again XI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    useStore.getState().simArenaToEnd()
    const p2 = useStore.getState().profile
    expect(p2.arenaRuns).toHaveLength((before.arenaRuns?.length ?? 0) + 2)
    expect(p2.arenaDaily).toEqual(p.arenaDaily)
    expect(p2.cabinet!.arenaDailies).toBe(p.cabinet!.arenaDailies)
  }, 60000)

  it('a weekly result writes its leaderboard row and its own book, never the Daily’s; the fourth week running earns Month of Sundays', async () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'weekly-streak-4')).toBe(true)
    useStore.setState({ universe: england, loadedLeagues: ['england'], game: null, parked: {} })
    const seed = 'weekly-2026-W43'
    useStore.setState({ profile: { ...useStore.getState().profile, weekly: { streak: 3, last: previousWeeklySeed(seed), results: {} } } })
    const before = useStore.getState().profile
    expect(await useStore.getState().startWeekly(seed, 'Week XI')).toBe(true)
    const started = useStore.getState().game!
    expect(started.settings.mode).toBe('weekly')
    expect(started.settings.rules.chain).toBe(true)
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    const g = useStore.getState().game!
    expect(g.phase).toBe('summary')
    const p = useStore.getState().profile
    expect(p.leaderboard.length).toBe(Math.min(50, before.leaderboard.length + 1))
    expect(p.leaderboard.some((e) => e.mode === 'weekly' && e.seed === seed)).toBe(true)
    expect(p.dailyResults).toEqual(before.dailyResults)
    expect(p.dailyStreak).toBe(before.dailyStreak)
    expect(p.weekly!.streak).toBe(4)
    expect(p.weekly!.results[seed]).toEqual({ points: g.quickResult!.points, tier: g.quickResult!.tier })
    expect(p.cabinet!.weeklies).toBe((before.cabinet?.weeklies ?? 0) + 1)
    expect(p.cabinet!.byMode.weekly).toBe((before.cabinet?.byMode.weekly ?? 0) + 1)
    expect(p.achievements['weekly-streak-4']).toBeTruthy()
  }, 60000)
})
