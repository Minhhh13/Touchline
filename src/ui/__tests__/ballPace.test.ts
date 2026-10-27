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
import { matchPace, toMatch, toPicture } from '../match/timing'

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

  /** Over-full minutes: a goal followed by two more shots in the same minute (the engine logs a segment's goals before its chances). */
  const crowded = (res: FullMatchResult, minute: number) => {
    const shots = res.events.filter((e) => e.minute === minute && ['goal', 'penalty', 'own_goal', 'chance', 'save'].includes(e.type))
    const g = shots.findIndex((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
    return g >= 0 && shots.length - g - 1 >= 2
  }

  it('never has to cross the pitch in a blur to reach a strike, on screen: a crowded minute plays longer instead of squeezing', { timeout: 120_000 }, () => {
    let fast = 0
    let worst = 0
    let hops = 0
    let crowdedHops = 0
    for (const { path, res } of segments) {
      const pace = matchPace(res.events)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]
        const b = path[i]
        // The goal itself is drawn during the hold, and the ball is placed on the spot for the kick-off
        if (b.kind === 'goal' || (b.kind === 'kickoff' && a.kind === 'goal')) continue
        const d = Math.hypot(b.x - a.x, b.y - a.y)
        if (d < 3) continue
        hops++
        if (crowded(res, Math.floor(b.t))) crowdedHops++
        // Speed as the viewer sees it: over the picture's time between the keyframes
        const v = d / (toPicture(pace, b.t) - toPicture(pace, a.t)) / PASS_SPEED
        if (v > 3.5) fast++
        worst = Math.max(worst, v)
      }
    }
    expect(hops).toBeGreaterThan(3000)
    // Any over-full minute in these matches is drawn like any other (none on engine 6 for these seeds; the next test makes one)
    expect(crowdedHops).toBeGreaterThanOrEqual(0)
    // A handful of driven long balls at most (one in four matches), nothing like a teleport
    expect(fast).toBeLessThanOrEqual(matches.length / 4)
    expect(worst).toBeLessThan(8)
  })

  it('draws an over-full minute (a goal, then two more shots in it) at a walking pace, every strike in its minute and in order', () => {
    const res = matches[0]
    const sides = separateSides(placeSide(res.homeReport.appearances!, res.homeReport.tactics!, 'home'), placeSide(res.awayReport.appearances!, res.awayReport.tactics!, 'away'))
    const shooter = (side: 'home' | 'away') => sides[side].find((p) => p.position !== 'GK')!
    // A quiet minute of the first half, then the crowd: our goal, their chance at the other end, our save
    const busy = new Set(res.events.map((e) => e.minute))
    let m = 20
    while (busy.has(m) || busy.has(m + 1) || busy.has(m + 2)) m++
    const extra: FullMatchResult['events'] = [
      { minute: m, type: 'goal', side: 'home', playerId: shooter('home').psId, text: 'Goal!', position: { x: 90, y: 45 } },
      { minute: m, type: 'chance', side: 'away', playerId: shooter('away').psId, text: 'Fires wide.', position: { x: 82, y: 40 } },
      { minute: m, type: 'save', side: 'home', playerId: shooter('home').psId, text: 'The keeper saves.', position: { x: 84, y: 60 } },
    ]
    const events = [...res.events.filter((e) => e.minute < m), ...extra, ...res.events.filter((e) => e.minute > m)]
    expect(crowded({ ...res, events }, m)).toBe(true)
    const pace = matchPace(events)
    const span = pace.find((s) => s.from === m)!
    expect(span.w).toBeGreaterThan(1)
    // Paid back by the quiet minute after it
    expect(pace.some((s) => s.from === m + 1 && s.w < 1)).toBe(true)
    const times = [...strikeTimes(events, 0, 45)].filter(([idx]) => events[idx].minute === m).sort((a, b) => a[1] - b[1])
    expect(times.map(([idx]) => events[idx].type)).toEqual(['goal', 'chance', 'save'])
    for (const [, t] of times) expect(Math.floor(t)).toBe(m)
    const path = buildBallPath({ from: 0, to: 45, momentum: res.momentum ?? [], events, home: sides.home, away: sides.away, seed: 'crowd' })
    let worst = 0
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]
      const b = path[i]
      if (b.t < m || a.t >= m + 1 || b.kind === 'goal' || (b.kind === 'kickoff' && a.kind === 'goal')) continue
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d < 3) continue
      worst = Math.max(worst, d / (toPicture(pace, b.t) - toPicture(pace, a.t)) / PASS_SPEED)
    }
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(3)
    // The strikes are on the path at exactly their moments
    for (const [, t] of times) expect(path.some((k) => k.kind === 'shot' && k.t === t)).toBe(true)
  })

  it('stretches a crowded minute and pays the time back over the quiet minutes after it', () => {
    let stretched = 0
    for (const res of matches) {
      const pace = matchPace(res.events)
      for (const s of pace) {
        expect(s.to - s.from).toBe(1)
        expect(s.w).toBeGreaterThan(0.74)
        expect(s.w).toBeLessThanOrEqual(3)
        // A quicker minute has no shot or card in it
        if (s.w < 1) expect(res.events.some((e) => e.minute === s.from && ['goal', 'penalty', 'own_goal', 'chance', 'save', 'yellow', 'red'].includes(e.type))).toBe(false)
        else stretched++
      }
      // Picture and match time are inverses
      for (let t = 0; t <= 95; t += 0.37) expect(toMatch(pace, toPicture(pace, t))).toBeCloseTo(t, 9)
    }
    expect(stretched).toBeGreaterThan(0)
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
