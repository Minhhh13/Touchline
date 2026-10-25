import { describe, expect, it } from 'vitest'
import { Rng, dailySeed, hashString } from '../rng'

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng('touchline')
    const b = new Rng('touchline')
    const xs = Array.from({ length: 20 }, () => a.next())
    const ys = Array.from({ length: 20 }, () => b.next())
    expect(xs).toEqual(ys)
  })
  it('differs for different seeds', () => {
    expect(new Rng('a').next()).not.toBe(new Rng('b').next())
  })
  it('produces uniform-ish floats and bounded ints', () => {
    const r = new Rng(42)
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      sum += v
    }
    expect(sum / n).toBeGreaterThan(0.48)
    expect(sum / n).toBeLessThan(0.52)
    for (let i = 0; i < 1000; i++) {
      const k = r.int(3, 7)
      expect(k).toBeGreaterThanOrEqual(3)
      expect(k).toBeLessThanOrEqual(7)
    }
  })
  it('poisson has the right mean', () => {
    const r = new Rng('poisson')
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) sum += r.poisson(1.5)
    expect(sum / n).toBeGreaterThan(1.42)
    expect(sum / n).toBeLessThan(1.58)
  })
  it('restores state', () => {
    const r = new Rng('state')
    r.next()
    const s = r.getState()
    const a = r.next()
    const b = Rng.fromState(s).next()
    expect(a).toBe(b)
  })
  it('hashes strings stably and makes daily seeds', () => {
    expect(hashString('hello')).toBe(hashString('hello'))
    expect(dailySeed(new Date(Date.UTC(2026, 9, 24)))).toBe('daily-2026-10-24')
  })
})
