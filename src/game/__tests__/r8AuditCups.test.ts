import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper, upcomingCupTie } from '../logic/week'
import { meetingsWith, nextTieFixture } from '../logic/storylines'
import { foreseeStop } from '../logic/seasonHighlights'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import type { Game, GameSettings } from '../types'

const LEAGUES = ['england', 'spain', 'germany']
const u = loadTestUniverse(LEAGUES)

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Euro XI', shortName: 'EUR', leagueId: 'england', wheelLeagues: LEAGUES, hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: LEAGUES }, jobSecurity: false, difficulty: 'calibrated', continental: true }
}

function started(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g, u)
  return g
}

describe('r8 audit: previews and the sim label read engine 7 Continental Cup legs and groups', () => {
  it("the match preview's midweek fixture is the match the week plays: group matches, both legs and the venue of each", () => {
    let groupMatches = 0
    let legs = 0
    let firstLegsForeseen = 0
    for (const seed of ['r8-euro-1', 'r8-euro-2', 'r8-euro-3', 'r8-euro-4']) {
      const g = started(seed)
      while (g.season!.matchweek < g.season!.matchweeks && g.phase !== 'summary') {
        const due = upcomingCupTie(g)
        const shown = nextTieFixture(g)
        if (due) {
          const home = due.homeTeamId === USER_TEAM
          expect(shown, `${seed} MW ${g.season!.matchweek + 1}`).not.toBeNull()
          expect(shown!.comp).toBe(due.comp)
          expect(shown!.home).toBe(home)
          expect(shown!.opponentId).toBe(home ? due.awayTeamId : due.homeTeamId)
          expect(shown!.round).toBe(due.round === 'G' ? undefined : due.round)
          if (due.round === 'G') groupMatches++
          if (due.leg) legs++
          // A semi-final first leg in sight: the sim's label names its week, never the second leg's
          const sf = due.tie?.round === 'SF' && due.leg === 1
          if (sf) {
            const seen = foreseeStop(g, u)
            expect(seen?.matchweek).toBeLessThanOrEqual(due.afterMatchweek)
            firstLegsForeseen++
          }
        } else expect(shown, `${seed} MW ${g.season!.matchweek + 1}`).toBeNull()
        playMatchweek(g, u, true)
        if (g.phase === 'match') g.phase = 'week'
      }
      // Every leg played against a side is a meeting, at the ground it was played at
      for (const t of g.season!.continental?.ties ?? []) {
        if (!t.firstLeg?.result || !t.result || (t.homeTeamId !== USER_TEAM && t.awayTeamId !== USER_TEAM)) continue
        const opp = t.homeTeamId === USER_TEAM ? t.awayTeamId : t.homeTeamId
        const ms = meetingsWith(g.season!, opp).filter((m) => m.comp === 'continental' && (m.matchweek === t.firstLeg!.afterMatchweek || m.matchweek === t.afterMatchweek))
        expect(ms).toHaveLength(2)
        expect(ms[0].home).toBe(t.homeTeamId === USER_TEAM)
        expect(ms[1].home).toBe(t.awayTeamId === USER_TEAM)
        const l2 = t.result
        expect(ms[1].gf).toBe(ms[1].home ? l2.homeGoals : l2.awayGoals)
      }
    }
    expect(groupMatches).toBeGreaterThan(12)
    expect(legs).toBeGreaterThan(2)
    expect(firstLegsForeseen).toBeGreaterThan(0)
  }, 120_000)
})
