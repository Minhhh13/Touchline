/**
 * Where a finished Daily Arena or Weekly Challenge run stands in its streak book, for the summary's line (r9): the
 * result that counts for the day or week (the first one filed), the streak, and whether this run was a practice go
 * after it. Pure and display only: it reads the book the store already filed, nothing else, and never the clock.
 */
import type { StreakResults } from '../types'

export interface StreakStanding<R> {
  /** The result filed for the seed's day or week: the first run, the one the streak counts. */
  counted: R
  /** The streak as the book holds it. */
  streak: number
  /** True when this run's result is not the counted one: a second go, played for practice. */
  practice: boolean
}

/** Two results the same, field by field (both are small flat records). */
function same<R>(a: R, b: R): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a) as (keyof R)[]
  const kb = Object.keys(b) as (keyof R)[]
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

/**
 * The standing of a run on `seed` with result `run`, or null when the book has no result for that seed yet (the store
 * files it as the summary opens). A practice run that happens to equal the counted result reads as counted, which is
 * still true of the day: the line names the counted result either way.
 */
export function streakStanding<R>(book: StreakResults<R> | undefined, seed: string, run: R): StreakStanding<R> | null {
  const counted = book?.results[seed]
  if (!book || counted === undefined) return null
  return { counted, streak: book.streak, practice: !same(counted, run) }
}
