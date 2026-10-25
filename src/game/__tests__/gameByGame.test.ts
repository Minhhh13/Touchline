import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { runH2HSeason, H2H_IDS } from '../logic/h2h'
import { bestWin, bestWinLine, foldResults, outcomeOf, recordUserGames, scorersLabel, shortName } from '../logic/gameByGame'
import { autoDraft, isComplete, newDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { simulateMatch } from '@engine/match'
import { aiRatingOffset, aiTeamInput, buildAiClubs, computeTable, generateFixtures, matchweeksFor, positionOf, USER_TEAM } from '@engine/season'
import { autoPickLineup } from '@engine/ratings'
import { getFormation } from '@engine/formations'
import { defaultTactics } from '@engine/tactics'
import type { Fixture, MatchResult } from '@engine/types'
import type { GameSettings, QuickGameResult, QuickResult } from '../types'

const u = loadTestUniverse(['england'])

function quickGame(seed: string) {
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Reel XI', shortName: 'REL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  expect(isComplete(g.draft!)).toBe(true)
  runQuickSeason(g, u)
  return g
}

// The final table of seed `game-by-game` as the engine produced it before any game was recorded
const BASELINE_TABLE = [
  'arsenal:80/24/8/6/70/29',
  'user:79/24/7/7/87/44',
  'manchester-city:68/18/14/6/65/37',
  'liverpool:64/19/7/12/65/50',
  'manchester-united:59/15/14/9/58/45',
  'aston-villa:59/17/8/13/51/43',
  'everton:58/16/10/12/48/42',
  'nottingham-forest:57/17/6/15/48/40',
  'bournemouth:53/13/14/11/62/63',
  'chelsea:50/12/14/12/46/38',
  'west-ham-united:50/14/8/16/55/58',
  'newcastle-united:50/14/8/16/53/61',
  'brighton:47/13/8/17/39/54',
  'fulham:44/12/8/18/42/57',
  'tottenham-hotspur:43/10/13/15/45/57',
  'crystal-palace:41/9/14/15/31/42',
  'sunderland:41/10/11/17/38/52',
  'wolverhampton-wanderers:36/9/9/20/35/64',
  'brentford:33/8/9/21/38/71',
  'leeds-united:30/8/6/24/39/68',
]
const BASELINE_RNG = { a: -1720087132, b: -1772400845, c: -2127551745, d: -1686302794 }

describe('a quick season recorded game by game', () => {
  const g = quickGame('game-by-game')
  const q = g.quickResult!
  const results = q.results!

  it('draws no random numbers: the table and the RNG state are exactly what they were before the recording', () => {
    expect(q.table.map((r) => `${r.teamId}:${r.points}/${r.won}/${r.drawn}/${r.lost}/${r.goalsFor}/${r.goalsAgainst}`)).toEqual(BASELINE_TABLE)
    expect(g.rngState).toEqual(BASELINE_RNG)
    expect(q.topScorer).toEqual({ playerSeasonId: 's7826@2012@manchester-united', goals: 26 })
  })

  it('keeps one game per matchweek, in order, and the games add up to the season record exactly', () => {
    expect(results).toHaveLength(38)
    expect(results.map((r) => r.matchweek)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1))
    const t = foldResults(results)
    expect(t.played).toBe(38)
    expect(t.won).toBe(q.won)
    expect(t.drawn).toBe(q.drawn)
    expect(t.lost).toBe(q.lost)
    expect(t.goalsFor).toBe(q.goalsFor)
    expect(t.goalsAgainst).toBe(q.goalsAgainst)
    expect(t.points).toBe(q.points)
    expect(t.position).toBe(q.position)
    expect(results.at(-1)!.position).toBe(q.position)
    // Every opponent is a real club of the league, met exactly once at home and once away
    const home = results.filter((r) => r.home).map((r) => r.opponentId).sort()
    const away = results.filter((r) => !r.home).map((r) => r.opponentId).sort()
    expect(home).toEqual(away)
    expect(new Set(home).size).toBe(19)
    expect(home).not.toContain('burnley')
    for (const r of results) {
      expect(r.position).toBeGreaterThanOrEqual(1)
      expect(r.position).toBeLessThanOrEqual(20)
      // One scorer per goal, in minute order, and an opponent's own goal credited as OG
      expect(r.scorers).toHaveLength(r.gf)
      expect(r.scorers.map((s) => s.minute)).toEqual([...r.scorers.map((s) => s.minute)].sort((a, b) => a - b))
      for (const s of r.scorers) expect(s.name === 'OG' ? s.playerSeasonId === undefined : !!s.playerSeasonId && u.index[s.playerSeasonId]?.name === s.name).toBe(true)
    }
  })

  it('an older save without the field still reads', () => {
    // A save written before the field existed carries no `results` at all
    const legacy = JSON.parse(JSON.stringify({ ...q, results: undefined })) as QuickResult
    expect('results' in legacy).toBe(false)
    expect(foldResults(legacy.results ?? []).played).toBe(0)
    expect(bestWinLine(legacy.results, (id) => id)).toBeNull()
  })
})

describe('recordUserGames', () => {
  it('matches the goal events of every fixture the engine played', () => {
    const rng = new Rng('scorers-match-events')
    const ai = buildAiClubs(u, 'england', 2025, 'burnley')
    const offset = aiRatingOffset(u, ai, 'calibrated')
    const draft = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] })
    autoDraft(u, draft, rng)
    const tactics = defaultTactics('4-3-3')
    const pool = [...Object.values(draft.lineup), ...draft.bench].map((id) => u.index[id]).filter(Boolean)
    const lineup = { ...draft.lineup, ...autoPickLineup(getFormation('4-3-3'), pool, tactics).lineup }
    const user = { teamId: USER_TEAM, teamName: 'Reel XI', shortName: 'REL', tactics, lineup, bench: [...draft.bench], getPlayer: (id: string) => u.index[id], getState: () => undefined }
    const ids = [USER_TEAM, ...Object.keys(ai)]
    const fixtures = generateFixtures(ids, rng)
    // Half a season is plenty: every user fixture of the first ten matchweeks
    const sample = fixtures.filter((f) => f.matchweek <= 10)
    for (const f of sample) {
      const home = f.homeTeamId === USER_TEAM ? user : aiTeamInput(u, ai[f.homeTeamId], offset)
      const away = f.awayTeamId === USER_TEAM ? user : aiTeamInput(u, ai[f.awayTeamId], offset)
      f.result = simulateMatch({ rng, home, away, detail: 'summary' })
    }
    const results = recordUserGames(fixtures, ids, USER_TEAM, (id) => u.index[id]?.name)
    expect(results).toHaveLength(10)
    let goals = 0
    for (const r of results) {
      const f = sample.find((x) => x.matchweek === r.matchweek && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))!
      const side = f.homeTeamId === USER_TEAM ? 'home' : 'away'
      expect(r.home).toBe(side === 'home')
      expect(r.opponentId).toBe(side === 'home' ? f.awayTeamId : f.homeTeamId)
      expect(r.gf).toBe(side === 'home' ? f.result!.homeGoals : f.result!.awayGoals)
      expect(r.ga).toBe(side === 'home' ? f.result!.awayGoals : f.result!.homeGoals)
      const events = f.result!.events.filter((e) => (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') && e.side === side).sort((a, b) => a.minute - b.minute)
      expect(r.scorers.map((s) => s.minute)).toEqual(events.map((e) => e.minute))
      expect(r.scorers.map((s) => s.playerSeasonId)).toEqual(events.map((e) => (e.type === 'own_goal' ? undefined : e.playerId)))
      expect(r.scorers.map((s) => s.name)).toEqual(events.map((e) => (e.type === 'own_goal' ? 'OG' : e.playerName)))
      // The position is the one the table shows after that matchweek
      expect(r.position).toBe(positionOf(computeTable(fixtures.filter((x) => x.matchweek <= r.matchweek), ids), USER_TEAM))
      goals += r.gf
    }
    expect(goals).toBeGreaterThan(0)
  })

  it('credits an opponent own goal as OG and leaves the user own goal to the opponent', () => {
    const result: MatchResult = {
      homeTeamId: 'me',
      awayTeamId: 'them',
      homeGoals: 2,
      awayGoals: 1,
      xg: { home: 1, away: 1 },
      homeStats: [],
      awayStats: [],
      events: [
        { minute: 70, type: 'goal', side: 'home', playerId: 'p1', playerName: 'E. Haaland', text: '' },
        { minute: 12, type: 'own_goal', side: 'home', playerId: 'd9', playerName: 'A defender', text: '' },
        { minute: 40, type: 'own_goal', side: 'away', playerId: 'p2', playerName: 'My defender', text: '' },
        { minute: 55, type: 'yellow', side: 'home', playerId: 'p1', text: '' },
      ],
    }
    const fixtures: Fixture[] = [
      { matchweek: 1, homeTeamId: 'me', awayTeamId: 'them', result },
      { matchweek: 1, homeTeamId: 'a', awayTeamId: 'b', result: { ...result, homeTeamId: 'a', awayTeamId: 'b', homeGoals: 5, awayGoals: 0, events: [] } },
      { matchweek: 2, homeTeamId: 'b', awayTeamId: 'me' },
    ]
    const r = recordUserGames(fixtures, ['me', 'them', 'a', 'b'], 'me', (id) => (id === 'p1' ? 'Erling Haaland' : undefined))
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ matchweek: 1, opponentId: 'them', home: true, gf: 2, ga: 1, position: 2, scorers: [{ name: 'OG', minute: 12 }, { name: 'Erling Haaland', minute: 70, playerSeasonId: 'p1' }] })
  })

  it('records both managers of a head-to-head, derbies included', () => {
    const rng = new Rng('h2h-games')
    const drafts = [newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: ['england'] }), newDraft(getFormation('4-4-2'), { ...QUICK_RULES, leagues: ['england'] })] as const
    autoDraft(u, drafts[0], rng)
    autoDraft(u, drafts[1], rng)
    const r = runH2HSeason(u, rng, [{ name: 'Ann', shortName: 'ANN', formationId: '4-3-3', hostClubId: 'burnley' }, { name: 'Bob', shortName: 'BOB', formationId: '4-4-2', hostClubId: 'everton' }], [drafts[0], drafts[1]], 'england', 2025, 'calibrated')
    const mw = matchweeksFor(20)
    for (const i of [0, 1] as const) {
      const games = r.results![i]
      expect(games).toHaveLength(mw)
      const t = foldResults(games)
      expect([t.won, t.drawn, t.lost, t.goalsFor, t.goalsAgainst, t.points, t.position]).toEqual([r.rows[i].won, r.rows[i].drawn, r.rows[i].lost, r.rows[i].goalsFor, r.rows[i].goalsAgainst, r.rows[i].points, r.positions[i]])
      const derbies = games.filter((x) => x.opponentId === H2H_IDS[i === 0 ? 1 : 0])
      expect(derbies).toHaveLength(2)
      for (const d of r.derbies) {
        const mine = games.find((x) => x.matchweek === d.matchweek)!
        expect(mine.home).toBe(d.homeIdx === i)
        expect([mine.gf, mine.ga]).toEqual(d.homeIdx === i ? [d.homeGoals, d.awayGoals] : [d.awayGoals, d.homeGoals])
      }
    }
  })
})

describe('the replay helpers', () => {
  const game = (matchweek: number, gf: number, ga: number, position: number, opponentId = 'chelsea', home = true): QuickGameResult => ({ matchweek, opponentId, home, gf, ga, scorers: [], position })
  const season = [game(1, 2, 0, 3), game(2, 1, 1, 5), game(3, 0, 3, 9, 'arsenal', false), game(4, 5, 0, 4, 'chelsea'), game(5, 4, 1, 2, 'everton', false)]

  it('folds results into running totals and the position after the last game counted', () => {
    expect(foldResults(season, 0)).toEqual({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, position: 0 })
    expect(foldResults(season, 2)).toEqual({ played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 1, points: 4, position: 5 })
    expect(foldResults(season, 3)).toEqual({ played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 4, points: 4, position: 9 })
    expect(foldResults(season)).toEqual({ played: 5, won: 3, drawn: 1, lost: 1, goalsFor: 12, goalsAgainst: 5, points: 10, position: 2 })
    expect(foldResults(season, 99)).toEqual(foldResults(season))
    expect(['W', 'D', 'L']).toEqual([outcomeOf(season[0]), outcomeOf(season[1]), outcomeOf(season[2])])
  })

  it('names the best win by margin, then goals, then the earliest matchweek', () => {
    expect(bestWin(season)!.matchweek).toBe(4)
    expect(bestWinLine(season, (id) => id[0].toUpperCase() + id.slice(1))).toBe('Best win: 5-0 v Chelsea (MW 4)')
    expect(bestWinLine([game(1, 0, 1, 10), game(2, 2, 2, 10)], (id) => id)).toBeNull()
    expect(bestWinLine([game(7, 3, 0, 1, 'arsenal', false), game(9, 3, 0, 1, 'everton', false)], (id) => id)).toBe('Best win: 3-0 at arsenal (MW 7)')
    expect(bestWinLine([game(7, 3, 0, 1), game(9, 4, 1, 1)], (id) => id)).toBe('Best win: 4-1 v chelsea (MW 9)')
    expect(bestWinLine(undefined, (id) => id)).toBeNull()
  })

  it("writes scorers as Haaland 12', 67' with minutes grouped and own goals as OG", () => {
    expect(scorersLabel([])).toBe('')
    expect(scorersLabel([{ name: 'E. Haaland', minute: 67, playerSeasonId: 'h' }, { name: 'K. De Bruyne', minute: 30, playerSeasonId: 'k' }, { name: 'E. Haaland', minute: 12, playerSeasonId: 'h' }, { name: 'OG', minute: 80 }])).toBe("Haaland 12', 67' · De Bruyne 30' · OG 80'")
    expect(shortName('Neymar')).toBe('Neymar')
    expect(shortName('K. De Bruyne')).toBe('De Bruyne')
    expect(shortName('Virgil van Dijk')).toBe('Virgil van Dijk')
  })
})
