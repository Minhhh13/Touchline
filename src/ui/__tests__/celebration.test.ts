import { describe, expect, it } from 'vitest'
import { celebrationEnvelope, confetti, flightProgress, netBulge, netPoint, scorerRun } from '../match/celebration'
import { approach } from '../components/LivePitch'
import { GOAL_FLIGHT_MS, HOLD_MS } from '../match/clockStore'

describe('goal celebration helpers', () => {
  it('the celebration rises after the ball is in and is over before the kick-off, so nobody jumps when play resumes', () => {
    for (const ms of [HOLD_MS.ours, HOLD_MS.theirs, HOLD_MS.neutral]) {
      expect(celebrationEnvelope(0, ms, GOAL_FLIGHT_MS)).toBe(0)
      expect(celebrationEnvelope(GOAL_FLIGHT_MS, ms, GOAL_FLIGHT_MS)).toBe(0)
      expect(celebrationEnvelope(ms - 150, ms, GOAL_FLIGHT_MS)).toBe(0)
      expect(celebrationEnvelope(ms, ms, GOAL_FLIGHT_MS)).toBe(0)
      let last = 0
      let peak = 0
      for (let e = 0; e < ms; e += 10) {
        const v = celebrationEnvelope(e, ms, GOAL_FLIGHT_MS)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        // Smooth: never more than a few per cent a 10 ms step
        expect(Math.abs(v - last)).toBeLessThan(0.05)
        last = v
        peak = Math.max(peak, v)
      }
      expect(peak).toBeGreaterThan(ms === HOLD_MS.theirs ? 0.85 : 0.999)
    }
  })

  it('the net bulges out at once and settles within about a second; the flight lands on time', () => {
    expect(Math.abs(netBulge(-5))).toBe(0)
    expect(netBulge(0, 0.7)).toBeCloseTo(0.7)
    expect(Math.abs(netBulge(900))).toBeLessThan(0.05)
    expect(Math.abs(netBulge(1300))).toBe(0)
    expect(flightProgress(0, GOAL_FLIGHT_MS)).toBe(0)
    expect(flightProgress(GOAL_FLIGHT_MS, GOAL_FLIGHT_MS)).toBe(1)
    expect(flightProgress(GOAL_FLIGHT_MS / 2, GOAL_FLIGHT_MS)).toBeGreaterThan(0.6)
    expect(flightProgress(10, 0)).toBe(1)
    expect(netPoint({ x: 100, y: 52 }).x).toBeGreaterThan(100)
    expect(netPoint({ x: 0, y: 48 }).x).toBeLessThan(0)
  })

  it('the scorer runs towards the corner flag on the end he scored at; the confetti is the same every time in the scoring colours', () => {
    const from = { x: 88, y: 40 }
    expect(scorerRun(from, true, 0)).toEqual(from)
    const end = scorerRun(from, true, 1)
    expect(end.x).toBeGreaterThan(from.x)
    expect(end.y).toBeLessThan(from.y)
    expect(scorerRun({ x: 12, y: 70 }, false, 1).x).toBeLessThan(12)
    const c = confetti(['#ff0000', '#ffffff'])
    expect(c).toHaveLength(42)
    expect(confetti(['#ff0000', '#ffffff'])).toEqual(c)
    expect(new Set(c.map((p) => p.colour))).toEqual(new Set(['#ff0000', '#ffffff']))
  })

  it('eases on-screen positions towards their targets whatever the frame rate', () => {
    expect(approach(0, 10, 0, 100)).toBe(0)
    expect(approach(0, 10, 16, 0)).toBe(10)
    const oneBig = approach(0, 10, 32, 100)
    const twoSmall = approach(approach(0, 10, 16, 100), 10, 16, 100)
    expect(oneBig).toBeCloseTo(twoSmall, 10)
    expect(approach(0, 10, 100, 100)).toBeCloseTo(10 * (1 - Math.exp(-1)))
  })
})
