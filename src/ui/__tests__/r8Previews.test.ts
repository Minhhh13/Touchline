/**
 * QA round 3 (r8): match previews on engine 7's Continental Cup (display only). The preview read only single-match
 * ties: no group match and no first leg was ever previewed, a second leg was called a home game at the other side's
 * ground, and a second leg's meeting read its score the wrong way round (its result keeps its own sides).
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { USER_TEAM } from '@engine/season'
import { legAt, tieScore } from '@engine/continental'
import { createGame, beginSeason } from '@game/logic/setup'
import { playMatchweek, startSeasonProper } from '@game/logic/week'
import { matchPreview, meetingsWith, nextTieFixture } from '@game/logic/storylines'
import type { Game } from '@game/types'
import { previewLines, previewTitle } from '../storyText'

const ALL = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(ALL)

function season(seed: string): Game {
  const g = createGame({ mode: 'season', seed, formationId: '4-3-3', teamName: 'Preview XI', shortName: 'PRV', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'arsenal', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: true })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g, u)
  return g
}

describe('R8-6: previews of the Continental Cup group stage and two-legged ties', () => {
  it('previews every group match and both legs at their own grounds, and reads both legs as meetings', () => {
    let groups = 0
    let legs = 0
    let meetings = 0
    for (const seed of ['r8-preview-1', 'r8-preview-2', 'r8-preview-3', 'r8-preview-4', 'r8-preview-5', 'r8-preview-6']) {
      const g = season(seed)
      const c = g.season!.continental!
      expect(c.groups).toHaveLength(4)
      while (g.phase !== 'summary') {
        const f = nextTieFixture(g)
        const mw = g.season!.matchweek + 1
        const mine = c.groups!.flatMap((x) => x.matches).find((m) => m.matchweek === mw && (m.homeTeamId === USER_TEAM || m.awayTeamId === USER_TEAM))
        if (mine && !c.eliminated) {
          groups++
          expect(f).toMatchObject({ comp: 'continental', home: mine.homeTeamId === USER_TEAM, opponentId: mine.homeTeamId === USER_TEAM ? mine.awayTeamId : mine.homeTeamId })
          expect(f!.group).toBeTruthy()
          const p = matchPreview(g, u, f!)!
          expect(previewTitle(p, u)).toMatch(/^Continental Cup Group [A-D]: (v|at) /)
          expect(previewLines(p, u, 'Preview XI', 'k').find((l) => l.id === 'stake')?.text).toMatch(/top two go through/)
        }
        const tie = c.ties.find((t) => (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM) && legAt(t, mw))
        if (tie && !c.eliminated && !c.won) {
          const leg = legAt(tie, mw)!
          legs++
          expect(f).toMatchObject({ comp: 'continental', round: tie.round, home: leg.homeTeamId === USER_TEAM })
          if (leg.leg) expect(f!.leg).toBe(leg.leg)
          const text = previewLines(matchPreview(g, u, f!)!, u, 'Preview XI', 'k').find((l) => l.id === 'stake')?.text ?? ''
          if (leg.leg === 1) expect(text).toMatch(/first leg: the second leg decides it/)
        }
        playMatchweek(g, u, true)
      }
      // Every meeting with a knockout opponent matches the tie's own legs, from the user's side
      for (const t of c.ties.filter((x) => x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM)) {
        const opp = t.homeTeamId === USER_TEAM ? t.awayTeamId : t.homeTeamId
        const ms = meetingsWith(g.season!, opp).filter((m) => m.comp === 'continental' && m.matchweek >= (t.firstLeg?.afterMatchweek ?? t.afterMatchweek))
        const sc = tieScore(t)!
        const ours = t.homeTeamId === USER_TEAM
        const want = (sc.legs ?? [{ home: t.result!.homeGoals, away: t.result!.awayGoals }]).map((l) => [ours ? l.home : l.away, ours ? l.away : l.home])
        // Extra time is not in a leg's ninety minutes, so compare the legs as played
        expect(ms.map((m) => [m.gf, m.ga])).toEqual(want)
        meetings += ms.length
      }
    }
    expect(groups).toBeGreaterThanOrEqual(24)
    expect(legs).toBeGreaterThan(0)
    expect(meetings).toBeGreaterThan(0)
  }, 300_000)
})
