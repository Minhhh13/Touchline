import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { normaliseGame } from '../logic/save'
import { closestCall, realityLine, realSeasonRow, seasonStory, storyForGame, worstDefeat, type StoryContext } from '../logic/story'
import { foldResults, outcomeOf } from '../logic/gameByGame'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { computeTable, positionOf, USER_TEAM } from '@engine/season'
import { shareText } from '@engine/awards'
import type { MatchResult } from '@engine/types'
import type { Game, GameSettings, QuickGameResult } from '../types'
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
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Story XI', shortName: 'STO', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial }
}

function quickGame(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  runQuickSeason(g, u)
  return g
}

/** A season from a string of W, D and L (2-0, 1-1 and 0-1), with any game overridden by matchweek. */
function results(shape: string, overrides: Record<number, Partial<QuickGameResult>> = {}): QuickGameResult[] {
  return [...shape].map((o, i) => {
    const matchweek = i + 1
    const [gf, ga] = o === 'W' ? [2, 0] : o === 'D' ? [1, 1] : [0, 1]
    return { matchweek, opponentId: 'chelsea', home: true, gf, ga, scorers: [], position: 5, ...overrides[matchweek] }
  })
}

const NAMES: Record<string, string> = { chelsea: 'Chelsea', everton: 'Everton', spurs: 'Spurs', arsenal: 'Arsenal' }
const ctx = (partial: Partial<StoryContext>): StoryContext => ({ clinchedAt: null, doomedAt: null, tier: 'MID_TABLE', matchweeks: 38, clubs: 20, nameOf: (id) => NAMES[id] ?? id, ...partial })
const W38 = 'W'.repeat(38)

describe('the moment line, by priority', () => {
  it('a perfect season names its closest call: smallest margin, then fewest goals, then the latest', () => {
    const r = results(W38, { 10: { gf: 1, ga: 0, opponentId: 'arsenal' }, 20: { gf: 3, ga: 2 }, 31: { gf: 1, ga: 0, opponentId: 'spurs' } })
    expect(closestCall(r)!.matchweek).toBe(31)
    expect(seasonStory(r, ctx({ tier: 'PERFECT', clinchedAt: 30 })).moment).toBe('💎 38 from 38 · closest call 1-0 v Spurs (MW 31)')
  })

  it('invincibles and champions name the week the title was sealed, or the last day', () => {
    const unbeaten = results('W'.repeat(30) + 'D'.repeat(8))
    expect(seasonStory(unbeaten, ctx({ tier: 'INVINCIBLE', clinchedAt: 33 })).moment).toBe('🛡️ Unbeaten · title sealed at MW 33')
    expect(seasonStory(unbeaten, ctx({ tier: 'INVINCIBLE', clinchedAt: 38 })).moment).toBe('🛡️ Unbeaten · won on the last day')
    const champs = results('W'.repeat(28) + 'DDDLLWWWDW')
    expect(seasonStory(champs, ctx({ tier: 'CHAMPIONS', clinchedAt: 34 })).moment).toBe('🏆 Title sealed at MW 34 with 4 to play')
    expect(seasonStory(champs, ctx({ tier: 'CHAMPIONS', clinchedAt: 37 })).moment).toBe('🏆 Title sealed at MW 37 with 1 to play')
    expect(seasonStory(champs, ctx({ tier: 'CHAMPIONS', clinchedAt: 38 })).moment).toBe('🏁 Won it on the last day')
  })

  it('a relegated season names the week it went down', () => {
    const down = results('L'.repeat(20) + 'D'.repeat(18))
    expect(seasonStory(down, ctx({ tier: 'RELEGATED', doomedAt: 35 })).moment).toBe('⬇️ Down at MW 35')
    expect(seasonStory(down, ctx({ tier: 'RELEGATED', doomedAt: 38 })).moment).toBe('⬇️ Relegated on the last day')
    expect(seasonStory(down, ctx({ tier: 'RELEGATED', sacked: true })).moment).toBe('🪑 Sacked after MW 38')
  })

  it('a winning start of eight or more that ended, then a winning run of six or more, then the best result', () => {
    const start = results('W'.repeat(12) + 'D' + 'LWLDWL'.repeat(4) + 'L', { 13: { opponentId: 'everton' } })
    expect(start).toHaveLength(38)
    expect(seasonStory(start, ctx({ tier: 'TITLE_RACE' })).moment).toBe('💔 12-0 until MW 13: 1-1 v Everton')
    // Seven straight wins at the start is not enough; the nine in MW 14-22 is the story
    const run = results('W'.repeat(7) + 'L' + 'DLDLD' + 'W'.repeat(9) + 'DL'.repeat(8))
    expect(run).toHaveLength(38)
    expect(seasonStory(run, ctx({ tier: 'EUROPEAN' })).moment).toBe('📈 9-match winning run (MW 14-22)')
    const plain = results('WDLDWLDLW'.repeat(4) + 'DL', { 23: { gf: 5, ga: 0 }, 9: { home: false, opponentId: 'arsenal' } })
    expect(seasonStory(plain, ctx({})).moment).toBe('💥 Best: 5-0 v Chelsea (MW 23)')
    // A champion's winning start does not outrank the title
    expect(seasonStory(start, ctx({ tier: 'CHAMPIONS', clinchedAt: 36 })).moment).toBe('🏆 Title sealed at MW 36 with 2 to play')
  })

  it('a season without a win still has a line', () => {
    expect(seasonStory(results('LLDDDLLL'), ctx({ matchweeks: 8 })).moment).toBe('🧱 Unbeaten in 3 (MW 3-5), never a win')
    expect(seasonStory(results('LLLL'), ctx({ matchweeks: 4 })).moment).toBe('🥶 4 played, 4 lost')
  })

  it('an older quick save without the clinch week tells the title from the positions', () => {
    const r = results('W'.repeat(28) + 'DDDLLWWWDW').map((g) => ({ ...g, position: g.matchweek >= 20 ? 1 : 2 }))
    expect(seasonStory(r, ctx({ tier: 'CHAMPIONS', clinchedAt: undefined })).moment).toBe('🏆 Champions · top from MW 20')
    const late = r.map((g) => ({ ...g, position: g.matchweek === 38 ? 1 : 2 }))
    expect(seasonStory(late, ctx({ tier: 'CHAMPIONS', clinchedAt: undefined })).moment).toBe('🏁 Won it on the last day')
    const down = results('L'.repeat(38)).map((g) => ({ ...g, position: g.matchweek >= 30 ? 19 : 16 }))
    expect(seasonStory(down, ctx({ tier: 'RELEGATED', doomedAt: undefined })).moment).toBe('⬇️ In the bottom three from MW 30')
  })
})

describe('the records of the story', () => {
  it('finds the longest winning and unbeaten runs with their spans, the first longest on a tie', () => {
    const r = results('WWWLWWWDWWLWWW')
    const s = seasonStory(r, ctx({ matchweeks: 14 }))
    expect(s.winRun).toEqual({ length: 3, from: 1, to: 3 })
    expect(s.unbeatenRun).toEqual({ length: 6, from: 5, to: 10 })
    expect(s.startEnded).toEqual({ wins: 3, game: r[3] })
    expect(s.strip.join('')).toBe('WWWLWWWDWWLWWW')
    expect(seasonStory(results('DWW'), ctx({})).startEnded).toBeNull()
  })

  it('counts clean sheets and blanks and finds the heaviest defeat', () => {
    const r = results('WDLLW', { 3: { gf: 1, ga: 4 }, 4: { gf: 0, ga: 3 } })
    const s = seasonStory(r, ctx({}))
    expect(s.cleanSheets).toBe(2)
    expect(s.blanks).toBe(1)
    // Both by three: the one with more goals against
    expect(worstDefeat(r)!.matchweek).toBe(3)
    expect(s.worst!.matchweek).toBe(3)
    expect(s.best!.matchweek).toBe(1)
  })
})

// The RNG state after each of the 20 quick seasons below, computed on origin/main (d4d9b2f) with main's own code, where no
// Season Story exists: main's Quick Draft (managers on by default, the bench, `rounds`) moved them from the casual base's values.
// Re-baselined on ENGINE_VERSION '5' (the playtest fixes: new fixtures, assistant placement, keeper subs); the story draws nothing
const BASELINE_RNG = [
  '-2118513071.-71861973.-1839713759.1660984993',
  '402279426.1663033960.1188022786.95011790',
  '738885744.-888778304.-269352673.-2064272965',
  '1719306010.-640377433.-1109106083.-1838806159',
  '1419893025.-1883990439.1354558351.-1404064834',
  '1564801125.1014235337.-1294973520.296578877',
  '122780725.1764053814.-2102951512.-635243512',
  '-1503749021.-61274397.-1586133750.936053480',
  '1087980560.-1849355786.-1879295563.-1174093572',
  '1936047650.-656480583.-275716507.-1642452477',
  '370763507.-361748432.-1646882526.-396365116',
  '1586371973.-387794938.-1145194064.384425842',
  '-1819649412.-1956322241.-914427062.-687950087',
  '-1714042941.1184974214.-1826665896.1018648686',
  '1759208782.1484943792.-2134154136.-150762492',
  '-1636776502.-607128763.307815109.-358287009',
  '-620593569.802127697.-108916460.1538896259',
  '-81847391.-1520174522.1802057479.1593043854',
  '-73424024.-216383729.-347423388.395308689',
  '210991414.989856393.-1455681483.1674426973',
]

describe('Season Story on seeded quick seasons', () => {
  const games = Array.from({ length: 20 }, (_, i) => quickGame(`story-${i + 1}`))

  it('draws no random numbers: every RNG state is what it was before the story existed', () => {
    expect(games.map((g) => `${g.rngState.a}.${g.rngState.b}.${g.rngState.c}.${g.rngState.d}`)).toEqual(BASELINE_RNG)
  })

  it('has one strip cell per game adding up to the record, a clinch week exactly when first and a moment every time', () => {
    let champions = 0
    for (const g of games) {
      const q = g.quickResult!
      const story = storyForGame(g, u)!
      expect(story.strip).toHaveLength(38)
      expect(story.strip.filter((o) => o === 'W')).toHaveLength(q.won)
      expect(story.strip.filter((o) => o === 'D')).toHaveLength(q.drawn)
      expect(story.strip.filter((o) => o === 'L')).toHaveLength(q.lost)
      // Nothing of the story is stored: it is told from `results` and `rounds` when read
      expect(q.clinchedAt).toBeUndefined()
      expect(q.moment).toBeUndefined()
      expect(story.clinchedAt != null).toBe(q.position === 1)
      expect(story.doomedAt != null).toBe(q.position > 17)
      expect(story.moment).toBeTruthy()
      if (q.position === 1) {
        champions++
        expect(story.moment).toMatch(story.clinchedAt! >= 38 ? /last day/ : new RegExp(`MW ${story.clinchedAt}\\b`))
        // Sealed means sealed: the user led the table as it stood that week
        expect(q.results!.find((r) => r.matchweek === story.clinchedAt)!.position).toBe(1)
      }
    }
    // Enough champions to run the clinch branch (4 of the 20 on engine 5, 5 on engine 4)
    expect(champions).toBeGreaterThanOrEqual(4)
  })

  it('an older quick save without the rounds (or the story fields of the casual branch) is retold from its results', () => {
    const g = games.find((x) => x.quickResult!.position === 1)!
    const old = JSON.parse(JSON.stringify(g)) as Game
    delete old.quickResult!.rounds
    const n = normaliseGame(old)!
    const story = storyForGame(n, u)!
    expect(story.clinchedAt).toBeUndefined()
    expect(story.moment).toMatch(/^(🏆 Champions · top from MW \d+|🏁 Won it on the last day|🛡️ Unbeaten · .+|💎 .+)$/)
    // A save written before the results were recorded has no story at all
    delete n.quickResult!.results
    expect(storyForGame(n, u)).toBeNull()
  })

  it('the share text carries the moment and then the verdict against the real club, in that order', () => {
    const g = games[0]
    const q = g.quickResult!
    const real = realSeasonRow(u, 'england', 2024, 'liverpool')!
    expect(real.clubId).toBe('liverpool')
    expect(realSeasonRow(u, 'england', u.currentSeason ?? -1, 'liverpool')).toBeNull()
    const verdict = realityLine({ position: 19, points: 22 }, 'Burnley', { position: 1, points: 93 })
    expect(verdict).toBe('📊 The real Burnley finished 19th on 22 · you 1st on 93')
    const text = shareText({ teamName: 'Story XI', tier: q.tier, row: { teamId: USER_TEAM, played: 38, won: q.won, drawn: q.drawn, lost: q.lost, goalsFor: q.goalsFor, goalsAgainst: q.goalsAgainst, points: q.points, form: [] }, position: q.position, cupWon: false, continentalWon: false, leagueSeason: 2025, hostClubName: 'Burnley', mode: 'Quick Draft', seed: 'story-1', extraLines: [storyForGame(g, u)!.moment, verdict] })
    const lines = text.split('\n')
    expect(lines.indexOf(storyForGame(g, u)!.moment)).toBe(lines.indexOf(verdict) - 1)
    expect(lines.at(-1)).toBe('Seed story-1')
  })
})

describe('Season Story for Season and Dynasty, from the fixtures', () => {
  it('retells a finished managed season and names the clinch week', () => {
    const g = createGame(settings('story-season', { mode: 'season', rules: { ...SEASON_RULES, leagues: ['england'] } }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    const season = g.season!
    // Fill every fixture with a result (the user wins at home and draws away; the rest by a fixed rule)
    for (const f of season.fixtures) {
      const user = f.homeTeamId === USER_TEAM ? 'home' : f.awayTeamId === USER_TEAM ? 'away' : null
      const [hg, ag] = user === 'home' ? [3, 0] : user === 'away' ? [1, 1] : [(f.matchweek + f.homeTeamId.length) % 3, (f.matchweek + f.awayTeamId.length) % 2]
      const result: MatchResult = { homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeGoals: hg, awayGoals: ag, events: [], homeStats: [], awayStats: [], xg: { home: 0, away: 0 } }
      f.result = result
    }
    g.tier = 'INVINCIBLE'
    const ids = [USER_TEAM, ...Object.keys(season.ai)]
    const table = computeTable(season.fixtures, ids)
    expect(positionOf(table, USER_TEAM)).toBe(1)
    const story = storyForGame(g, u)!
    expect(story.results).toHaveLength(season.matchweeks)
    const t = foldResults(story.results)
    const row = table.find((r) => r.teamId === USER_TEAM)!
    expect([t.won, t.drawn, t.lost, t.points]).toEqual([row.won, row.drawn, row.lost, row.points])
    expect(story.strip).toEqual(story.results.map(outcomeOf))
    const sealed = story.clinchedAt ?? 0
    expect(sealed).toBeGreaterThan(20)
    expect(sealed).toBeLessThan(38)
    expect(story.moment).toBe(`🛡️ Unbeaten · title sealed at MW ${sealed}`)
  })
})

describe('the Record page keeps the moment', () => {
  it('recordResult files the moment with the leaderboard entry', () => {
    const g = quickGame('story-record')
    useStore.setState({ universe: u, game: g, loadedLeagues: ['england'] })
    useStore.getState().recordResult()
    const entry = useStore.getState().profile.leaderboard.find((e) => e.id === `${g.id}-${g.year}`)!
    expect(entry.moment).toBe(storyForGame(g, u)!.moment)
    useStore.setState({ game: null, universe: null, loadedLeagues: [] })
  })
})
