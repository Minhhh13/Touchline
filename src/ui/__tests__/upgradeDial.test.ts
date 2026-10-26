import { describe, expect, it } from 'vitest'
import { DEG_PER_ROLL, DIAL_TURNS, dialTravel, inWinArc, landingAngle, needleAngle, rollAt, ticksPassed, TICK_DEG } from '../upgradeDial'
import { drawJanuaryUpgrade } from '@game/logic/januaryGamble'
import { Rng } from '@engine/rng'

describe('the Upgrader dial', () => {
  it('lands every roll inside its own cell, and inside the win arc exactly when the roll won', () => {
    for (let roll = 0; roll < 100; roll++) {
      const a = landingAngle(roll)
      expect(rollAt(a)).toBe(roll)
      // Never on a cell's edge: at least a fifth of a cell from either side
      expect(a - roll * DEG_PER_ROLL).toBeGreaterThanOrEqual(0.2 * DEG_PER_ROLL - 1e-9)
      expect((roll + 1) * DEG_PER_ROLL - a).toBeGreaterThanOrEqual(0.19 * DEG_PER_ROLL)
      for (let chance = 1; chance <= 95; chance++) expect(inWinArc(a, chance)).toBe(roll < chance)
    }
  })

  it('shows the outcome the logic rolled, over many real rolls', () => {
    for (let i = 0; i < 2000; i++) {
      const r = drawJanuaryUpgrade(new Rng(`dial-${i}`), 'p', 50 + (i % 45), ([2, 5, 10] as const)[i % 3])
      expect(inWinArc(needleAngle(9999, 5000, r.roll), r.chance)).toBe(r.won)
    }
  })

  it('spins several turns with a long ease-out, monotonic, exact at both ends', () => {
    const total = 5000
    expect(needleAngle(0, total, 42)).toBe(0)
    expect(needleAngle(total, total, 42)).toBe(dialTravel(42))
    expect(dialTravel(42)).toBeGreaterThan(DIAL_TURNS * 360)
    let last = -1
    for (let ms = 0; ms <= total; ms += 25) {
      const a = needleAngle(ms, total, 42)
      expect(a).toBeGreaterThanOrEqual(last)
      last = a
    }
    // Most of the travel is done in the first third; the last fifth only creeps
    expect(needleAngle(total / 3, total, 42) / dialTravel(42)).toBeGreaterThan(0.6)
    expect(1 - needleAngle(total * 0.8, total, 42) / dialTravel(42)).toBeLessThan(0.02)
    // A spin with no time (reduced motion) is at its stop at once
    expect(needleAngle(10, 0, 42)).toBe(dialTravel(42))
    expect(ticksPassed(TICK_DEG * 3 + 1)).toBe(3)
  })
})
