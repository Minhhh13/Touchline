import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { currentScore } from '@engine/match'
import { scoreAt } from '@engine/matchFeed'
import { computeTable, USER_TEAM } from '@engine/season'
import { advanceLiveMatch, completeLiveMatch, finishLiveMatch, playFriendly, playMatchweek, tiesOf } from '../logic/week'
import { latestScores, liveTable, roundRefOf, roundTable } from '../logic/matchday'
import { seasonGame } from './seasonGame'
import { compactGame } from '../logic/compact'
import { normaliseGame } from '../logic/save'
import type { Game } from '../types'

describe('the rest of the round at the user’s minute', { timeout: 30_000 }, () => {
  const u = loadTestUniverse()

  it('scores start at 0-0, never fall, show HT at the break and every goal at the whistle', () => {
    for (let i = 0; i < 4; i++) {
      const g = seasonGame(u, `md-scores-${i}`, 3 + i)
      playMatchweek(g, u)
      const live = g.live!
      const ref = roundRefOf(live.ctx, live.cupTieIndex)
      expect(ref).toEqual({ competition: 'league', matchweek: live.ctx.matchweek, cupTieIndex: undefined })
      const round = g.season!.fixtures.filter((f) => f.matchweek === ref.matchweek && f.homeTeamId !== USER_TEAM && f.awayTeamId !== USER_TEAM)
      const zero = latestScores(g, u, ref, 0, false)
      expect(zero).toHaveLength(round.length)
      for (const s of zero) expect([s.home, s.away, s.status]).toEqual([0, 0, 'pre'])
      let prev = zero
      for (let m = 1; m <= 94; m++) {
        const now = latestScores(g, u, ref, m, false)
        now.forEach((s, j) => {
          expect(s.home).toBeGreaterThanOrEqual(prev[j].home)
          expect(s.away).toBeGreaterThanOrEqual(prev[j].away)
          expect(s.status).toBe(m === 45 ? 'HT' : 'live')
          expect(s.goals.every((x) => x.minute <= m)).toBe(true)
        })
        prev = now
      }
      const ft = latestScores(g, u, ref, 90, true)
      ft.forEach((s, j) => {
        expect(s.status).toBe('FT')
        expect([s.home, s.away]).toEqual([round[j].result!.homeGoals, round[j].result!.awayGoals])
        expect(s.homeCode).toMatch(/^[A-Z0-9]{2,4}$/)
        expect(s.homeName.length).toBeGreaterThan(2)
      })
    }
  })

  it('the live table: the table before the round at 0, the round counted as it stands, computeTable at the whistle, arrows against the round’s start', () => {
    for (let i = 0; i < 4; i++) {
      const g = seasonGame(u, `md-table-${i}`, 4 + i)
      playMatchweek(g, u)
      const live = g.live!
      const ref = roundRefOf(live.ctx)
      const before = roundTable(g, ref)
      const at0 = liveTable(g, u, ref, 0, { home: 0, away: 0 }, live.userIsHome, false)!
      expect(at0.map((r) => r.teamId)).toEqual(before.map((r) => r.teamId))
      expect(at0.every((r) => r.movement === 0 && !r.playing && r.position === r.previous)).toBe(true)
      expect(at0.find((r) => r.isUser)?.name).toBe(g.settings.teamName)
      // At 1': the round is in play, so the points stand as they are and nobody has played another game yet
      const at1 = liveTable(g, u, ref, 1, { home: 0, away: 0 }, live.userIsHome, false)!
      for (const r of at1) expect(r.played).toBe(before.find((x) => x.teamId === r.teamId)!.played)
      expect(at1.some((r) => r.playing)).toBe(true)
      // In play: everyone in the round counts at his score (the user's at his), P once the match ends
      advanceLiveMatch(g, u, {})
      advanceLiveMatch(g, u, {}, false, true)
      const mp = g.live!.mp
      const at60 = liveTable(g, u, ref, 60, scoreAt(mp.events, 60), live.userIsHome, false)!
      for (const r of at60) {
        const b = before.find((x) => x.teamId === r.teamId)!
        expect(r.played).toBe(b.played)
        expect(r.movement).toBe(Math.sign(r.previous - r.position))
      }
      expect(at60.filter((r) => r.playing).length).toBeGreaterThanOrEqual(at60.length - 1)
      const final = currentScore(mp)
      const whistle = liveTable(g, u, ref, 94, final, live.userIsHome, true)!
      completeLiveMatch(g, u)
      const truth = computeTable(g.season!.fixtures.filter((f) => f.matchweek <= ref.matchweek), [USER_TEAM, ...Object.keys(g.season!.ai)])
      expect(whistle.map((r) => [r.teamId, r.played, r.points, r.goalsFor, r.goalsAgainst])).toEqual(truth.map((r) => [r.teamId, r.played, r.points, r.goalsFor, r.goalsAgainst]))
      expect(whistle.every((r) => !r.playing)).toBe(true)
    }
  })

  it('a knockout round shows the other ties, with penalties only at full time, and the league table without arrows; a friendly has neither', () => {
    // Matchweek 6 is followed by the cup's first round
    const g = seasonGame(u, 'md-cup', 5)
    playMatchweek(g, u)
    finishLiveMatch(g, u)
    expect(g.live?.kind).toBe('cup')
    const live = g.live!
    const ref = roundRefOf(live.ctx, live.cupTieIndex)
    expect(ref.competition).toBe('cup')
    const ties = tiesOf(g.season!, 'cup')
    const own = ties[live.cupTieIndex!]
    const others = ties.filter((t) => t.round === own.round && t !== own)
    const mid = latestScores(g, u, ref, 50, false)
    const ft = latestScores(g, u, ref, 90, true)
    expect(ft).toHaveLength(others.length)
    expect(others.every((t) => t.result)).toBe(true)
    ft.forEach((s, j) => {
      expect(s.penalties).toEqual(others[j].result!.penalties)
      expect(mid[j].penalties).toBeUndefined()
    })
    const table = liveTable(g, u, ref, 50, { home: 1, away: 0 }, live.userIsHome, false)!
    expect(table.map((r) => r.teamId)).toEqual(roundTable(g, ref).map((r) => r.teamId))
    expect(table.every((r) => r.movement === 0 && !r.playing)).toBe(true)

    const f = seasonGame(u, 'md-friendly')
    playFriendly(f, u)
    const fref = roundRefOf(f.live!.ctx)
    expect(fref.friendly).toBe(true)
    expect(latestScores(f, u, fref, 30, false)).toEqual([])
    expect(liveTable(f, u, fref, 30, { home: 0, away: 0 }, true, false)).toBeNull()
  })

  it('a reload keeps the reveal: the compacted save holds the goals of the round in play and of the last round, league and cup', () => {
    const reloaded = (g: Game): Game => normaliseGame(JSON.parse(JSON.stringify(compactGame(g))) as Game)!
    const reveal = (g: Game, ref: ReturnType<typeof roundRefOf>) => [0, 23, 45, 61, 80, 94].map((m) => latestScores(g, u, ref, m, false)).concat([latestScores(g, u, ref, 90, true)])
    for (let i = 0; i < 3; i++) {
      // A league match in play, ten weeks in (older rounds are compacted to the score)
      const g = seasonGame(u, `md-reload-${i}`, 10 + i)
      playMatchweek(g, u)
      const live = g.live!
      const ref = roundRefOf(live.ctx, live.cupTieIndex)
      const shown = reveal(g, ref)
      expect(shown.at(-1)!.some((s) => s.goals.length > 0)).toBe(true)
      const back = reloaded(g)
      expect(reveal(back, ref)).toEqual(shown)
      const userScore = currentScore(live.mp)
      expect(liveTable(back, u, ref, 90, userScore, live.userIsHome, true)).toEqual(liveTable(g, u, ref, 90, userScore, live.userIsHome, true))
      // The replay of the round just finished reads the same after a reload too
      finishLiveMatch(g, u)
      const after = reloaded(g)
      expect(latestScores(after, u, ref, 90, true)).toEqual(latestScores(g, u, ref, 90, true))
    }
    // A cup tie in play: the other ties of its round keep their goals
    const c = seasonGame(u, 'md-cup', 5)
    playMatchweek(c, u)
    finishLiveMatch(c, u)
    expect(c.live?.kind).toBe('cup')
    const cref = roundRefOf(c.live!.ctx, c.live!.cupTieIndex)
    const cupShown = reveal(c, cref)
    expect(cupShown.at(-1)!.some((s) => s.goals.length > 0)).toBe(true)
    expect(reveal(reloaded(c), cref)).toEqual(cupShown)
  })
})
