import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { boardGroup, countsAsLeagueSeason, creditGame, creditH2H, creditH2HOnline, emptyCabinet, filterBoard, finishedRecord, leaguesWon, normaliseCabinet, rebuildCabinet, trophiesOf } from '../logic/cabinet'
import { BADGES, badgeProgress, badgeStates, badgeTier, topBadges } from '@engine/badges'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { h2hComplete } from '@engine/h2h'
import { emptyFeats } from '../logic/feats'
import type { Game, GameSettings, LeaderboardEntry, Mode, Profile, SeasonRecord } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse(['england'])

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Cabinet XI', shortName: 'CAB', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function quickGame(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

function entry(partial: Partial<LeaderboardEntry>): LeaderboardEntry {
  return { id: 'e', date: '2026-10-01', mode: 'quick', teamName: 'XI', points: 70, won: 20, drawn: 10, lost: 8, position: 4, tier: 'EUROPEAN', seed: 'S', leagueSeason: 2025, hostClubId: 'burnley', xi: [], ...partial }
}

function seasonRow(partial: Partial<SeasonRecord>): SeasonRecord {
  return { year: 1, leagueId: 'england', leagueSeason: 2025, teamName: 'Cabinet XI', hostClubId: 'everton', position: 5, points: 60, won: 17, drawn: 9, lost: 12, goalsFor: 50, goalsAgainst: 40, tier: 'EUROPEAN', cupWon: false, ...partial }
}

/** A finished Season-mode game built from one history row (creditGame reads only the result). */
function seasonGame(row: Partial<SeasonRecord>, mode: Mode = 'season'): Game {
  const g = quickGame('cab-season-shell', { mode })
  return { ...g, quickResult: null, history: [seasonRow(row)], settings: { ...g.settings, mode } }
}

describe('rebuildCabinet: a profile from before the Trophy Room', () => {
  it('copies the five trophy counts exactly and counts the rest from the leaderboard', () => {
    const profile: Pick<Profile, 'trophies' | 'leaderboard' | 'dailyResults'> = {
      trophies: { league: 7, cup: 3, continental: 1, doubles: 2, trebles: 1 },
      leaderboard: [
        entry({ id: 'a', position: 1, tier: 'PERFECT', points: 114, won: 38, drawn: 0, lost: 0, hostClubId: 'burnley' }),
        entry({ id: 'b', position: 1, tier: 'INVINCIBLE', points: 102, lost: 0, hostClubId: 'burnley', mode: 'daily' }),
        entry({ id: 'c', position: 1, tier: 'CHAMPIONS', points: 88, hostClubId: 'everton', mode: 'season', nation: 'Brazil' }),
        entry({ id: 'd', position: 2, tier: 'TITLE_RACE', points: 101, hostClubId: 'fulham', mode: 'dynasty' }),
        // A sacked season is filed RELEGATED whatever the table said: no title, no century
        entry({ id: 'e', position: 1, tier: 'RELEGATED', points: 100, hostClubId: 'wolves', mode: 'season', nation: 'France' }),
      ],
      dailyResults: { 'daily-2026-10-01': { points: 80, tier: 'CHAMPIONS' }, 'daily-2026-10-02': { points: 60, tier: 'MID_TABLE' } },
    }
    const c = rebuildCabinet(profile)
    expect(trophiesOf(c)).toEqual(profile.trophies)
    expect(c.hostsTitled).toEqual(['burnley', 'everton'])
    expect(c.nationsTitled).toEqual(['Brazil'])
    expect(c.perfect).toBe(1)
    expect(c.invincible).toBe(2)
    expect(c.centurions).toBe(3)
    expect(c.byMode).toEqual({ quick: 1, daily: 1, season: 2, dynasty: 1 })
    expect(c.dailies).toBe(2)
    expect(c.rebuilt).toBe(true)
    // Nothing on the arena's or the run-in's shelves yet
    expect(c.gauntlet).toEqual({ runs: 0, best: 0, complete: 0 })
    expect(c.cups.won).toBe(0)
    expect(c.runIns).toEqual({ played: 0, met: 0 })
    // An empty profile has nothing to rebuild, so no note
    // (only its r8 feats, empty: a rebuilt cabinet always carries them, `feats.ts`)
    expect(rebuildCabinet({ leaderboard: [], dailyResults: {} })).toEqual({ ...emptyCabinet(), feats: emptyFeats() })
  })
})

describe('creditGame', () => {
  it('credits a quick season exactly when it finishes first, over many seeds', () => {
    let champions = 0
    let others = 0
    for (let i = 0; i < 16; i++) {
      const g = quickGame(`cab-quick-${i}`)
      const r = g.quickResult!
      const c = creditGame(emptyCabinet(), g)
      const title = r.position === 1
      if (title) champions++
      else others++
      expect(c.league).toBe(title ? 1 : 0)
      expect(c.hostsTitled).toEqual(title ? ['burnley'] : [])
      expect(c.byMode).toEqual({ quick: 1 })
      expect(c.perfect).toBe(r.tier === 'PERFECT' ? 1 : 0)
      expect(c.centurions).toBe(r.points >= 100 ? 1 : 0)
      // A quick season has no cup
      expect(c.cup).toBe(0)
      expect(c.doubles).toBe(0)
    }
    // The seeds cover both outcomes, so the assertions above are not one-sided
    expect(champions).toBeGreaterThan(0)
    expect(others).toBeGreaterThan(0)
  }, 60_000)

  it('a one-nation champion files its nation once', () => {
    const g = quickGame('cab-nation')
    g.quickResult = { ...g.quickResult!, position: 1, tier: 'CHAMPIONS' }
    g.settings = { ...g.settings, rules: { ...g.settings.rules, onlyNation: 'Brazil' } }
    const once = creditGame(emptyCabinet(), g)
    const twice = creditGame(once, g)
    expect(once.nationsTitled).toEqual(['Brazil'])
    expect(twice.nationsTitled).toEqual(['Brazil'])
    expect(twice.hostsTitled).toEqual(['burnley'])
    expect(twice.league).toBe(2)
  }, 30_000)

  it('a cup-winning season counts the cup, a double and a treble only with the title', () => {
    const cup = creditGame(emptyCabinet(), seasonGame({ position: 3, tier: 'EUROPEAN', cupWon: true }))
    expect(trophiesOf(cup)).toEqual({ league: 0, cup: 1, continental: 0, doubles: 0, trebles: 0 })
    expect(cup.byMode).toEqual({ season: 1 })
    const treble = creditGame(cup, seasonGame({ position: 1, tier: 'CHAMPIONS', points: 101, cupWon: true, continentalWon: true, hostClubId: 'everton' }, 'dynasty'))
    expect(trophiesOf(treble)).toEqual({ league: 1, cup: 2, continental: 1, doubles: 1, trebles: 1 })
    expect(treble.centurions).toBe(1)
    // The history row's host, not the settings' (a dynasty can change clubs)
    expect(treble.hostsTitled).toEqual(['everton'])
    expect(treble.byMode).toEqual({ season: 1, dynasty: 1 })
  }, 30_000)

  it('a sacked season wins nothing in the league', () => {
    const c = creditGame(emptyCabinet(), seasonGame({ position: 1, tier: 'RELEGATED', points: 40 }))
    expect(c.league).toBe(0)
    expect(c.hostsTitled).toEqual([])
    expect(c.byMode).toEqual({ season: 1 })
  }, 30_000)

  it('a game with no result credits nothing; a new daily day counts once', () => {
    const g = quickGame('cab-daily', { mode: 'daily', seed: 'daily-2026-10-20' })
    expect(creditGame(emptyCabinet(), { ...g, quickResult: null, history: [] })).toEqual(emptyCabinet())
    expect(creditGame(emptyCabinet(), g, { newDaily: true }).dailies).toBe(1)
    expect(creditGame(emptyCabinet(), g).dailies).toBe(0)
    expect(finishedRecord(g)).toBe(g.quickResult)
  }, 30_000)

  it('every mode today is a full league season; the head-to-head counts its own shelf', () => {
    for (const m of ['quick', 'daily', 'season', 'dynasty'] as const) expect(countsAsLeagueSeason(m)).toBe(true)
    expect(creditH2H(creditH2H(emptyCabinet())).h2h.played).toBe(2)
    expect(creditH2H(emptyCabinet()).league).toBe(0)
  })

  it('online head-to-head rooms count on their own shelf, apart from the hot-seat and the trophies', () => {
    const c = creditH2HOnline(creditH2HOnline(creditH2HOnline(emptyCabinet(), true), false), true)
    expect(c.h2hOnline).toEqual({ played: 3, won: 2 })
    expect(c.h2h.played).toBe(0)
    expect(trophiesOf(c)).toEqual(trophiesOf(emptyCabinet()))
    expect(creditH2H(c).h2hOnline).toEqual({ played: 3, won: 2 })
    expect(creditH2HOnline(creditH2H(emptyCabinet()), false)).toMatchObject({ h2h: { played: 1 }, h2hOnline: { played: 1, won: 0 } })
    // A profile rebuilt from an older save starts the shelf at zero (rooms never reach the leaderboard)
    expect(rebuildCabinet({ trophies: { league: 2, cup: 0, continental: 0, doubles: 0, trebles: 0 }, leaderboard: [], dailyResults: {} }).h2hOnline).toEqual({ played: 0, won: 0 })
  })

  it('normaliseCabinet fills whatever an imported cabinet lacks', () => {
    const c = normaliseCabinet({ league: 4, gauntlet: { best: 3 } as never })
    expect(c.league).toBe(4)
    expect(c.gauntlet).toEqual({ runs: 0, best: 3, complete: 0 })
    expect(c.hostsTitled).toEqual([])
    expect(c.v).toBe(1)
  })
})

describe('badges', () => {
  it('tiers at 0, 1, 4, 5, 19 and 20 on a 1/5/20 badge', () => {
    const serial = BADGES.find((b) => b.id === 'serial-winner')!
    expect(serial.tiers).toEqual([1, 5, 20])
    expect([0, 1, 4, 5, 19, 20].map((v) => badgeTier(serial, v))).toEqual([null, 'bronze', 'bronze', 'silver', 'silver', 'gold'])
    expect([0, 1, 4, 5, 19, 20, 31].map((v) => badgeProgress(serial, v))).toEqual(['0 of 1 for bronze', '1 of 5 for silver', '4 of 5 for silver', '5 of 20 for gold', '19 of 20 for gold', 'Gold', 'Gold'])
  })

  it('twelve badges with ascending tiers, each reading its own counter', () => {
    expect(BADGES.length).toBe(12)
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(12)
    for (const b of BADGES) expect(b.tiers[0] < b.tiers[1] && b.tiers[1] < b.tiers[2]).toBe(true)
    const c = { ...emptyCabinet(), league: 5, cup: 2, cups: { runs: 4, won: 3, bySize: {} }, hostsTitled: ['a', 'b', 'c', 'd', 'e'], dailies: 30 }
    const v = Object.fromEntries(badgeStates(c, { leaguesWon: 2 }).map((s) => [s.badge.id, s.value]))
    expect(v['serial-winner']).toBe(5)
    expect(v['cup-collector']).toBe(5)
    expect(v['globetrotter']).toBe(2)
    expect(v['grounds-tour']).toBe(5)
    expect(v['regular']).toBe(30)
    expect(v['ironman']).toBe(0)
  })

  it('the manager card shows the highest tiers first, then the nearest to the next tier', () => {
    const c = { ...emptyCabinet(), league: 20, perfect: 1, dailies: 6, hostsTitled: ['a', 'b', 'c', 'd', 'e'] }
    const top = topBadges(badgeStates(c, { leaguesWon: 1 }))
    expect(top.length).toBe(6)
    expect(top[0].badge.id).toBe('serial-winner') // gold
    expect(top.slice(1, 3).map((s) => s.badge.id)).toEqual(['perfectionist', 'grounds-tour']) // both bronze and a third of the way to silver: BADGES order
    expect(top[3].badge.id).toBe('regular') // 6 of 7 for bronze
    expect(top[4].badge.id).toBe('globetrotter') // 1 of 2
  })
})

describe('leagues won in and the Best seasons filter', () => {
  it('places titled hosts through their league, a newer entry through its own leagueId, and reports the rest', () => {
    const leagueOf = (id: string) => u.clubById[id]?.leagueId
    const board = [entry({ position: 1, tier: 'CHAMPIONS', hostClubId: 'barcelona', leagueId: 'spain' })]
    const r = leaguesWon({ hostsTitled: ['burnley', 'everton', 'barcelona', 'juventus'] }, board, leagueOf)
    expect(r.leagues).toEqual(['england', 'spain'])
    expect(r.unresolved).toEqual(['juventus'])
    expect(leaguesWon({ hostsTitled: [] }, [], leagueOf)).toEqual({ leagues: [], unresolved: [] })
  })

  it('filters Best seasons into Quick and Daily, Season and Dynasty', () => {
    const board = (['quick', 'daily', 'season', 'dynasty', 'quick'] as const).map((mode, i) => entry({ id: String(i), mode }))
    expect(filterBoard(board, 'all')).toEqual(board)
    expect(filterBoard(board, 'quick').map((e) => e.id)).toEqual(['0', '1', '4'])
    expect(filterBoard(board, 'season').map((e) => e.id)).toEqual(['2'])
    expect(filterBoard(board, 'dynasty').map((e) => e.id)).toEqual(['3'])
    expect(boardGroup('daily')).toBe('quick')
  })
})

describe('the store', () => {
  it('recordResult credits a finished game once and keeps profile.trophies in step', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: null, parked: {} })
    const before = useStore.getState().profile
    expect(before.cabinet).toEqual(emptyCabinet())
    // A champion's quick season (the result made first so the credit is visible)
    const g = quickGame('cab-store')
    g.quickResult = { ...g.quickResult!, position: 1, tier: 'CHAMPIONS' }
    useStore.setState({ game: g })
    useStore.getState().recordResult()
    useStore.getState().recordResult()
    const p = useStore.getState().profile
    expect(p.cabinet!.league).toBe(1)
    expect(p.cabinet!.byMode).toEqual({ quick: 1 })
    expect(p.cabinet!.hostsTitled).toEqual(['burnley'])
    expect(p.trophies).toEqual({ league: 1, cup: 0, continental: 0, doubles: 0, trebles: 0 })
    expect(p.leaderboard.length).toBe(before.leaderboard.length + 1)
    expect(p.leaderboard.at(-1)!.leagueId).toBe('england')
    expect(p.seasonsSimulated).toBe(before.seasonsSimulated + 1)
    useStore.setState({ game: null, universe: null, loadedLeagues: [], profile: before })
  }, 30_000)

  it('recordResult credits once even when the result misses a full top 50', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: null, parked: {} })
    const before = useStore.getState().profile
    const full = Array.from({ length: 50 }, (_, i) => entry({ id: `full-${i}`, points: 120, won: 38, drawn: 0, lost: 0, position: 1, tier: 'PERFECT' }))
    useStore.setState({ profile: { ...before, leaderboard: full, cabinet: emptyCabinet(), seasonsSimulated: 50 } })
    const g = quickGame('cab-store-full')
    g.quickResult = { ...g.quickResult!, points: 30, won: 6, drawn: 12, lost: 20, position: 20, tier: 'RELEGATED' }
    useStore.setState({ game: g })
    useStore.getState().recordResult()
    useStore.getState().recordResult()
    const p = useStore.getState().profile
    expect(p.leaderboard.map((e) => e.id)).toEqual(full.map((e) => e.id))
    expect(p.cabinet!.byMode).toEqual({ quick: 1 })
    expect(p.seasonsSimulated).toBe(51)
    useStore.setState({ game: null, universe: null, loadedLeagues: [], profile: before })
  }, 30_000)

  it('an older build that advanced profile.trophies past the cabinet is caught up on load', () => {
    const merge = useStore.persist.getOptions().merge!
    const current = useStore.getState()
    const cabinet = { ...emptyCabinet(), league: 3, cup: 1, perfect: 2 }
    const profile = { ...current.profile, cabinet, trophies: { league: 4, cup: 1, continental: 1, doubles: 1, trebles: 0 } }
    const merged = merge({ profile }, current) as typeof current
    expect(trophiesOf(merged.profile.cabinet!)).toEqual({ league: 4, cup: 1, continental: 1, doubles: 1, trebles: 0 })
    expect(merged.profile.cabinet!.perfect).toBe(2)
  })

  it('a profile without a cabinet gets one built through the persist merge; one with a cabinet keeps it', () => {
    const merge = useStore.persist.getOptions().merge!
    const current = useStore.getState()
    const oldProfile = {
      achievements: {},
      leaderboard: [entry({ id: 'x', position: 1, tier: 'CHAMPIONS', hostClubId: 'everton' })],
      dailyStreak: 0,
      lastDailyDate: null,
      dailyResults: {},
      gamesPlayed: 3,
      seasonsSimulated: 3,
      theme: 'auto',
      managerName: 'Minh',
      trophies: { league: 2, cup: 1, continental: 0, doubles: 1, trebles: 0 },
    }
    const merged = merge({ profile: oldProfile }, current) as typeof current
    expect(trophiesOf(merged.profile.cabinet!)).toEqual(oldProfile.trophies)
    expect(merged.profile.cabinet!.hostsTitled).toEqual(['everton'])
    expect(merged.profile.cabinet!.rebuilt).toBe(true)
    expect(merged.profile.trophies).toEqual(oldProfile.trophies)
    const kept = { ...emptyCabinet(), league: 9 }
    expect((merge({ profile: { ...oldProfile, cabinet: kept } }, current) as typeof current).profile.cabinet!.league).toBe(9)
    // No persisted profile at all: the fresh default, with an empty cabinet
    expect((merge({}, current) as typeof current).profile.cabinet).toEqual(emptyCabinet())
  })

  it('a head-to-head season credits the cabinet once', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], h2h: null })
    const before = useStore.getState().profile
    useStore.getState().startH2H([{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'burnley' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'everton' }], 'england', ['england'], 2025, 'calibrated', false, 'cab-h2h')
    for (let guard = 0; guard < 200 && !h2hComplete(useStore.getState().h2h!.draft); guard++) {
      if (useStore.getState().h2h!.draft.picking === null) useStore.getState().h2hSpin()
      else useStore.getState().h2hAuto()
    }
    useStore.getState().h2hFinish()
    expect(useStore.getState().h2h!.result).not.toBeNull()
    useStore.getState().h2hFinish()
    expect(useStore.getState().profile.cabinet!.h2h.played).toBe((before.cabinet?.h2h.played ?? 0) + 1)
    useStore.setState({ h2h: null, universe: null, loadedLeagues: [], profile: before })
  }, 60_000)
})
