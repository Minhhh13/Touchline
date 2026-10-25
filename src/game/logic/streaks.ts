/**
 * Streak bookkeeping for anything played once a day (or once a week): the
 * Daily Challenge today, the Daily Arena and the Weekly Challenge later. Pure:
 * the caller passes the calendar in (`previousOf`, `fallbackYesterday`, the
 * day it is now), so nothing here reads the clock.
 */
import type { StreakResults } from '../types'

/** A streak and the last day (a seed such as `daily-2026-10-25`) that counted towards it. */
export interface StreakBook {
  streak: number
  last: string | null
}

/**
 * The day a result files under: the seed's own day when the seed names one
 * (`previousOf` knows the day before it), so a puzzle finished after midnight,
 * or an old puzzle replayed, counts for the day it was set; otherwise today.
 */
export function streakDay(seed: string, previousOf: (s: string) => string | null, today: string): string {
  return previousOf(seed) ? seed : today
}

/**
 * The book after a result on `seedDay`. The streak grows only when the last
 * counted day is the one before `seedDay` (`previousOf(seedDay)`, or
 * `fallbackYesterday` when `seedDay` names no day); any other last day starts
 * it again at 1. A second result on the day already counted changes nothing.
 */
export function advanceStreak(book: StreakBook, seedDay: string, previousOf: (s: string) => string | null, fallbackYesterday: string): { streak: number; last: string } {
  if (book.last === seedDay) return { streak: book.streak, last: seedDay }
  const yesterday = previousOf(seedDay) ?? fallbackYesterday
  return { streak: book.last === yesterday ? book.streak + 1 : 1, last: seedDay }
}

/**
 * File one result in a streak book with results (the Daily Arena's, the
 * Weekly's): under the seed's own day or week (`streakDay`), the first result
 * of that day only, growing the streak through `advanceStreak`. `filed` is
 * false when that day already had a result, and the book is then unchanged.
 */
export function fileStreakResult<R>(book: StreakResults<R> | undefined, seed: string, result: R, previousOf: (s: string) => string | null, today: string, yesterday: string): { book: StreakResults<R>; day: string; filed: boolean } {
  const current: StreakResults<R> = book ?? { streak: 0, last: null, results: {} }
  const day = streakDay(seed, previousOf, today)
  if (current.results[day]) return { book: current, day, filed: false }
  const next = advanceStreak({ streak: current.streak, last: current.last }, day, previousOf, yesterday)
  return { book: { ...next, results: { ...current.results, [day]: result } }, day, filed: true }
}
