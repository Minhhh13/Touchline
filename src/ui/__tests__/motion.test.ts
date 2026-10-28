import { describe, expect, it } from 'vitest'
import { DURATION, celebrationFor, confettiPieces, countUpValue, easeOutCubic, prefersReducedMotion, withViewTransition } from '../motion'
import type { SeasonTier } from '@engine/types'

describe('site motion helpers', () => {
  it('ease-out starts at 0, ends at 1, only rises and is clamped outside 0..1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-2)).toBe(0)
    expect(easeOutCubic(3)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 100; i++) {
      const v = easeOutCubic(i / 100)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    // Ease-out: more than half the way there at the half-way point
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  it('a count-up shows whole numbers from 0, never passes the target and lands on it exactly', () => {
    for (const target of [0, 1, 7, 31, 38, 114]) {
      let prev = 0
      for (let t = -50; t <= DURATION.slow + 50; t += 16) {
        const v = countUpValue(target, t, DURATION.slow)
        expect(Number.isInteger(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(prev)
        expect(v).toBeLessThanOrEqual(target)
        prev = v
      }
      expect(countUpValue(target, 0, DURATION.slow)).toBe(0)
      expect(countUpValue(target, DURATION.slow, DURATION.slow)).toBe(target)
    }
    // No duration means no animation
    expect(countUpValue(31, 0, 0)).toBe(31)
  })

  it('confetti for the perfect season, a flare for the other titles, nothing for the rest', () => {
    const expected: Record<SeasonTier, ReturnType<typeof celebrationFor>> = {
      PERFECT: 'confetti',
      INVINCIBLE: 'flare',
      CHAMPIONS: 'flare',
      TITLE_RACE: null,
      EUROPEAN: null,
      MID_TABLE: null,
      RELEGATION_BATTLE: null,
      RELEGATED: null,
    }
    for (const [tier, kind] of Object.entries(expected) as Array<[SeasonTier, ReturnType<typeof celebrationFor>]>) expect(celebrationFor(tier)).toBe(kind)
    // A first result ever: the flare whatever the tier, the confetti still the perfect season's
    for (const tier of Object.keys(expected) as SeasonTier[]) expect(celebrationFor(tier, true)).toBe(tier === 'PERFECT' ? 'confetti' : 'flare')
  })

  it('the confetti burst is the same every time, spread all round and kept inside the banner', () => {
    const a = confettiPieces(28)
    expect(a).toEqual(confettiPieces(28))
    expect(a).toHaveLength(28)
    const quadrants = new Set(a.map((p) => `${Math.sign(p.dx)}${Math.sign(p.dy)}`))
    for (const q of ['11', '1-1', '-11', '-1-1']) expect(quadrants.has(q)).toBe(true)
    for (const p of a) {
      expect(Math.abs(p.dx)).toBeLessThanOrEqual(240)
      expect(p.dy).toBeGreaterThanOrEqual(-100)
      expect(p.dy).toBeLessThanOrEqual(120)
      expect(p.delay).toBeGreaterThanOrEqual(0)
      expect(p.delay).toBeLessThan(DURATION.slow)
      expect([0, 1, 2]).toContain(p.colour)
    }
    // Every colour is used
    expect(new Set(a.map((p) => p.colour)).size).toBe(3)
  })

  it('without a browser the helpers fall back to doing the change at once', () => {
    expect(prefersReducedMotion()).toBe(false)
    let ran = 0
    withViewTransition(() => ran++)
    expect(ran).toBe(1)
  })
})
