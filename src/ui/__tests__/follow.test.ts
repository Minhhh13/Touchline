import { describe, expect, it } from 'vitest'
import { FOLLOW, follow, followCap, type Follow } from '../match/follow'
import { approach } from '../components/LivePitch'
import { dotPosition, swayPhase } from '../match/movement'
import { matchPath } from '../match/epochs'
import { onPitchAt } from '../match/pitchGeometry'
import { ballAt } from '../match/possession'
import { resultFeed } from './feeds'
import { REPLAY_RAMP, replayEase } from '../match/keyMoments'

const run = (start: Follow, tx: number, ty: number, frames: number, dt = 16) => {
  const out = [start]
  for (let i = 0; i < frames; i++) out.push(follow(out[out.length - 1], tx, ty, dt, FOLLOW.smooth, followCap(1)))
  return out
}

describe('the dots’ follow', () => {
  it('sets off gently where the old ease lurched, arrives and never overshoots', () => {
    const steps = run({ x: 0, y: 0, vx: 0, vy: 0 }, 5, 0, 120)
    // The first frame moves far less than an exponential ease with the same time constant
    expect(steps[1].x).toBeLessThan(approach(0, 5, 16, FOLLOW.smooth) / 2)
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].x).toBeGreaterThanOrEqual(steps[i - 1].x - 1e-9)
      expect(steps[i].x).toBeLessThanOrEqual(5 + 1e-9)
    }
    expect(steps.at(-1)!.x).toBeCloseTo(5, 2)
    // It gathers pace before it slows: the biggest step is not the first
    const moves = steps.slice(1).map((s, i) => s.x - steps[i].x)
    expect(moves.indexOf(Math.max(...moves))).toBeGreaterThan(1)
  })

  it('caps the speed of a long run, more at a faster playback', () => {
    for (const speed of [1, 4]) {
      let s: Follow = { x: 0, y: 50, vx: 0, vy: 0 }
      for (let i = 0; i < 200; i++) {
        const n = follow(s, 100, 50, 16, FOLLOW.smooth, followCap(speed))
        expect((n.x - s.x) / 16).toBeLessThanOrEqual(followCap(speed) * 1.05)
        s = n
      }
      expect(s.x).toBeGreaterThan(95)
    }
  })

  it('is near frame-rate independent and snaps with no smoothing', () => {
    const a = run({ x: 0, y: 0, vx: 0, vy: 0 }, 10, 4, 30, 16).at(-1)!
    const b = run({ x: 0, y: 0, vx: 0, vy: 0 }, 10, 4, 60, 8).at(-1)!
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.2)
    expect(follow({ x: 1, y: 1, vx: 3, vy: 3 }, 7, 8, 16, 0, 1)).toEqual({ x: 7, y: 8, vx: 0, vy: 0 })
    expect(follow({ x: 1, y: 1, vx: 3, vy: 3 }, 7, 8, 0, 100, 1)).toEqual({ x: 1, y: 1, vx: 3, vy: 3 })
  })

  it('on a real match the shown dots move with less jerk than the old ease', () => {
    const mpath = matchPath(resultFeed(3))
    const { home, away } = mpath.epochs[0]
    const men = [...onPitchAt(home, 0), ...onPitchAt(away, 0)].slice(0, 22)
    let jerkOld = 0
    let jerkNew = 0
    let peakOld = 0
    let peakNew = 0
    for (const p of men) {
      let old = { x: p.x, y: p.y }
      let fol: Follow = { x: p.x, y: p.y, vx: 0, vy: 0 }
      let vOld = 0
      let vNew = 0
      // 1x: 4500 ms a match minute, 60 frames a second, minutes 5 to 15
      for (let ms = 5 * 4500; ms < 15 * 4500; ms += 16) {
        const T = ms / 4500
        const t = dotPosition(p, mpath.path, ballAt(mpath.path, T), T, swayPhase(p.psId))
        const o = { x: approach(old.x, t.x, 16, FOLLOW.smooth), y: approach(old.y, t.y, 16, FOLLOW.smooth) }
        const n = follow(fol, t.x, t.y, 16, FOLLOW.smooth, followCap(1))
        const so = Math.hypot(o.x - old.x, o.y - old.y)
        const sn = Math.hypot(n.x - fol.x, n.y - fol.y)
        jerkOld += Math.abs(so - vOld)
        jerkNew += Math.abs(sn - vNew)
        peakOld = Math.max(peakOld, so)
        peakNew = Math.max(peakNew, sn)
        vOld = so
        vNew = sn
        old = o
        fol = n
      }
    }
    expect(jerkNew).toBeLessThan(jerkOld * 0.75)
    expect(peakNew).toBeLessThan(peakOld)
  })
})

describe('the goal replay’s slow motion', () => {
  it('opens a little quicker and slows into the strike, fixed at both ends and never going back', () => {
    expect(replayEase(0)).toBe(0)
    expect(replayEase(1)).toBe(1)
    let prev = -1
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const v = replayEase(u)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    const d = (u: number) => (replayEase(u + 0.001) - replayEase(u)) / 0.001
    expect(d(0)).toBeCloseTo(1 + REPLAY_RAMP, 2)
    expect(d(0.999)).toBeLessThan(0.7)
  })
})
