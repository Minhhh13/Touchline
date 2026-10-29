import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { USER_TEAM, type ContinentalState } from '@engine/season'
import { groupTable } from '@engine/continental'
import type { MatchResult } from '@engine/types'
import { kickOff, toKickoff } from '../logic/quick'
import { playQuickCup, quickCupProblem } from '../logic/quickCups'
import { createGame } from '../logic/setup'
import { creditGame, creditRunIn, emptyCabinet, normaliseCabinet } from '../logic/cabinet'
import { cabinetWithFeats, creditCupFeats, creditGameFeats, creditRunInFeats, creditRunInFeatsOn, creditSeasonFeats, emptyFeats, withFeats, FEAT_LIST_CAP, featsFromBoard, featsOf, normaliseFeats, quickComebacks, quickGroupRead, runInWeekOf, seasonComebacks, seasonGroupRead } from '../logic/feats'
import { isPerfectDraft } from '../logic/perfectDraft'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings, LeaderboardEntry, QuickCupRun, RunInEntry, SeasonRecord } from '../types'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})

const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france']
const u = loadTestUniverse(LEAGUES)

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Feat XI', shortName: 'FXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A Quick Draft auto-drafted and its league season played, the cups still on offer. */
function played(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  return g
}

const result = (home: string, away: string, hg: number, ag: number): MatchResult => ({ homeTeamId: home, awayTeamId: away, homeGoals: hg, awayGoals: ag, events: [], homeStats: [], awayStats: [] }) as unknown as MatchResult

/** A finished group of four, the user against three sides, home and away, with the user's results given. */
function continental(userScores: Array<[number, number]>, extra: Partial<ContinentalState> = {}): ContinentalState {
  const teams = [USER_TEAM, 'a', 'b', 'c']
  const pairs: Array<[string, string]> = [
    [USER_TEAM, 'a'], ['b', 'c'], ['a', USER_TEAM], ['c', 'b'], [USER_TEAM, 'b'], ['a', 'c'], ['b', USER_TEAM], ['c', 'a'], [USER_TEAM, 'c'], ['b', 'a'], ['c', USER_TEAM], ['a', 'b'],
  ]
  let k = 0
  const matches = pairs.map(([h, a], i) => {
    const user = h === USER_TEAM || a === USER_TEAM
    const [us, them] = user ? userScores[k++] : [1, 1]
    const hg = h === USER_TEAM ? us : user ? them : 1
    const ag = a === USER_TEAM ? us : user ? them : 1
    return { matchweek: i, matchday: Math.floor(i / 2) + 1, homeTeamId: h, awayTeamId: a, result: result(h, a, hg, ag) }
  })
  return { ties: [], clubs: {}, eliminated: false, won: false, groups: [{ name: 'A', teams, matches }], ...extra }
}

function record(partial: Partial<SeasonRecord> = {}): SeasonRecord {
  return { year: 1, leagueId: 'england', leagueSeason: 2025, teamName: 'Feat XI', hostClubId: 'burnley', position: 1, points: 90, won: 28, drawn: 6, lost: 4, goalsFor: 80, goalsAgainst: 30, tier: 'CHAMPIONS', cupWon: false, ...partial }
}

function entry(partial: Partial<LeaderboardEntry>): LeaderboardEntry {
  return { id: 'x', date: '2026-10-28', mode: 'quick', teamName: 'T', points: 80, won: 25, drawn: 5, lost: 8, position: 1, tier: 'CHAMPIONS', seed: 's', leagueSeason: 2020, hostClubId: 'burnley', xi: [], ...partial }
}

describe('feats: engine 7 group stages and comebacks', () => {
  it('reads a group the user topped with six wins as topped and perfect', () => {
    const g = seasonGroupRead(continental([[2, 0], [1, 0], [3, 1], [2, 1], [1, 0], [4, 0]]))
    expect(g).toEqual({ topped: true, perfect: true })
  })

  it('tops a group without winning every match, and misses it on goal difference', () => {
    expect(seasonGroupRead(continental([[2, 0], [1, 1], [3, 1], [2, 1], [1, 0], [4, 0]]))).toEqual({ topped: true, perfect: false })
    expect(seasonGroupRead(continental([[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]))).toEqual({ topped: false, perfect: false })
  })

  it('reads nothing before every group match is played, or without groups (an engine 6 cup)', () => {
    const c = continental([[2, 0], [1, 0], [3, 1], [2, 1], [1, 0], [4, 0]])
    delete c.groups![0].matches[11].result
    expect(seasonGroupRead(c)).toBeNull()
    expect(seasonGroupRead({ ties: [], clubs: {}, eliminated: false, won: false })).toBeNull()
    expect(seasonGroupRead(undefined)).toBeNull()
  })

  it('counts a two-legged tie won after losing the first leg, home or away, and nothing else', () => {
    const tie = (home: string, away: string, l1: [number, number], winner: string) => ({ round: 'QF' as const, afterMatchweek: 20, homeTeamId: home, awayTeamId: away, firstLeg: { afterMatchweek: 18, result: result(home, away, l1[0], l1[1]) }, winnerId: winner })
    const cont: ContinentalState = {
      ties: [
        tie(USER_TEAM, 'a', [0, 2], USER_TEAM), // lost at home first, through
        tie('b', USER_TEAM, [3, 1], USER_TEAM), // lost away first, through
        tie(USER_TEAM, 'c', [2, 0], USER_TEAM), // won the first leg: no comeback
        tie('d', USER_TEAM, [1, 0], 'd'), // lost both ways
        { round: 'F', afterMatchweek: 30, homeTeamId: USER_TEAM, awayTeamId: 'e', winnerId: USER_TEAM }, // a single match
      ],
      clubs: {},
      eliminated: false,
      won: true,
    }
    expect(seasonComebacks(cont)).toBe(2)
  })

  it('reads a quick season run the same way', () => {
    const run: QuickCupRun = {
      ties: [],
      reached: 'SF',
      groups: [{ name: 'A', teams: [USER_TEAM, 'a', 'b', 'c'], matches: [[1, USER_TEAM, 'a', 2, 0], [1, 'b', 'c', 1, 1], [2, 'a', USER_TEAM, 0, 1], [3, USER_TEAM, 'b', 1, 0], [4, 'b', USER_TEAM, 1, 2], [5, USER_TEAM, 'c', 3, 0], [6, 'c', USER_TEAM, 0, 1]] }],
      bracket: [[{ home: USER_TEAM, away: 'x', hg: 3, ag: 2, winner: USER_TEAM, legs: [{ hg: 0, ag: 2 }, { hg: 3, ag: 0 }] }, { home: 'y', away: USER_TEAM, hg: 2, ag: 3, winner: USER_TEAM, legs: [{ hg: 2, ag: 0 }, { hg: 0, ag: 3 }] }, { home: 'p', away: 'q', hg: 0, ag: 1, winner: 'q', legs: [{ hg: 1, ag: 0 }, { hg: 0, ag: 2 }] }]],
    }
    expect(quickGroupRead(run)).toEqual({ topped: true, perfect: true })
    expect(quickComebacks(run)).toBe(2)
    expect(quickGroupRead({ ties: [], reached: 'R16' })).toBeNull()
  })

  it('agrees with the engine on who goes through, over seeded quick seasons', () => {
    let read = 0
    for (let i = 1; i <= 10; i++) {
      const g = played(`feats-group-${i}`)
      if (quickCupProblem(g, u, 'continental')) continue
      playQuickCup(g, u, 'continental')
      const run = g.quickResult?.continentalCup
      const group = quickGroupRead(run)
      if (!group) continue
      read++
      // Topped the group: through to the knockouts, never out in the groups
      if (group.topped) expect(run!.reached).not.toBe('G')
      if (group.perfect) expect(group.topped).toBe(true)
      // Credited once for the season and the cup
      const once = creditCupFeats(undefined, g, 'continental')
      expect(creditCupFeats(once, g, 'continental')).toEqual(once)
      expect(once.groupsWon).toBe(group.topped ? 1 : 0)
      expect(once.comebacks).toBe(quickComebacks(run))
    }
    expect(read).toBeGreaterThan(0)
   }, 120_000)
})

describe('feats: a season credited', () => {
  const base = (partial: Partial<GameSettings> = {}) => {
    const g = createGame(settings('feats-season', partial))
    g.history = [record()]
    return g
  }

  it('keeps the longest Dynasty, never adds them up', () => {
    const g = base({ mode: 'dynasty' })
    g.history = [record(), record(), record(), record(), record()]
    let f = creditSeasonFeats(undefined, g, { title: false })
    expect(f.dynastyBest).toBe(5)
    g.history = [record(), record()]
    f = creditSeasonFeats(f, g, { title: false })
    expect(f.dynastyBest).toBe(5)
  })

  it('counts an academy graduate only while he is still in the squad', () => {
    const g = base({ mode: 'dynasty' })
    const id = Object.keys(u.index).find((k) => u.index[k].age <= 19)!
    g.youthIntake = { year: g.year, candidates: [id], chosen: id }
    expect(creditSeasonFeats(undefined, g, { title: false }).graduates).toBe(0)
    g.squad[id] = { ...Object.values(g.squad)[0] } as Game['squad'][string]
    expect(creditSeasonFeats(undefined, g, { title: false }).graduates).toBe(1)
    g.youthIntake.chosen = null
    expect(creditSeasonFeats(undefined, g, { title: false }).graduates).toBe(0)
  })

  it('files titles by real season, classic ones, and none for the Super League', () => {
    const g = base()
    g.history = [record({ leagueSeason: 1992 })]
    let f = creditSeasonFeats(undefined, g, { title: true })
    expect(f.seasonsTitled).toEqual([1992])
    expect(f.classicTitles).toBe(1)
    g.history = [record({ leagueSeason: 2019 })]
    f = creditSeasonFeats(f, g, { title: true })
    f = creditSeasonFeats(f, g, { title: true })
    expect(f.seasonsTitled).toEqual([1992, 2019])
    expect(creditSeasonFeats(undefined, base({ rules: { ...QUICK_RULES, leagues: ['england'], superLeague: true } }), { title: true }).seasonsTitled).toEqual([])
    expect(creditSeasonFeats(undefined, g, { title: false }).seasonsTitled).toEqual([])
  })

  it('counts a capped title, and a thrifty one with a quarter of the cap left', () => {
    const g = base({ rules: { ...QUICK_RULES, leagues: ['england'], budget: 200 } })
    g.draft!.spent = 150
    let f = creditSeasonFeats(undefined, g, { title: true })
    expect([f.cappedTitles, f.thriftyTitles]).toEqual([1, 1])
    g.draft!.spent = 151
    f = creditSeasonFeats(undefined, g, { title: true })
    expect([f.cappedTitles, f.thriftyTitles]).toEqual([1, 0])
    expect(creditSeasonFeats(undefined, g, { title: false }).cappedTitles).toBe(0)
  })

  it('keeps a perfect draft once per wheel, so the same seed replayed never counts twice', () => {
    const g = base()
    let f = creditSeasonFeats(undefined, g, { title: false, perfectDraft: true })
    f = creditSeasonFeats(f, g, { title: false, perfectDraft: true })
    expect(f.perfectDrafts).toEqual(['feats-season'])
  })

  it('credits beside creditGame only for a league season', () => {
    const g = played('feats-credit')
    const c = creditGameFeats(creditGame(emptyCabinet(), g), g, { perfectDraft: true })
    expect(featsOf(c).perfectDrafts).toEqual(['feats-credit'])
    expect(featsOf(c).seasonsTitled.length).toBe(g.quickResult!.position === 1 ? 1 : 0)
    // An arena or run-in result is never a league season
    expect(creditGameFeats(emptyCabinet(), { ...g, settings: { ...g.settings, mode: 'arena' } }, { perfectDraft: true }).feats).toBeUndefined()
  }, 60_000)

  it('finds a perfect draft only when every pick took an A', () => {
    let perfect = 0
    for (let i = 1; i <= 6; i++) {
      const g = played(`feats-draft-${i}`)
      if (isPerfectDraft(g, u, playerLookup(g, u))) perfect++
    }
    // The assistant drafts by rating in a slot: a perfect draft is possible but never every time
    expect(perfect).toBeLessThan(6)
    const g = played('feats-draft-1')
    expect(isPerfectDraft({ ...g, endCase: { sub: { slotId: 'st', outId: 'x' } } as unknown as Game['endCase'] }, u, playerLookup(g, u))).toBe(false)
    expect(isPerfectDraft({ ...g, settings: { ...g.settings, mode: 'season' } }, u, playerLookup(g, u))).toBe(false)
   }, 60_000)
})

describe('feats: the Run-in of the week', () => {
  it('reads the week of a weekly seed only', () => {
    expect(runInWeekOf('runin-2026-W44')).toBe('2026-W44')
    expect(runInWeekOf('runin-abc')).toBeNull()
  })

  it('counts a week once, and only with the brief met', () => {
    let f = creditRunInFeats(undefined, 'runin-2026-W44', true)
    f = creditRunInFeats(f, 'runin-2026-W44', true)
    f = creditRunInFeats(f, 'runin-2026-W45', false)
    f = creditRunInFeats(f, 'my-own-seed', true)
    expect(f.runInWeeks).toEqual(['2026-W44'])
  })

  it('credits beside creditRunIn', () => {
    const g = createGame(settings('runin-2026-W44', { mode: 'runin' }))
    expect(featsOf(creditRunInFeatsOn(creditRunIn(emptyCabinet(), g, true), g, true)).runInWeeks).toEqual(['2026-W44'])
  })
})

describe('feats: saves', () => {
  it('normalise anything malformed and keep lists distinct and capped', () => {
    const f = normaliseFeats({ groupsWon: -3, comebacks: 2.7, seasonsTitled: [2019, 2019, 'x' as unknown as number, 1992], perfectDrafts: Array.from({ length: FEAT_LIST_CAP + 20 }, (_, i) => `s${i}`), runInWeeks: [3 as unknown as string] })!
    expect(f.groupsWon).toBe(0)
    expect(f.comebacks).toBe(2)
    expect(f.seasonsTitled).toEqual([1992, 2019])
    expect(f.perfectDrafts.length).toBe(FEAT_LIST_CAP)
    expect(f.runInWeeks).toEqual([])
    expect(normaliseFeats(undefined)).toBeUndefined()
  })

  it('leave an older cabinet without feats until it is caught up from its board once', () => {
    const c = normaliseCabinet({ league: 2 })
    expect(c.feats).toBeUndefined()
    const runIns = [{ seed: 'runin-2026-W40', met: true }, { seed: 'runin-2026-W41', met: false }] as RunInEntry[]
    const leaderboard = [
      entry({ id: 'a', leagueSeason: 1995 }),
      entry({ id: 'b', leagueSeason: 2015, budget: 200, spent: 140 }),
      entry({ id: 'c', mode: 'dynasty', seed: 'd1', position: 2, tier: 'TITLE_RACE' }),
      entry({ id: 'd', mode: 'dynasty', seed: 'd1', leagueSeason: 2016 }),
      entry({ id: 'e', leagueSeason: 2015, superLeague: true }),
      entry({ id: 'f', position: 1, tier: 'RELEGATED' }),
    ]
    const caught = withFeats(c, { leaderboard, runIns })
    expect(caught.feats).toEqual({ ...emptyFeats(), dynastyBest: 2, classicTitles: 1, cappedTitles: 1, thriftyTitles: 1, seasonsTitled: [1995, 2015, 2016], runInWeeks: ['2026-W40'] })
    // Once caught up, it stays as credited
    expect(withFeats(caught, { leaderboard: [], runIns: [] })).toEqual(caught)
    expect(featsFromBoard({ leaderboard, runIns })).toEqual(caught.feats)
    // A profile from before the Trophy Room: rebuilt, then caught up the same way
    expect(cabinetWithFeats({ leaderboard, dailyResults: {}, runIns }).feats).toEqual(caught.feats)
  })

  it('round-trip through JSON', () => {
    const g = played('feats-json')
    const c = creditGameFeats(creditGame(emptyCabinet(), g), g, { perfectDraft: true })
    expect(withFeats(normaliseCabinet(JSON.parse(JSON.stringify(c))), { leaderboard: [] })).toEqual(c)
  }, 60_000)
})

describe('feats: the store', () => {
  it('recordResult credits a title’s feats once, and a load catches an older cabinet up from its board', async () => {
    const { useStore } = await import('../store')
    useStore.setState({ universe: u, loadedLeagues: LEAGUES, game: null, parked: {} })
    const before = useStore.getState().profile
    const g = played('feats-store')
    g.quickResult = { ...g.quickResult!, position: 1, tier: 'CHAMPIONS' }
    useStore.setState({ game: g })
    useStore.getState().recordResult()
    useStore.getState().recordResult()
    expect(featsOf(useStore.getState().profile.cabinet!).seasonsTitled).toEqual([2025])
    // An older cabinet with no feats: the load counts them from the board once
    const merge = useStore.persist.getOptions().merge!
    const current = useStore.getState()
    const old = { ...current.profile, cabinet: emptyCabinet(), leaderboard: [entry({ leagueSeason: 1996 })] }
    const merged = merge({ profile: old }, current) as typeof current
    expect(merged.profile.cabinet!.feats?.classicTitles).toBe(1)
    useStore.setState({ game: null, universe: null, loadedLeagues: [], profile: before })
  }, 60_000)
})

describe('a group read agrees with the engine on any device (r9 audit)', () => {
  const original = String.prototype.localeCompare
  afterEach(() => {
    String.prototype.localeCompare = original
  })

  it('a dead-level top two is split as the engine splits it, not in the device language', () => {
    // User and "yeti" level on points, goal difference and goals: English puts "user" first, Lithuanian puts "y" before "u"
    const run = { ties: [], reached: 'QF', groups: [{ name: 'A', teams: [USER_TEAM, 'yeti', 'xa', 'xb'], matches: [[1, USER_TEAM, 'xa', 1, 0], [1, 'yeti', 'xb', 1, 0], [2, USER_TEAM, 'yeti', 0, 0], [2, 'xa', 'xb', 0, 0], [3, 'xb', USER_TEAM, 0, 1], [3, 'xa', 'yeti', 0, 1]] }] } as unknown as QuickCupRun
    const engineTop = groupTable({ teams: run.groups![0].teams, matches: run.groups![0].matches.map(([matchday, home, away, hg, ag]) => ({ id: `${matchday}-${home}`, matchweek: matchday, homeTeamId: home, awayTeamId: away, result: { homeGoals: hg, awayGoals: ag } })) as unknown as Parameters<typeof groupTable>[0]['matches'] })[0].teamId
    expect(engineTop).toBe(USER_TEAM)
    String.prototype.localeCompare = function (this: string, that: string, locales?: string | string[], options?: Intl.CollatorOptions) {
      return original.call(this, that, locales ?? 'lt', options)
    } as typeof String.prototype.localeCompare
    expect('yeti'.localeCompare(USER_TEAM)).toBeLessThan(0)
    expect(quickGroupRead(run)?.topped).toBe(true)
  })
})
