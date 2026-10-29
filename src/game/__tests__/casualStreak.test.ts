import { describe, expect, it } from 'vitest'
import { arenaDailySeed, previousArenaDailySeed, previousWeeklySeed, weeklySeed } from '@engine/rng'
import { fileStreakResult } from '../logic/streaks'
import { streakStanding } from '../logic/casualStreak'
import { dailyArenaResult } from '../logic/arenaDaily'
import type { StreakResults } from '../types'

type ArenaResult = { format: 'cup' | 'gauntlet'; score: number; label: string }

describe('streakStanding: the Daily Arena and Weekly summaries\' line (r9)', () => {
  it('is null until the book holds a result for the seed', () => {
    expect(streakStanding(undefined, 'arena-2026-10-29', { format: 'cup', score: 1, label: 'Quarter-finalists' })).toBeNull()
    const book: StreakResults<ArenaResult> = { streak: 3, last: 'arena-2026-10-28', results: { 'arena-2026-10-28': { format: 'gauntlet', score: 5, label: '5 rungs' } } }
    expect(streakStanding(book, 'arena-2026-10-29', { format: 'cup', score: 1, label: 'x' })).toBeNull()
  })

  it('reads the first run of a day as counted, a different second run as practice, over a month of days', () => {
    let book: StreakResults<ArenaResult> | undefined
    let day = new Date('2026-10-01T12:00:00Z')
    for (let i = 0; i < 30; i++) {
      const seed = arenaDailySeed(day)
      const first = dailyArenaResult({ format: i % 2 ? 'cup' : 'gauntlet', size: i % 2 ? 16 : undefined, won: false, log: Array.from({ length: (i % 4) + 1 }, (_, k) => ({ gf: k < i % 4 ? 2 : 0, ga: 1 })) as never })
      book = fileStreakResult(book, seed, first, previousArenaDailySeed, seed, arenaDailySeed(new Date(day.getTime() - 86400000))).book
      const s = streakStanding(book, seed, first)!
      expect(s).toEqual({ counted: first, streak: i + 1, practice: false })
      const second: ArenaResult = { ...first, score: first.score + 1, label: `${first.label}!` }
      const after = fileStreakResult(book, seed, second, previousArenaDailySeed, seed, seed).book
      expect(after).toBe(book)
      expect(streakStanding(after, seed, second)).toEqual({ counted: first, streak: i + 1, practice: true })
      day = new Date(day.getTime() + 86400000)
    }
  })

  it('works on the Weekly book', () => {
    const seed = weeklySeed(new Date('2026-10-29T00:00:00Z'))
    const { book } = fileStreakResult(undefined, seed, { points: 71, tier: 'TITLE_RACE' as const }, previousWeeklySeed, seed, 'weekly-2026-W43')
    expect(streakStanding(book, seed, { points: 71, tier: 'TITLE_RACE' })).toEqual({ counted: { points: 71, tier: 'TITLE_RACE' }, streak: 1, practice: false })
    expect(streakStanding(book, seed, { points: 80, tier: 'CHAMPIONS' })?.practice).toBe(true)
  })
})
