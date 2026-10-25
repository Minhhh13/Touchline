/**
 * Streak bookkeeping for anything played once a day (or once a week): the
 * Daily Challenge today, the Daily Arena and the Weekly Challenge later. Pure:
 * the caller passes the calendar in (`previousOf`, `fallbackYesterday`, the
 * day it is now), so nothing here reads the clock.
 */

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
