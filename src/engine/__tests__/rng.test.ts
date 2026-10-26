import { describe, expect, it } from 'vitest'
import { Rng, arenaDailyDateOf, arenaDailySeed, dailySeed, hashString, isoWeekOf, previousArenaDailySeed, previousWeeklySeed, weeklyDateOf, weeklySeed } from '../rng'

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

describe('Daily Arena and weekly seeds', () => {
  const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

  it('makes Daily Arena seeds by the UTC day, reads them back and steps back a day across month and year ends', () => {
    expect(arenaDailySeed(day(2026, 10, 25))).toBe('arena-2026-10-25')
    // Late on the 25th west of Greenwich is already the 26th in UTC
    expect(arenaDailySeed(new Date(Date.UTC(2026, 9, 25, 23, 59)))).toBe('arena-2026-10-25')
    expect(arenaDailyDateOf('arena-2026-10-25')?.getTime()).toBe(day(2026, 10, 25).getTime())
    expect(previousArenaDailySeed('arena-2026-11-01')).toBe('arena-2026-10-31')
    expect(previousArenaDailySeed('arena-2027-01-01')).toBe('arena-2026-12-31')
    expect(previousArenaDailySeed('arena-2028-03-01')).toBe('arena-2028-02-29')
    // Not a day: another kind of seed, or a date that does not exist
    for (const s of ['daily-2026-10-25', 'K7Q2-MX9A', 'arena-2026-02-30', 'arena-2026-13-01']) {
      expect(arenaDailyDateOf(s), s).toBeNull()
      expect(previousArenaDailySeed(s), s).toBeNull()
    }
  })

  it('numbers ISO weeks Monday to Sunday by their Thursday, with 2026-W53 spanning the new year', () => {
    expect(isoWeekOf(day(2026, 10, 25))).toEqual({ year: 2026, week: 43 }) // a Sunday: the end of its week
    expect(isoWeekOf(day(2026, 10, 26))).toEqual({ year: 2026, week: 44 }) // the Monday after
    expect(isoWeekOf(day(2026, 12, 28))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(day(2026, 12, 31))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(day(2027, 1, 1))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(day(2027, 1, 3))).toEqual({ year: 2026, week: 53 })
    expect(isoWeekOf(day(2027, 1, 4))).toEqual({ year: 2027, week: 1 })
    // A year that starts on a Friday hands its first days to the year before: 2027-W52
    expect(isoWeekOf(day(2028, 1, 1))).toEqual({ year: 2027, week: 52 })
    expect(isoWeekOf(day(2025, 12, 29))).toEqual({ year: 2026, week: 1 })
    expect(weeklySeed(day(2026, 12, 31))).toBe('weekly-2026-W53')
    expect(weeklySeed(day(2027, 1, 1))).toBe('weekly-2026-W53')
    expect(weeklySeed(day(2027, 1, 4))).toBe('weekly-2027-W01')
  })

  it('reads a weekly seed back to its Monday, steps back a week and refuses a week the year does not have', () => {
    expect(weeklyDateOf('weekly-2026-W44')?.getTime()).toBe(day(2026, 10, 26).getTime())
    expect(weeklyDateOf('weekly-2026-W53')?.getTime()).toBe(day(2026, 12, 28).getTime())
    expect(weeklyDateOf('weekly-2027-W01')?.getTime()).toBe(day(2027, 1, 4).getTime())
    expect(weeklyDateOf('weekly-2026-W01')?.getTime()).toBe(day(2025, 12, 29).getTime())
    expect(previousWeeklySeed('weekly-2027-W01')).toBe('weekly-2026-W53')
    expect(previousWeeklySeed('weekly-2026-W01')).toBe('weekly-2025-W52')
    expect(previousWeeklySeed('weekly-2026-W44')).toBe('weekly-2026-W43')
    // Every day of a week names the same seed, and that seed's Monday
    for (let d = 26; d <= 31; d++) expect(weeklySeed(day(2026, 10, d))).toBe('weekly-2026-W44')
    expect(weeklySeed(day(2026, 11, 1))).toBe('weekly-2026-W44')
    for (const s of ['weekly-2027-W53', 'weekly-2026-W00', 'weekly-2026-W54', 'weekly-2026-44', 'daily-2026-10-25']) {
      expect(weeklyDateOf(s), s).toBeNull()
      expect(previousWeeklySeed(s), s).toBeNull()
    }
  })
})
