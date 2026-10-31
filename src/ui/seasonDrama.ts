/*
 * The season playback's drama (round 9), pure: the title race or relegation fight of the last weeks, which slows the
 * reveal; the streaks and milestones that flare as a result lands; how many times a score flashes for its goals.
 * Presentation only: it reads results and tables the screen already shows, never the game's generator, and it lives
 * outside src/game/logic so the edge verifier's bundle never sees it.
 */
import type { QuickGameResult } from '@game/types'
import type { LiveRow } from '@game/logic/liveTable'
import { pickVariant } from '@game/logic/flavour'

/** The last games of a season in which a close race slows the reveal. */
export const RACE_GAMES = 6
/** The widest gap in points that still makes a race worth slowing for (a title race, a drop fight). */
export const RACE_GAP = { title: 6, drop: 4 } as const
/** How much longer the wait before each of the last games is in a race, by games left (index 0: the final day). */
export const RACE_PACE = [2.1, 1.8, 1.6, 1.45, 1.3, 1.2] as const
/** The most a race adds to one step, ms (0.5x is slow already). */
export const RACE_EXTRA_MAX_MS = 2500

export interface Race {
  kind: 'title' | 'drop'
  /** The user's games still to play. */
  left: number
}

/**
 * The race the user is in after `revealed` games of `total`, or null: within the last `RACE_GAMES`, top with a lead the
 * games left could still close (at most `RACE_GAP.title`), or behind the leader by no more than that; else in or just
 * above the bottom three within `RACE_GAP.drop` points of the line. The title race wins over a drop fight.
 */
export function raceAt(table: LiveRow[], userId: string, revealed: number, total: number): Race | null {
  const left = total - revealed
  if (left < 1 || left > RACE_GAMES || table.length < 4) return null
  const i = table.findIndex((r) => r.teamId === userId)
  if (i < 0) return null
  const me = table[i].points
  const reach = 3 * left
  const titleGap = i === 0 ? me - table[1].points : table[0].points - me
  if (titleGap <= Math.min(reach, RACE_GAP.title)) return { kind: 'title', left }
  const n = table.length
  // The line: the last safe place (17th of 20) and the first one down
  const safe = table[n - 4]
  const down = table[n - 3]
  if (i >= n - 3 && safe.points - me <= Math.min(reach, RACE_GAP.drop)) return { kind: 'drop', left }
  if (i >= n - 6 && i < n - 3 && me - down.points <= Math.min(reach, RACE_GAP.drop)) return { kind: 'drop', left }
  return null
}

/** The wait before the next game in a race: the step stretched by `RACE_PACE`, never by more than `RACE_EXTRA_MAX_MS`. */
export function raceDelay(baseMs: number, race: Race | null): number {
  if (!race) return baseMs
  const k = RACE_PACE[Math.min(RACE_PACE.length, Math.max(1, race.left)) - 1]
  return Math.round(Math.min(baseMs * k, baseMs + RACE_EXTRA_MAX_MS))
}

export type FlareKind = 'points' | 'goals' | 'wins' | 'unbeaten' | 'clean' | 'rout'

export interface Flare {
  kind: FlareKind
  /** The run's length, the milestone crossed, or a rout's margin. */
  n: number
  /** The tally box that flares with it, if any. */
  box: 'w' | 'pts' | null
}

const POINTS_MARKS = [50, 75, 90, 100] as const
const GOALS_MARKS = [50, 75, 100] as const

/** A run's lengths worth a flare: 3, 5 and 7, then every fifth from 10. */
function runMark(n: number, first: number): boolean {
  return n === first || (n < 10 ? n === 5 || n === 7 : n % 5 === 0)
}

function runEnding(results: QuickGameResult[], k: number, ok: (r: QuickGameResult) => boolean): number {
  let n = 0
  for (let i = k - 1; i >= 0 && ok(results[i]); i--) n++
  return n
}

function crossed(before: number, after: number, marks: readonly number[]): number | null {
  for (let i = marks.length - 1; i >= 0; i--) if (before < marks[i] && after >= marks[i]) return marks[i]
  return null
}

/**
 * What the `k`th game just did worth a flare: a points or goals milestone crossed, a win run (3, 5, 7, then every
 * fifth; not while the season is still perfect, which the moment chip already marks), an unbeaten run from 10, a run of
 * clean sheets, or a rout (won by four or more). The heaviest only.
 */
export function flareAt(results: QuickGameResult[], k: number): Flare | null {
  if (k <= 0 || k > results.length) return null
  const r = results[k - 1]
  let ptsBefore = 0
  let goalsBefore = 0
  for (let i = 0; i < k - 1; i++) {
    const g = results[i]
    ptsBefore += g.gf > g.ga ? 3 : g.gf === g.ga ? 1 : 0
    goalsBefore += g.gf
  }
  const pts = crossed(ptsBefore, ptsBefore + (r.gf > r.ga ? 3 : r.gf === r.ga ? 1 : 0), POINTS_MARKS)
  if (pts !== null) return { kind: 'points', n: pts, box: 'pts' }
  const goals = crossed(goalsBefore, goalsBefore + r.gf, GOALS_MARKS)
  if (goals !== null) return { kind: 'goals', n: goals, box: null }
  const perfect = runEnding(results, k, (g) => g.gf > g.ga) === k
  const wins = runEnding(results, k, (g) => g.gf > g.ga)
  if (!perfect && wins >= 3 && runMark(wins, 3)) return { kind: 'wins', n: wins, box: 'w' }
  const unbeaten = runEnding(results, k, (g) => g.gf >= g.ga)
  if (!perfect && unbeaten >= 10 && unbeaten % 5 === 0) return { kind: 'unbeaten', n: unbeaten, box: 'w' }
  const clean = runEnding(results, k, (g) => g.ga === 0)
  if (clean >= 3 && runMark(clean, 3)) return { kind: 'clean', n: clean, box: null }
  if (r.gf - r.ga >= 4) return { kind: 'rout', n: r.gf - r.ga, box: null }
  return null
}

/** How many times a landing score flashes: once a goal scored, at most five. */
export function goalFlashes(goalsFor: number): number {
  return Math.max(0, Math.min(5, Math.floor(goalsFor)))
}

/** The longest run of league wins in a simulated stretch (the digest), or 0 below three. */
export function digestWinRun(outcomes: ReadonlyArray<'W' | 'D' | 'L'>): number {
  let best = 0
  let run = 0
  for (const o of outcomes) {
    run = o === 'W' ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best >= 3 ? best : 0
}

/** What a digest's stretch of league results says, in one word: the shape of a one-line read at the top of the digest. */
export type DigestMood = 'perfect' | 'unbeaten' | 'winless' | 'climb' | 'slide' | 'good' | 'poor' | 'mixed'

/** Each mood's wordings in the `app` catalogue (`digestMood_<mood>_0`…). */
export const DIGEST_MOOD_WORDINGS = 3

/**
 * The digest's mood from its league results and the table's move: every game won, none lost, none won, a climb or a
 * slide of three places or more (not from pre-season, where the table before means nothing), then points a game; null
 * for fewer than two league matches, where the results say it all.
 */
export function digestMood(outcomes: ReadonlyArray<'W' | 'D' | 'L'>, move: { from: number; to: number; fromPreseason: boolean }): DigestMood | null {
  const n = outcomes.length
  if (n < 2) return null
  const w = outcomes.filter((o) => o === 'W').length
  const l = outcomes.filter((o) => o === 'L').length
  if (w === n) return 'perfect'
  if (!l && n >= 3) return 'unbeaten'
  if (!w) return 'winless'
  if (!move.fromPreseason && move.from - move.to >= 3) return 'climb'
  if (!move.fromPreseason && move.to - move.from >= 3) return 'slide'
  const ppg = (w * 3 + (n - w - l)) / n
  return ppg >= 2 ? 'good' : ppg < 1 ? 'poor' : 'mixed'
}

/** Which wording of a digest line to say, by a pure hash of the game and the weeks it covers: the same digest always reads the same. */
export function digestWording(gameId: string, from: number, to: number, line: string, count = DIGEST_MOOD_WORDINGS): number {
  return pickVariant(Array.from({ length: count }, (_, i) => i), `${gameId}|digest|${from}-${to}|${line}`)
}
