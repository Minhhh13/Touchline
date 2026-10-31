/*
 * When a simulating season makes a sound, and which: the quick season's
 * playback (a result landing game by game, its goals, the big moments, the
 * January window and the end of the season) and Season or Dynasty's Play
 * matchweek, Sim 5 and Sim to end. Pure: functions of the results already
 * shown, the moments perfect.ts and liveTable.ts compute, the clinch weeks
 * (`clinchMatchweeks`) and the playback's speed, so the hooks only play what
 * this says. It thins the cues at speed and batches a skip; it never reads the
 * clock, the DOM or the game's RNG.
 */
import { momentAt, type LiveRow } from '@game/logic/liveTable'
import { playbackDelay, type PlaybackSpeed } from '@game/logic/gameByGame'
import type { ClinchWeeks } from '@engine/story'
import type { ResultOutcome, SeasonFinish, SeasonSoundRequest, StingerKind } from './seasonScores'

/** One cue: what to play and when, in seconds after the step it belongs to. */
export interface SeasonCue {
  at: number
  req: SeasonSoundRequest
}

/** Below this gap between two games (ms) the playback is fast: thin blips, no goal cheer, no crowd bed. 4x (375 ms) is fast; 2x (750 ms) is not. */
export const FAST_BELOW_MS = 700
/** At speed, results never sound closer than this (ms): 4x plays every other blip, a change of outcome and every stinger excepted. */
export const MIN_RESULT_GAP_MS = 700
/** A cheer under a result from this many goals (and never under a defeat). */
export const CHEER_GOALS = 2
/** The crowd bed under the last games of a perfect run: from this many games to go. */
export const TENSION_GAMES = 5
/** Where the stinger sits after its result, s (at speed it replaces the result). */
export const STINGER_AT = 0.28
/** Where the closing fanfare, or the January chime, sits after the last result, s. */
export const FINISH_AT = 0.4

/** The moments in order of weight: a game sounds the heaviest one only. */
export const STINGER_ORDER: readonly StingerKind[] = ['title', 'relegated', 'perfect-broken', 'top', 'top4', 'perfect-alive']

export interface PlaybackGame {
  matchweek: number
  gf: number
  ga: number
}

export interface PlaybackCueInput {
  /** The user's games in matchweek order (`playbackResults`). */
  results: readonly PlaybackGame[]
  /** The table after every matchweek (`weeklyTables`); empty for a save from before the live table. */
  tables: LiveRow[][]
  userId: string
  /** The season's games. */
  total: number
  /** Where this playback stops: the January window (the first half) or the last game. */
  stopAt: number
  /** The stop is the January window. */
  january: boolean
  /** The weeks the title was sealed and the drop made certain, from the whole season's rounds; null in the first half. */
  clinch: ClinchWeeks | null
  /** The final place, for the closing fanfare. */
  finalPosition: number
  /** Clubs in the league. */
  teams: number
  reduced: boolean
}

export interface PlaybackStep {
  /** Games shown before and after. */
  from: number
  to: number
  speed: PlaybackSpeed
  /** When the last result blip sounded (ms on the caller's clock), and now. */
  lastResultAt: number
  now: number
}

export interface PlaybackCues {
  cues: SeasonCue[]
  /** Pass back as the next step's `lastResultAt`. */
  lastResultAt: number
}

export function outcomeOf(g: Pick<PlaybackGame, 'gf' | 'ga'>): ResultOutcome {
  return g.gf > g.ga ? 'W' : g.gf < g.ga ? 'L' : 'D'
}

/** The week (clinch) falls on game k (1-based): the first game shown at or after it. */
function landsOn(week: number | null, results: readonly PlaybackGame[], k: number): boolean {
  if (week === null || k < 1 || k > results.length) return false
  return results[k - 1].matchweek >= week && (k === 1 || results[k - 2].matchweek < week)
}

/** The heaviest big moment game k (1-based) brings, or null: the title or the drop, then the moments of `momentAt`. */
export function stingerAt(input: Pick<PlaybackCueInput, 'results' | 'tables' | 'userId' | 'clinch'>, k: number): StingerKind | null {
  const found = new Set<StingerKind>()
  if (input.clinch && landsOn(input.clinch.clinchedAt, input.results, k)) found.add('title')
  if (input.clinch && landsOn(input.clinch.doomedAt, input.results, k)) found.add('relegated')
  const m = momentAt(input.tables, input.results as PlaybackGame[], k, input.userId)
  if (m === 'broke') found.add('perfect-broken')
  else if (m === 'top') found.add('top')
  else if (m === 'top4') found.add('top4')
  else if (m === 'perfect') found.add('perfect-alive')
  return STINGER_ORDER.find((s) => found.has(s)) ?? null
}

/** Where a season finished, as its fanfare: champions, the top four, mid-table or the bottom three. */
export function finishOf(position: number, teams: number): SeasonFinish {
  if (position === 1) return 'champion'
  if (position >= 2 && position <= 4) return 'top4'
  if (teams > 3 && position > teams - 3) return 'drop'
  return 'mid'
}

function tally(results: readonly PlaybackGame[], from: number, to: number): { won: number; drawn: number; lost: number } {
  const t = { won: 0, drawn: 0, lost: 0 }
  for (const g of results.slice(Math.max(0, from), Math.max(0, to))) {
    const o = outcomeOf(g)
    if (o === 'W') t.won++
    else if (o === 'D') t.drawn++
    else t.lost++
  }
  return t
}

/** The closing cue when a step reaches the stop: the season's fanfare, or the January chime. */
function finishCues(input: PlaybackCueInput, to: number, at: number): SeasonCue[] {
  if (to < input.stopAt) return []
  if (input.january) return [{ at, req: { id: 'halfway' } }]
  if (to < input.total) return []
  const perfect = input.results.slice(0, to).every((g) => g.gf > g.ga) && to > 0
  return [{ at, req: { id: 'season-end', finish: finishOf(input.finalPosition, input.teams), perfect, reduced: input.reduced } }]
}

/**
 * The cues for one step of the playback, from `from` games shown to `to`:
 *
 * - One game (the playback ticking): its result blip (W, D or L), a cheer under it weighted by the goals from two up
 *   (never under a defeat), the heaviest big moment as a stinger after it, the crowd bed under the last five games of
 *   a perfect run, and on the last game the season's fanfare (or the January chime) in place of a stinger.
 * - At 4x (`FAST_BELOW_MS`) it thins: the short blip only, never closer than `MIN_RESULT_GAP_MS` to the last unless the
 *   outcome changed, a stinger in place of the blip, no cheer and no bed.
 * - Several games at once (Skip): one riffle for them all and the closing cue, so a skip never machine-guns.
 * - Nothing for a step back or no step.
 */
export function playbackCues(input: PlaybackCueInput, step: PlaybackStep): PlaybackCues {
  const { from, to } = step
  const keep = { cues: [] as SeasonCue[], lastResultAt: step.lastResultAt }
  if (to <= from || to > input.results.length) return keep
  if (to - from > 1) {
    const t = tally(input.results, from, to)
    return { cues: [{ at: 0, req: { id: 'batch', ...t } }, ...finishCues(input, to, FINISH_AT)], lastResultAt: step.now }
  }
  const g = input.results[to - 1]
  const o = outcomeOf(g)
  const delay = playbackDelay(step.speed)
  const fast = delay < FAST_BELOW_MS
  const last = to === input.stopAt
  const ends = finishCues(input, to, fast ? 0.12 : FINISH_AT)
  const stinger = last && ends.length ? null : stingerAt(input, to)
  const out: SeasonCue[] = []
  if (fast) {
    const prev = to > 1 ? outcomeOf(input.results[to - 2]) : null
    if (stinger) out.push({ at: 0, req: { id: 'stinger', kind: stinger, reduced: input.reduced } })
    else if (ends.length || step.now - step.lastResultAt >= MIN_RESULT_GAP_MS || o !== prev) out.push({ at: 0, req: { id: 'result', outcome: o, thin: true } })
    out.push(...ends)
    return { cues: out, lastResultAt: out.length ? step.now : step.lastResultAt }
  }
  out.push({ at: 0, req: { id: 'result', outcome: o } })
  if (g.gf >= CHEER_GOALS && o !== 'L') out.push({ at: 0.06, req: { id: 'goals', goals: g.gf } })
  if (stinger) out.push({ at: STINGER_AT, req: { id: 'stinger', kind: stinger, reduced: input.reduced } })
  out.push(...ends)
  // Still perfect with a few to go: the crowd holds its breath until the next result
  const togo = input.total - to
  if (!last && togo > 0 && togo <= TENSION_GAMES && input.results.slice(0, to).every((x) => x.gf > x.ga)) out.push({ at: 0.1, req: { id: 'tension', level: 1 - (togo - 1) / TENSION_GAMES, dur: delay / 1000 } })
  return { cues: out, lastResultAt: step.now }
}

// ---- Season and Dynasty ----------------------------------------------------------------------------------

/** A league result of the user's, in matchweek order. */
export interface WeekResult {
  matchweek: number
  gf: number
  ga: number
}

export interface SeasonStepInput {
  /** The last matchweek played before and after the step. */
  fromMatchweek: number
  toMatchweek: number
  /** The user's league results in the step's weeks. */
  results: readonly WeekResult[]
  /** The step came from Sim 5 or Sim to end (the digest opens), not one matchweek. */
  digest: boolean
  clinch: ClinchWeeks | null
  /** The season ended in this step (the summary opens). */
  ended: boolean
  /** Sacked: no stinger, the summary says it. */
  sacked: boolean
  reduced: boolean
}

/**
 * The cues for a step of a Season or Dynasty played without the match day (Play matchweek on Sim result, Sim 5, Sim
 * to end, Sim to the next big match): one result blip and its cheer for a single matchweek, one riffle for several
 * (the digest's cue), and the title or relegation stinger when the step sealed it. A season that ended with the title
 * plays nothing here: the summary's own fanfare (`Celebrate`) has that moment.
 */
export function seasonStepCues(s: SeasonStepInput): SeasonCue[] {
  if (s.toMatchweek <= s.fromMatchweek) return []
  const within = (w: number | null | undefined) => w !== null && w !== undefined && w > s.fromMatchweek && w <= s.toMatchweek
  const title = !s.sacked && within(s.clinch?.clinchedAt)
  if (s.ended && title) return []
  const out: SeasonCue[] = []
  if (s.digest || s.results.length > 1) {
    const t = tally(s.results, 0, s.results.length)
    if (s.results.length) out.push({ at: 0, req: { id: 'batch', ...t } })
  } else if (s.results.length === 1) {
    const g = s.results[0]
    const o = outcomeOf(g)
    out.push({ at: 0, req: { id: 'result', outcome: o } })
    if (g.gf >= CHEER_GOALS && o !== 'L') out.push({ at: 0.06, req: { id: 'goals', goals: g.gf } })
  }
  const at = out.length ? (out[0].req.id === 'batch' ? FINISH_AT : STINGER_AT) : 0
  if (title) out.push({ at, req: { id: 'stinger', kind: 'title', reduced: s.reduced } })
  else if (!s.sacked && within(s.clinch?.doomedAt)) out.push({ at, req: { id: 'stinger', kind: 'relegated', reduced: s.reduced } })
  return out
}
