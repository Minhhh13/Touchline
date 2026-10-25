import type { QuickBests, QuickGameResult } from '../types'

/**
 * The 38-0 chase: Quick Draft's goal is the flawless season, every league game won. These helpers read a season's
 * results (or the part of it revealed so far) as that chase: still perfect, perfect run over but unbeaten, or both
 * gone. Pure, and display only: nothing here feeds the season.
 */
export interface ChaseState {
  played: number
  won: number
  drawn: number
  lost: number
  /** Every game so far won. */
  perfect: boolean
  /** No game so far lost. */
  unbeaten: boolean
  /** Wins in a row from the first game: the perfect run. */
  perfectRun: number
  /** Games without defeat from the first game. */
  unbeatenRun: number
  /** The game (1-based) that ended the perfect run; null while it lasts. */
  perfectEndedAt: number | null
  /** The game (1-based) that ended the unbeaten run; null while it lasts. */
  unbeatenEndedAt: number | null
}

/** The chase after the first `upTo` games of `results` (in matchweek order). */
export function chaseAt(results: Array<Pick<QuickGameResult, 'gf' | 'ga'>>, upTo = results.length): ChaseState {
  const c: ChaseState = { played: 0, won: 0, drawn: 0, lost: 0, perfect: true, unbeaten: true, perfectRun: 0, unbeatenRun: 0, perfectEndedAt: null, unbeatenEndedAt: null }
  for (const r of results.slice(0, Math.max(0, upTo))) {
    c.played++
    if (r.gf > r.ga) c.won++
    else if (r.gf === r.ga) c.drawn++
    else c.lost++
    if (c.perfect && r.gf <= r.ga) {
      c.perfect = false
      c.perfectEndedAt = c.played
    }
    if (c.unbeaten && r.gf < r.ga) {
      c.unbeaten = false
      c.unbeatenEndedAt = c.played
    }
    if (c.perfect) c.perfectRun++
    if (c.unbeaten) c.unbeatenRun++
  }
  return c
}

/** A won-drawn-lost record the 38-0 way: "31-4-3". */
export function recordLabel(won: number, drawn: number, lost: number): string {
  return `${won}-${drawn}-${lost}`
}

/** The target for a season of `games` league games: "38-0". */
export function perfectTarget(games: number): string {
  return `${games}-0`
}

export type ChaseTone = 'perfect' | 'unbeaten' | 'over'

/** What the playback's chase banner says after the games shown, and whether the run broke on the last one. */
export interface ChaseLine {
  tone: ChaseTone
  headline: string
  /** A second line, when there is one: the unbeaten run after the perfect one ends. */
  detail: string | null
  /** The last game shown ended the perfect run or the unbeaten one: the moment the banner marks. */
  justBroke: boolean
}

export function chaseLine(c: ChaseState, games: number): ChaseLine {
  const target = perfectTarget(games)
  if (c.perfect) {
    const done = c.played >= games && games > 0
    return { tone: 'perfect', headline: done ? `${target}. The perfect season` : c.played ? `Still perfect: ${c.won}-0` : `Chasing ${target}`, detail: done ? null : c.played ? `${games - c.played} to go for ${target}` : 'Win every game', justBroke: false }
  }
  const over = perfectOverLabel(c.perfectRun)
  const justBroke = c.perfectEndedAt === c.played || c.unbeatenEndedAt === c.played
  if (c.unbeaten) {
    const done = c.played >= games && games > 0
    return { tone: 'unbeaten', headline: over, detail: done ? `Unbeaten all season: ${c.unbeatenRun}` : `Unbeaten: ${c.unbeatenRun}`, justBroke }
  }
  return { tone: 'over', headline: over, detail: c.unbeatenRun > c.perfectRun ? `Unbeaten run ended at ${c.unbeatenRun}` : null, justBroke }
}

/** The moment the perfect run ends: "Perfect run over at 12-0", or in game 1 when the first game is not won. */
export function perfectOverLabel(run: number): string {
  return run ? `Perfect run over at ${run}-0` : 'Perfect run over in game 1'
}

/** The line under the summary's lead ("31-4-3 against 38-0"): how far short of the perfect season it fell. */
export function versusPerfectLine(won: number, lost: number, games: number): string {
  if (won >= games && games > 0) return 'The perfect season'
  const short = games - won
  if (lost === 0) return `Unbeaten, ${short} draw${short === 1 ? '' : 's'} short`
  return `${short} win${short === 1 ? '' : 's'} short`
}

/**
 * The runs under the summary's lead, in plain words: "Perfect run 12-0 · unbeaten for the first 15",
 * "Perfect run ended in game 2", "Unbeaten for the first 9 games". Null when it would say nothing more than the
 * line above it: a perfect season, unbeaten all season, or the first game not won and the unbeaten run no longer.
 */
export function runsLine(c: Pick<ChaseState, 'perfectRun' | 'unbeatenRun'>, games = 0): string | null {
  const p = c.perfectRun
  if (games > 0 && p >= games) return null
  // An unbeaten run worth naming: longer than the perfect one, two games or more, and not the whole season
  const u = c.unbeatenRun > p && c.unbeatenRun >= 2 && !(games > 0 && c.unbeatenRun >= games) ? c.unbeatenRun : 0
  if (p >= 2) return u ? `Perfect run ${p}-0 · unbeaten for the first ${u}` : `Perfect run ${p}-0`
  if (u) return `Unbeaten for the first ${u} games`
  return p === 1 ? 'Perfect run ended in game 2' : null
}

/** The Profile's Quick Draft bests as they start: nothing yet. */
export function emptyBests(): QuickBests {
  return { perfectSeasons: 0, longestPerfectRun: 0 }
}

/** A season's record in the order bests rank it: more wins first, then fewer defeats, then more points. */
function better(a: NonNullable<QuickBests['bestRecord']>, b: NonNullable<QuickBests['bestRecord']>): boolean {
  return (a.won - b.won || b.lost - a.lost || a.points - b.points) > 0
}

/** The bests after one more finished quick season (`results` in matchweek order). Pure: returns a new object. */
export function withQuickBests(prev: QuickBests | undefined, season: { won: number; drawn: number; lost: number; points: number; results?: Array<Pick<QuickGameResult, 'gf' | 'ga'>> }, games: number): QuickBests {
  const base = { ...emptyBests(), ...(prev ?? {}) }
  const rec = { won: season.won, drawn: season.drawn, lost: season.lost, points: season.points, games }
  const run = season.results?.length ? chaseAt(season.results).perfectRun : season.drawn === 0 && season.lost === 0 ? season.won : 0
  const perfect = games > 0 && season.won >= games && season.drawn === 0 && season.lost === 0
  return {
    ...base,
    bestRecord: !base.bestRecord || better(rec, base.bestRecord) ? rec : base.bestRecord,
    longestPerfectRun: Math.max(base.longestPerfectRun ?? 0, run),
    perfectSeasons: (base.perfectSeasons ?? 0) + (perfect ? 1 : 0),
  }
}
