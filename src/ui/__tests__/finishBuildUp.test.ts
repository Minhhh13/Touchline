import { describe, expect, it } from 'vitest'
import type { MatchEvent } from '@engine/types'
import { finishHeight, finishOf, goalFlightAt, NET_DROP_MS } from '../match/finish'
import { BUILD_UP, buildUpAt, focusMoments, shooterRing, type FocusMoment } from '../match/keyMoments'
import { resultFeed } from './feeds'

const goal = (text: string, type: MatchEvent['type'] = 'goal'): MatchEvent => ({ minute: 30, type, side: 'home', text: `GOAL! A. Striker ${text}.` })

describe('how a goal goes in', () => {
  it('reads the finish from the goal line: the roof rises to the net, a chip loops, a tap-in stays on the grass', () => {
    const roof = finishOf(goal('thumps it into the roof of the net'))
    const chip = finishOf(goal('chips the keeper with real class'))
    const tap = finishOf(goal('taps in from close range'))
    const low = finishOf(goal('finishes low into the corner'))
    const curl = finishOf(goal('curls one in from the edge of the box'))
    expect(finishHeight(roof, 1)).toBeGreaterThan(0.5)
    expect(finishHeight(low, 1)).toBeLessThan(0.1)
    expect(finishHeight(tap, 0.5)).toBe(0)
    // The chip is the highest ball half-way
    for (const f of [roof, tap, low, curl]) expect(finishHeight(chip, 0.5)).toBeGreaterThan(finishHeight(f, 0.5))
    expect(curl.bend).toBeGreaterThan(roof.bend)
    expect(low.wide).toBeGreaterThan(tap.wide)
    // A penalty is the same on every viewing
    const pen = { minute: 61, type: 'penalty' as const, side: 'away' as const, text: 'GOAL! Penalty.' }
    expect(finishOf(pen)).toEqual(finishOf({ ...pen }))
    expect(finishOf(undefined).loft).toBeGreaterThanOrEqual(0)
  })

  it('flies from the strike into the net on time, inside the posts, never backwards, and drops to the floor of the net', () => {
    const shot = { x: 86, y: 40 }
    const mouth = { x: 100, y: 49 }
    for (const text of ['thumps it into the roof of the net', 'chips the keeper with real class', 'curls one in from the edge of the box', 'finishes low into the corner', 'slots it past the keeper']) {
      const fin = finishOf(goal(text))
      const start = goalFlightAt(shot, mouth, 'home', fin, 0)
      expect(start.at.x).toBeCloseTo(shot.x)
      expect(start.h).toBe(0)
      let prevX = start.at.x
      for (let x = 0.05; x <= 1.0001; x += 0.05) {
        const p = goalFlightAt(shot, mouth, 'home', fin, x)
        expect(p.at.x).toBeGreaterThanOrEqual(prevX - 1e-9)
        expect(p.h).toBeGreaterThanOrEqual(0)
        expect(p.h).toBeLessThan(1.2)
        prevX = p.at.x
      }
      const end = goalFlightAt(shot, mouth, 'home', fin, 1)
      expect(end.at.x).toBeGreaterThan(100)
      // Inside the posts (they stand 5.4 either side of the middle)
      expect(Math.abs(end.at.y - 50)).toBeLessThan(5.4)
      expect(goalFlightAt(shot, mouth, 'home', fin, 1, NET_DROP_MS).h).toBe(0)
    }
    // The away side scores at the other end
    expect(goalFlightAt({ x: 14, y: 60 }, { x: 0, y: 52 }, 'away', finishOf(goal('slots it past the keeper')), 1).at.x).toBeLessThan(0)
  })
})

describe('the build-up to a big moment', () => {
  const m = (t: number, goal = false): FocusMoment => ({ t, at: { x: 90, y: 50 }, goal, side: 'home', shooter: 'p1' })

  it('rises into the strike and is gone soon after, picking the moment nearest its strike', () => {
    const ms = [m(20), m(30, true)]
    expect(buildUpAt(ms, 10, 0.5, 0.1)).toBeNull()
    expect(buildUpAt(ms, 19.4, 0.5, 0.1)).toBeNull()
    const rising = [19.6, 19.75, 19.9, 20].map((t) => buildUpAt(ms, t, 0.5, 0.1)!.w)
    for (let i = 1; i < rising.length; i++) expect(rising[i]).toBeGreaterThan(rising[i - 1])
    expect(rising[3]).toBe(1)
    expect(buildUpAt(ms, 20.05, 0.5, 0.1)!.w).toBeLessThan(1)
    expect(buildUpAt(ms, 20.2, 0.5, 0.1)).toBeNull()
    expect(buildUpAt(ms, 29.9, 0.5, 0.1)!.moment.goal).toBe(true)
  })

  it('closes the ring on the shooter as the strike nears', () => {
    expect(shooterRing(0)).toEqual({ scale: 2.4, opacity: 0 })
    expect(shooterRing(1).scale).toBe(1)
    expect(shooterRing(0.5).scale).toBeGreaterThan(1)
    expect(BUILD_UP.leadMs).toBeGreaterThan(BUILD_UP.tailMs)
  })

  it('names the side and the shooter of every big moment of real matches', () => {
    let n = 0
    for (const f of [0, 1, 2, 3, 4, 5].map(resultFeed)) {
      for (const mo of focusMoments(f.events, [{ from: 0, to: 45 }, { from: 46, to: 70 }, { from: 71, to: 95 }])) {
        n++
        expect(['home', 'away']).toContain(mo.side)
        expect(mo.shooter).toBeTruthy()
      }
    }
    expect(n).toBeGreaterThan(5)
  })
})
