import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '@game/logic/setup'
import { advanceLiveMatch, applyEventChoice, closeLiveMatch, playMatchweek, startSeasonProper } from '@game/logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import type { FullMatchResult } from '@engine/match'
import type { GameSettings } from '@game/types'
import { ballAt, buildBallPath, PASS_SPEED, strikeTimes } from '../match/possession'
import { placeSide, separateSides } from '../match/pitchGeometry'

const u = loadTestUniverse()

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

/** Real matches, played the way the live screen plays them. */
function realMatches(n: number): FullMatchResult[] {
  const out: FullMatchResult[] = []
  for (let s = 0; out.length < n; s++) {
    const g = createGame(settings(`pace-${s}`))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    for (let w = 0; w < 3 && out.length < n; w++) {
      if (g.pendingEvent) applyEventChoice(g, u, g.pendingEvent.choices[0].id)
      playMatchweek(g, u, false)
      while (g.live) advanceLiveMatch(g, u, undefined)
      closeLiveMatch(g, u)
      out.push(g.lastMatch!)
    }
  }
  return out
}

describe('the live ball over real matches', () => {
  const matches = realMatches(30)
  const segments = matches.flatMap((res) => {
    const sides = separateSides(placeSide(res.homeReport.appearances!, res.homeReport.tactics!, 'home'), placeSide(res.awayReport.appearances!, res.awayReport.tactics!, 'away'))
    return ([[0, 45], [46, 70], [71, 95]] as const).map(([from, to]) => ({ res, sides, from, to, path: buildBallPath({ from, to, momentum: res.momentum ?? [], events: res.events, home: sides.home, away: sides.away, seed: `pace-${from}` }) }))
  })

  /**
   * Minutes no path can draw at a walking pace while every strike stays in its minute and in order: a goal followed by
   * two more shots in the same minute (the engine logs a segment's goals before its chances), since the kick-off and
   * the run to the next strike alone take about a minute. Engine 5's matches for these seeds hold one (Eze's goal at 5'
   * then two chances); the pitch squeezes it, and the hops into it are left out below.
   */
  const crowded = (res: FullMatchResult, minute: number) => {
    const shots = res.events.filter((e) => e.minute === minute && ['goal', 'penalty', 'own_goal', 'chance', 'save'].includes(e.type))
    const g = shots.findIndex((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
    return g >= 0 && shots.length - g - 1 >= 2
  }

  it('never has to cross the pitch in a blur to reach a strike: shots close together are spread within their minutes', { timeout: 120_000 }, () => {
    let fast = 0
    let worst = 0
    let hops = 0
    const over = new Set<string>()
    for (const { path, res } of segments) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]
        const b = path[i]
        // The goal itself is drawn during the hold, and the ball is placed on the spot for the kick-off
        if (b.kind === 'goal' || (b.kind === 'kickoff' && a.kind === 'goal')) continue
        if (crowded(res, Math.floor(b.t))) {
          over.add(`${matches.indexOf(res)}@${Math.floor(b.t)}`)
          continue
        }
        const d = Math.hypot(b.x - a.x, b.y - a.y)
        if (d < 3) continue
        hops++
        const v = d / (b.t - a.t) / PASS_SPEED
        if (v > 3.5) fast++
        worst = Math.max(worst, v)
      }
    }
    expect(hops).toBeGreaterThan(3000)
    // A handful of driven long balls at most (one in four matches), nothing like a teleport
    expect(fast).toBeLessThanOrEqual(matches.length / 4)
    expect(worst).toBeLessThan(8)
    // Over-full minutes stay rare: at most one in ten matches
    expect(over.size).toBeLessThanOrEqual(matches.length / 10)
  })

  it('keeps every strike inside its own minute, in order', () => {
    for (const { res, from, to } of segments) {
      const times = [...strikeTimes(res.events, from, to)].sort((a, b) => a[1] - b[1])
      for (let i = 0; i < times.length; i++) {
        const [idx, t] = times[i]
        expect(Math.floor(t)).toBe(res.events[idx].minute)
        if (i) expect(t).toBeGreaterThan(times[i - 1][1])
      }
    }
  })

  it("gives the ball to a man of the side that has it, so a player who turns out for both sides (drafted from today's opponent) is told apart", () => {
    let held = 0
    for (const { sides, path, from, to } of segments) {
      const ids = { home: new Set(sides.home.map((p) => p.psId)), away: new Set(sides.away.map((p) => p.psId)) }
      for (const k of path) if (k.holder) expect(ids[k.side].has(k.holder)).toBe(true)
      for (let t = from; t < Math.min(to, 90) + 1; t += 0.05) {
        const b = ballAt(path, t)!
        if (!b.holder) continue
        held++
        expect(ids[b.side].has(b.holder)).toBe(true)
      }
    }
    expect(held).toBeGreaterThan(1000)
  })
})
