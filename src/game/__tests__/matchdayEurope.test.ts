import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import { continentalPlan, legAt } from '@engine/continental'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { latestScores } from '../logic/matchday'
import type { GameSettings } from '../types'

/**
 * The match day's other scores in an engine 7 Continental Cup round (r10): the other group matches of the matchday,
 * then the other legs of a knockout midweek, each from its own sides, a second leg's shoot-out turned to them.
 */

const u = loadTestUniverse(['england', 'spain', 'germany'])

function settings(seed: string): GameSettings {
  return {
    mode: 'dynasty',
    seed,
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england', 'spain', 'germany'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england', 'spain', 'germany'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: true,
  }
}

describe("the match day's other scores in the Continental Cup", () => {
  it('shows the other group matches of the matchday, then the other legs of each knockout midweek', async () => {
    let legs = 0
    let groupWeeks = 0
    for (const seed of ['r10-europe-a', 'r10-europe-b', 'r10-europe-c']) {
      const g = createGame(settings(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      startSeasonProper(g)
      const plan = continentalPlan(g.season!.matchweeks)
      for (let i = 0; i < 60 && g.phase !== 'summary' && g.season!.matchweek < g.season!.matchweeks; i++) {
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
      }
      const c = g.season!.continental!
      expect(c.groups).toHaveLength(4)
      for (const week of plan.groupWeeks) {
        const ref = { competition: 'continental' as const, matchweek: week }
        const all = c.groups!.flatMap((x) => x.matches.filter((m) => m.matchweek === week))
        const shown = latestScores(g, u, ref, 90, true)
        // Two matches a group each matchday; ours is the one left out
        expect(all).toHaveLength(8)
        expect(shown).toHaveLength(7)
        for (const s of shown) {
          expect(s.homeTeamId === USER_TEAM || s.awayTeamId === USER_TEAM).toBe(false)
          const m = all.find((x) => x.homeTeamId === s.homeTeamId && x.awayTeamId === s.awayTeamId)!
          expect([s.home, s.away, s.status]).toEqual([m.result!.homeGoals, m.result!.awayGoals, 'FT'])
          expect(s.penalties).toBeUndefined()
        }
        // At half-time only the first half's goals are in
        for (const s of latestScores(g, u, ref, 45, false)) {
          expect(s.status).toBe('HT')
          expect(s.goals.every((x) => x.minute <= 45)).toBe(true)
        }
        groupWeeks++
      }
      for (const r of plan.rounds) {
        for (const week of [...(r.firstLeg ? [r.firstLeg] : []), r.afterMatchweek]) {
          const ties = c.ties.filter((t) => legAt(t, week))
          const shown = latestScores(g, u, { competition: 'continental', matchweek: week }, 90, true)
          expect(shown).toHaveLength(ties.filter((t) => t.homeTeamId !== USER_TEAM && t.awayTeamId !== USER_TEAM).length)
          for (const s of shown) {
            const t = ties.find((x) => {
              const leg = legAt(x, week)!
              return leg.homeTeamId === s.homeTeamId && leg.awayTeamId === s.awayTeamId
            })!
            const leg = legAt(t, week)!
            const result = leg.leg === 1 ? t.firstLeg!.result! : t.result!
            expect([s.home, s.away]).toEqual([result.homeGoals, result.awayGoals])
            // A second leg's sides are the tie's swapped; a shoot-out after it reads from them too
            if (leg.leg === 2) expect([leg.homeTeamId, leg.awayTeamId]).toEqual([t.awayTeamId, t.homeTeamId])
            if (s.penalties) {
              expect(leg.leg === 1).toBe(false)
              expect(s.penalties.home > s.penalties.away).toBe(t.winnerId === s.homeTeamId)
            }
            legs++
          }
        }
      }
      await breathe()
    }
    expect(groupWeeks).toBe(18)
    expect(legs).toBeGreaterThan(20)
  }, 120_000)
})
