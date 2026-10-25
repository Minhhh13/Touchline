import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { dailySeed, previousDailySeed } from '@engine/rng'
import { advanceStreak, streakDay } from '../logic/streaks'
import { dailyGameSettings } from '../logic/setup'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const FALLBACK = 'daily-2000-01-01'

describe('streaks', () => {
  it('grows the streak on consecutive days', () => {
    let book: { streak: number; last: string | null } = { streak: 0, last: null }
    for (const day of ['daily-2026-10-29', 'daily-2026-10-30', 'daily-2026-10-31', 'daily-2026-11-01']) book = advanceStreak(book, day, previousDailySeed, FALLBACK)
    expect(book).toEqual({ streak: 4, last: 'daily-2026-11-01' })
    // Across a year end too
    expect(advanceStreak({ streak: 9, last: 'daily-2026-12-31' }, 'daily-2027-01-01', previousDailySeed, FALLBACK)).toEqual({ streak: 10, last: 'daily-2027-01-01' })
  })

  it('resets the streak to 1 after a gap, and on a first result', () => {
    expect(advanceStreak({ streak: 6, last: 'daily-2026-10-20' }, 'daily-2026-10-22', previousDailySeed, FALLBACK)).toEqual({ streak: 1, last: 'daily-2026-10-22' })
    expect(advanceStreak({ streak: 0, last: null }, 'daily-2026-10-22', previousDailySeed, FALLBACK)).toEqual({ streak: 1, last: 'daily-2026-10-22' })
    // A day that names no date falls back to the caller's yesterday
    expect(advanceStreak({ streak: 3, last: 'daily-2026-10-24' }, 'today', () => null, 'daily-2026-10-24')).toEqual({ streak: 4, last: 'today' })
    expect(advanceStreak({ streak: 3, last: 'daily-2026-10-23' }, 'today', () => null, 'daily-2026-10-24')).toEqual({ streak: 1, last: 'today' })
  })

  it('files an old daily seed under its own date, and any other seed under today', () => {
    expect(streakDay('daily-2026-10-01', previousDailySeed, 'daily-2026-10-25')).toBe('daily-2026-10-01')
    expect(streakDay('K7Q2-MX9A', previousDailySeed, 'daily-2026-10-25')).toBe('daily-2026-10-25')
  })

  it('changes nothing on a second result the same day', () => {
    const book = { streak: 5, last: 'daily-2026-10-25' }
    expect(advanceStreak(book, 'daily-2026-10-25', previousDailySeed, FALLBACK)).toEqual(book)
  })

  it('keeps recordResult filing dailies the same way: by the seed day, growing on consecutive days, once per day', () => {
    const u = loadTestUniverse()
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: null, parked: {} })
    const before = useStore.getState().profile
    // One real daily, played through the store: finishing it records the result
    useStore.getState().startGame(dailyGameSettings(u, 'daily-2026-10-20', 'Streak XI'))
    useStore.getState().autoDraftRest()
    useStore.getState().finishDraft()
    const finished = useStore.getState().game!
    expect(finished.phase).toBe('summary')
    // The other days reuse its finished season under their own seed and id (one quick season is enough to prove the bookkeeping)
    let n = 0
    const play = (seed: string) => {
      useStore.setState({ game: { ...finished, id: `${finished.id}-${++n}`, settings: { ...finished.settings, seed } } })
      useStore.getState().recordResult()
      return useStore.getState().profile
    }
    // Old puzzles, finished today, still count for the days they were set
    let p = useStore.getState().profile
    expect(p.dailyStreak).toBe(1)
    expect(p.lastDailyDate).toBe('daily-2026-10-20')
    expect(Object.keys(p.dailyResults)).toEqual(['daily-2026-10-20'])
    expect(p.dailyResults[dailySeed()]).toBeUndefined()
    p = play('daily-2026-10-21')
    expect(p.dailyStreak).toBe(2)
    expect(p.lastDailyDate).toBe('daily-2026-10-21')
    // The same day again: a leaderboard row, but the streak and the day's result stay
    const first = p.dailyResults['daily-2026-10-21']
    p = play('daily-2026-10-21')
    expect(p.dailyStreak).toBe(2)
    expect(p.dailyResults['daily-2026-10-21']).toEqual(first)
    expect(p.leaderboard.length).toBe(before.leaderboard.length + 3)
    // A missed day starts again
    p = play('daily-2026-10-23')
    expect(p.dailyStreak).toBe(1)
    expect(p.lastDailyDate).toBe('daily-2026-10-23')
    expect(Object.keys(p.dailyResults).sort()).toEqual(['daily-2026-10-20', 'daily-2026-10-21', 'daily-2026-10-23'])
    useStore.setState({ game: null, universe: null, loadedLeagues: [], parked: {}, profile: before })
  }, 60_000)
})
