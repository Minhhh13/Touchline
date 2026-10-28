/**
 * The Weekly Challenge's record for its Setup box: this week's result (the first one, which the streak counts) and
 * your best run at it, the streak as it stands this week, last week's result and the weeks before. Pure: the caller
 * passes the week's seed and the calendar (`previousOf`), so nothing here reads the clock. Display only.
 */
import type { SeasonTier } from '@engine/types'
import type { LeaderboardEntry, Profile } from '../types'

export interface WeeklyRun {
  points: number
  tier: SeasonTier
  /** W-D-L, when the leaderboard still holds the run. */
  record?: string
}

export interface WeeklyRecord {
  /** The week's first result, the one that counts for the streak; null before you play it. */
  counted: WeeklyRun | null
  /** Your best run at this week's wheel, when it beats the counted one. */
  best: WeeklyRun | null
  /** Runs at this week's wheel the leaderboard holds. */
  plays: number
  /** Weeks in a row: the streak while it is alive (this week or last week counted), 0 once a week was missed. */
  streak: number
  /** True when the streak is alive but this week is still to play. */
  streakAtRisk: boolean
  /** Last week's counted result, null when none. */
  lastWeek: WeeklyRun | null
  /** The four weeks before this one, oldest first: points, or null for a week not played. */
  recent: Array<{ week: string; points: number | null }>
}

const record = (e: Pick<LeaderboardEntry, 'won' | 'drawn' | 'lost'>) => `${e.won}-${e.drawn}-${e.lost}`

/**
 * The leaderboard row of the counted (first) run: the earliest with its points and tier. A later run on the same
 * points sorts first on the board when it lost fewer, so the first match is not enough; when two runs that day share
 * the points with different records, which one counted cannot be told, and none is named.
 */
function countedRun(runs: LeaderboardEntry[], first: { points: number; tier: LeaderboardEntry['tier'] }): LeaderboardEntry | undefined {
  const same = runs.filter((e) => e.points === first.points && e.tier === first.tier)
  if (!same.length) return undefined
  const day = same.reduce((d, e) => (e.date < d ? e.date : d), same[0].date)
  const earliest = same.filter((e) => e.date === day)
  return earliest.every((e) => record(e) === record(earliest[0])) ? earliest[0] : undefined
}

export function weeklyRecord(profile: Pick<Profile, 'weekly' | 'leaderboard'>, seed: string, previousOf: (s: string) => string | null): WeeklyRecord {
  const book = profile.weekly
  const results = book?.results ?? {}
  const runs = profile.leaderboard.filter((e) => e.mode === 'weekly' && e.seed === seed)
  const top = runs.reduce<LeaderboardEntry | null>((b, e) => (!b || e.points > b.points || (e.points === b.points && e.lost < b.lost) ? e : b), null)
  const first = results[seed]
  const same = first ? countedRun(runs, first) : undefined
  const counted: WeeklyRun | null = first ? { points: first.points, tier: first.tier, ...(same ? { record: record(same) } : {}) } : null
  const best: WeeklyRun | null = top && (!first || top.points > first.points) ? { points: top.points, tier: top.tier, record: record(top) } : null
  const prev = previousOf(seed)
  const alive = !!book && (book.last === seed || (prev !== null && book.last === prev))
  const last = prev ? results[prev] : undefined
  const recent: WeeklyRecord['recent'] = []
  let w = prev
  for (let i = 0; i < 4 && w; i++) {
    recent.unshift({ week: w.replace('weekly-', ''), points: results[w]?.points ?? null })
    w = previousOf(w)
  }
  return {
    counted,
    best,
    plays: runs.length,
    streak: alive ? book!.streak : 0,
    streakAtRisk: alive && book!.last !== seed,
    lastWeek: last ? { points: last.points, tier: last.tier } : null,
    recent,
  }
}
