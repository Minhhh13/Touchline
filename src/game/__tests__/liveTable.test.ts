import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { USER_TEAM } from '@engine/season'
import { createGame } from '../logic/setup'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { gapLine, momentAt, movement, positionSeries, rivalsOf, tableAfterGame, weeklyTables, zoneOf, type LiveRow } from '../logic/liveTable'
import { compactGame } from '../logic/compact'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function season(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Live XI', shortName: 'LIV', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  return g
}

describe('the live league table', { timeout: 180_000 }, () => {
  it('ends on the final table of the summary, and matches every game\'s recorded position, over several seeds', () => {
    for (const seed of ['live-1', 'live-2', 'live-3', 'live-4']) {
      const g = season(seed)
      const q = g.quickResult!
      const tables = weeklyTables(q.rounds!)
      const last = tables.at(-1)!
      expect(last.map((r) => [r.teamId, r.points, r.goalsFor, r.goalsAgainst, r.won, r.drawn, r.lost])).toEqual(q.table.map((r) => [r.teamId, r.points, r.goalsFor, r.goalsAgainst, r.won, r.drawn, r.lost]))
      const results = q.results!
      expect(positionSeries(tables, results, USER_TEAM)).toEqual(results.map((r) => r.position))
      expect(tableAfterGame(tables, results, results.length)).toBe(last)
      for (const t of tables) expect(t).toHaveLength(20)
    }
  })

  it('is the same after a January pass as without a window, and the first half is kept for the window', () => {
    const g = season('live-jan', { january: true })
    expect(g.phase).toBe('january')
    const first = weeklyTables(g.quickJanuary!.firstHalfRounds!)
    expect(first).toHaveLength(g.quickJanuary!.afterMatchweek)
    closeJanuary(g, u, null)
    const plain = season('live-jan')
    expect(g.quickResult!.rounds).toEqual(plain.quickResult!.rounds)
    expect(weeklyTables(g.quickResult!.rounds!).slice(0, first.length)).toEqual(first)
  })

  it('is small on the save and survives compaction', () => {
    const g = season('live-size')
    const json = JSON.stringify(g.quickResult!.rounds)
    expect(json.length).toBeLessThan(6000)
    expect(compactGame(g).quickResult!.rounds).toEqual(g.quickResult!.rounds)
  })

  it('reads movement, zones, gaps, rivals and the moments worth marking', () => {
    const row = (teamId: string, points: number, played = 1): LiveRow => ({ teamId, played, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points })
    const before = [row('a', 6), row('user', 4), row('b', 3)]
    const now = [row('user', 7), row('a', 6), row('b', 3)]
    expect(movement(before, now, USER_TEAM)).toBe(1)
    expect(movement(before, now, 'a')).toBe(-1)
    expect(gapLine(now, USER_TEAM)).toBe('Top by 1 pt')
    expect(gapLine(before, USER_TEAM)).toBe('2 pts off top')
    expect(gapLine([row('a', 9), row('b', 8), row('c', 8), row('d', 7), row('user', 5)], USER_TEAM)).toBe('2 pts off 4th')
    expect(rivalsOf(now, USER_TEAM, 2)).toEqual(['a', 'b'])
    expect([1, 2, 4, 5, 6, 7, 17, 18, 20].map((p) => zoneOf(p, 20))).toEqual(['title', 'top4', 'top4', 'top6', 'top6', null, null, 'releg', 'releg'])
    // Over real seasons: the perfect run's end is marked on the game that ends it, and going top only when it happens
    for (const seed of ['live-1', 'live-2']) {
      const q = season(seed).quickResult!
      const tables = weeklyTables(q.rounds!)
      const r = q.results!
      const firstDrop = r.findIndex((x) => x.gf <= x.ga) + 1
      for (let k = 1; k <= r.length; k++) {
        const m = momentAt(tables, r, k, USER_TEAM)
        if (k === firstDrop) expect(m).toBe('broke')
        if (m === 'top') expect(r[k - 1].position).toBe(1)
        if (m === 'top') expect(k === 1 || r[k - 2].position !== 1).toBe(true)
        if (m === 'top4') expect(r[k - 1].position).toBeLessThanOrEqual(4)
      }
    }
  })

  it('works for a classic season of 22 clubs: 42 games each, no byes, the final week the summary\'s table', () => {
    const cs = u.clubSeasons.filter((c) => c.leagueId === 'england' && c.season === 1993)
    expect(cs.length).toBe(22)
    const g = season('live-classic', { leagueSeason: 1993, hostClubId: cs[0].clubId, rules: { ...QUICK_RULES, leagues: ['england'], classic: true } })
    const q = g.quickResult!
    expect(q.results).toHaveLength(42)
    const tables = weeklyTables(q.rounds!)
    expect(tables).toHaveLength(42)
    for (const t of tables) expect(t).toHaveLength(22)
    // Every matchweek has eleven fixtures: nobody sits one out
    for (const w of q.rounds!.weeks) expect(w.length).toBe(11 * 4)
    expect(tables.at(-1)!.map((r) => [r.teamId, r.points])).toEqual(q.table.map((r) => [r.teamId, r.points]))
    expect(positionSeries(tables, q.results!, USER_TEAM)).toEqual(q.results!.map((r) => r.position))
    expect(zoneOf(20, 22)).toBe('releg')
    expect(zoneOf(19, 22)).toBeNull()
  })

  it('shows nothing for a season saved before the live table', () => {
    expect(tableAfterGame([], [], 3)).toEqual([])
    expect(positionSeries([], [{ matchweek: 1 }], USER_TEAM)).toEqual([0])
  })
})
