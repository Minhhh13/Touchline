import { describe, expect, it } from 'vitest'
import { matchPath } from '../match/epochs'
import { strikeTimes, type BallKeyframe } from '../match/possession'
import { ALWAYS, BALL_GAP_MS, ballCues, dueBallCues, dueGoals, dueSwells, speedScale, swellCues, DANGER_FROM } from '../sound/ball'
import { resultFeed } from './feeds'

const feeds = Array.from({ length: 8 }, (_, i) => resultFeed(i))
const paths = feeds.map((f) => matchPath(f).path)
const at = (t: number) => ({ t, hold: null })

describe('the ball’s sounds', () => {
  it('kick as the ball leaves each keyframe, typed by the hop, and strike on every shot the pitch draws', () => {
    for (let i = 0; i < feeds.length; i++) {
      const path = paths[i]
      const cues = ballCues(path)
      expect(cues.length).toBeGreaterThan(100)
      // Sorted, and never on a reset
      for (let k = 1; k < cues.length; k++) expect(cues[k].t).toBeGreaterThanOrEqual(cues[k - 1].t)
      const strikes = cues.filter((c) => c.touch === 'strike' || (c.touch === 'header' && c.power > 0.6))
      // Every shot the engine decided is struck on the pitch at its strike moment, and sounds there
      for (const [, t] of strikeTimes(feeds[i].events, 0, 95)) expect(strikes.some((c) => Math.abs(c.t - t) < 0.02), `strike at ${t}`).toBe(true)
      for (const c of cues) {
        expect(c.power).toBeGreaterThan(0)
        expect(c.power).toBeLessThanOrEqual(1)
      }
      // A save arriving is the keeper's gloves
      const saves = path.filter((k) => k.kind === 'save')
      expect(cues.filter((c) => c.touch === 'keeper')).toHaveLength(saves.length)
    }
  })

  it('a set piece kicks when it is taken, not when it is set up, and a throw is a throw', () => {
    const path: BallKeyframe[] = [
      { t: 10, x: 50, y: 0, kind: 'pass', side: 'home', setPiece: { kind: 'throw', until: 10.3 } },
      { t: 10.4, x: 55, y: 10, kind: 'pass', side: 'home' },
      { t: 10.6, x: 90, y: 50, kind: 'shot', side: 'home' },
      { t: 10.7, x: 99.5, y: 55, kind: 'miss', side: 'home' },
      { t: 10.9, x: 86, y: 50, kind: 'pass', side: 'away', play: 'rebound' },
    ]
    const cues = ballCues(path)
    expect(cues.map((c) => [c.t, c.touch])).toEqual([
      [10.3, 'throw'],
      [10.4, 'pass'],
      [10.6, 'strike'],
      [10.7, 'woodwork'],
      [10.7, 'pass'],
    ])
  })

  it('swells the crowd once each time an attack gets into the box, for both sides', () => {
    for (const path of paths) {
      const swells = swellCues(path)
      expect(swells.length).toBeGreaterThan(3)
      for (const s of swells) {
        expect(s.danger).toBeGreaterThan(0)
        expect(s.danger).toBeLessThanOrEqual(1)
        const k = path.find((x) => x.t === s.t)!
        expect(k.side === 'home' ? k.x : 100 - k.x).toBeGreaterThanOrEqual(DANGER_FROM)
      }
    }
  })

  it('thins a busy spell, keeps the strikes, goes quiet at speed, and never sounds through a hold, a skip or a step back', () => {
    const cues = ballCues(paths[0])
    // One frame a 16 ms step at 1x, a minute every 4.5 s: count what sounds over the first half
    const last: { at?: number } = {}
    let heard = 0
    let real = 0
    for (let t = 0; t < 45; t += 16 / 4500) {
      real += 16
      const due = dueBallCues(at(t), at(t + 16 / 4500), cues, 1, real, last)
      heard += due.length
    }
    const inHalf = cues.filter((c) => c.t > 0 && c.t <= 45)
    expect(heard).toBeLessThanOrEqual(inHalf.length)
    expect(heard).toBeGreaterThan(inHalf.length * 0.3)
    // Never two ordinary touches closer than the gap
    const l2: { at?: number } = {}
    const times: number[] = []
    for (let t = 0, ms = 0; t < 45; t += 16 / 1100, ms += 16) for (const c of dueBallCues(at(t), at(t + 16 / 1100), cues, 4, ms, l2)) if (!ALWAYS.has(c.touch)) times.push(ms)
    for (let k = 1; k < times.length; k++) expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(BALL_GAP_MS)
    // Every strike still sounds at 4x
    const strike = cues.find((c) => c.touch === 'strike')!
    expect(dueBallCues(at(strike.t - 0.01), at(strike.t + 0.01), cues, 4, 1e9, {}).some((c) => c.touch === 'strike')).toBe(true)
    // Silence through a hold, a skip and a step back
    expect(dueBallCues({ t: strike.t, hold: { index: 0, elapsed: 10 } }, { t: strike.t, hold: { index: 0, elapsed: 30 } }, cues, 1, 0, {})).toEqual([])
    expect(dueBallCues(at(1), at(30), cues, 1, 0, {})).toEqual([])
    expect(dueBallCues(at(30), at(29), cues, 1, 0, {})).toEqual([])
    expect(dueSwells(at(1), at(30), swellCues(paths[0]))).toEqual([])
    expect(speedScale(1)).toBe(1)
    expect(speedScale(4)).toBeLessThan(speedScale(2))
  })

  it('finds the goals arriving in the net for the highlights reel', () => {
    const path = paths.find((p) => p.some((k) => k.kind === 'goal'))!
    const g = path.find((k) => k.kind === 'goal')!
    expect(dueGoals(at(g.t - 0.05), at(g.t + 0.05), path)).toEqual([g])
    expect(dueGoals(at(g.t + 0.05), at(g.t + 0.1), path)).toEqual([])
  })
})
