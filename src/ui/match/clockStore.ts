/**
 * The live match clock, shared between the ticker (which drives it) and the
 * pitch and charts (which read it).
 *
 * The clock is continuous: an anchor says the match stood at minute `at` at
 * real time `since`, and from there it runs at `period / speed` milliseconds a
 * minute, so the pitch reads a smooth fractional minute every frame and never
 * waits on a timer. Goals hold it: when the match time reaches a goal's strike
 * moment the clock stands still for the hold (the goal celebration) and then
 * carries on from the kick-off. `timeline` is the one pure function behind it.
 *
 * React only sees the whole minute (`clock`), how many goals have been
 * revealed and which celebration is on; the ticker refreshes those a few
 * times a second at most, and only when they change.
 */
import { create } from 'zustand'
import type { Side } from './pitchGeometry'
import { toMatch, toPicture, type PaceSpan } from './timing'

/** One goal's hold: the strike moment in match time, how long the clock stands there, and whose goal it is. */
export interface GoalHold {
  t: number
  ms: number
  side: Side
  /** The goal's index in the match's events (as a string), to match the hold to its event and hide it until it is revealed. */
  key: string
  /** The user's own goal (full celebration), conceded (short and subdued) or neither side is the user's (a full one). */
  tone: 'ours' | 'theirs' | 'neutral'
  /** Milliseconds at the end of the hold that replay the goal (keyMoments.ts); absent for none. Part of `ms`. */
  replay?: number
}

/** Milliseconds from the strike to the ball crossing the line: the score changes then. */
export const GOAL_FLIGHT_MS = 520
/** The holds: about 2.8 s for our goal, 1.7 s for one against us, 1.5 s still frame with reduced motion. */
export const HOLD_MS = { ours: 2800, neutral: 2600, theirs: 1700, reduced: 1500 } as const

export interface LiveClockState {
  /** The whole minute the ticker shows (never beyond `stopAt`). */
  clock: number
  /** 1, 2 or 4. */
  speed: number
  /** The highlights' fast-forward on top of the speed (1 through watched minutes); absent means 1. */
  boost?: number
  running: boolean
  /** Milliseconds per minute at 1x. */
  period: number
  /** The anchor: the match stood at minute `at` (fractional) at `since` (performance.now()). */
  at: number
  since: number
  /** Milliseconds of a hold already spent at `at`, when `at` is a goal's strike moment (Infinity when not). */
  spent: number
  /** The minute the ticker stops at, and the match time the segment ends (the end of that minute, or 95 at the whistle). */
  stopAt: number
  end: number
  holds: GoalHold[]
  /** Holds revealed so far (the ball over the line). */
  revealed: number
  /** The hold in progress, or -1. */
  celebrating: number
  /** The segment has played out. */
  done: boolean
  /** Moments the dashboard waits for before it shows their minute (every strike and every foul behind a card, timing.ts), sorted; absent for none. */
  cues?: number[]
  /** How many of them the picture has reached. */
  cued?: number
  /** Minutes the picture plays slower or quicker than `period` (timing.ts `matchPace`: a crowded minute, and the quiet ones that pay it back); absent for none. */
  pace?: PaceSpan[]
}

export const useLiveClock = create<LiveClockState>(() => ({ clock: 0, speed: 1, running: false, period: 330, at: 0, since: 0, spent: Infinity, stopAt: 95, end: 95, holds: [], revealed: 0, celebrating: -1, done: false }))

export interface TimelinePoint {
  /** Fractional match minute. */
  t: number
  /** The goal hold in progress and how far into it (ms). */
  hold: { index: number; elapsed: number } | null
}

type Anchor = Pick<LiveClockState, 'at' | 'since' | 'spent' | 'running' | 'speed' | 'boost' | 'period' | 'end' | 'holds' | 'pace'>

/** Where the match stands at real time `now`: the minute, and the goal hold it is in, if any. Pure. */
export function timeline(s: Anchor, now: number): TimelinePoint {
  const ms = s.period / Math.max(0.01, s.speed * (s.boost ?? 1))
  const pace = s.pace ?? []
  // Travel in picture time (a crowded minute takes longer), so the minute shown is the match time it maps back to
  const on = (t: number, minutes: number) => (pace.length ? toMatch(pace, toPicture(pace, t) + minutes) : t + minutes)
  const span = (a: number, b: number) => (pace.length ? toPicture(pace, b) - toPicture(pace, a) : b - a)
  let t = s.at
  let left = s.running ? Math.max(0, now - s.since) : 0
  for (let i = 0; i < s.holds.length; i++) {
    const h = s.holds[i]
    if (h.t < s.at || h.t > s.end || (h.t === s.at && s.spent >= h.ms)) continue
    const travel = span(t, h.t) * ms
    if (left < travel) return { t: Math.min(h.t, on(t, left / ms)), hold: null }
    left -= travel
    t = h.t
    const start = h.t === s.at ? s.spent : 0
    if (left < h.ms - start) return { t, hold: { index: i, elapsed: start + left } }
    left -= h.ms - start
  }
  return { t: Math.min(s.end, on(t, left / ms)), hold: null }
}

/** The clock as a fractional minute now, for the pitch (kept for the charts and older callers). */
export function fractionalClock(s: Anchor, now: number): number {
  return timeline(s, now).t
}

/** A new anchor at `now` that keeps the picture exactly where it stands (for a pause, a resume or a speed change). */
export function reanchor(s: Anchor, now: number): Pick<LiveClockState, 'at' | 'since' | 'spent'> {
  const p = timeline(s, now)
  return { at: p.t, since: now, spent: p.hold ? p.hold.elapsed : Infinity }
}

/** What React shows at `now`: the whole minute, goals revealed, the celebration on, the segment over (and the cues reached, when there are any). */
export function readout(s: Anchor & Pick<LiveClockState, 'stopAt'> & Partial<Pick<LiveClockState, 'cues'>>, now: number, flightMs = GOAL_FLIGHT_MS): Pick<LiveClockState, 'clock' | 'revealed' | 'celebrating' | 'done' | 'cued'> {
  const p = timeline(s, now)
  let revealed = 0
  for (let i = 0; i < s.holds.length; i++) {
    const h = s.holds[i]
    // Passed, or reached with its hold spent, or in its hold with the ball over the line
    const over = h.t < p.t || (h.t === p.t && (!p.hold || p.hold.index > i || (p.hold.index === i && p.hold.elapsed >= Math.min(flightMs, h.ms))))
    if (over) revealed = i + 1
  }
  const out = { clock: Math.min(s.stopAt, Math.floor(p.t + 1e-9)), revealed, celebrating: p.hold ? p.hold.index : -1, done: !p.hold && p.t >= s.end }
  if (!s.cues) return out
  let cued = 0
  while (cued < s.cues.length && s.cues[cued] <= p.t) cued++
  return { ...out, cued }
}

/** Is a cue in or before the minute shown still to come? Then the dashboard holds that minute back, as it does for a goal. */
export function cuePending(cues: number[], cued: number, clock: number, start: number): boolean {
  for (let i = cued; i < cues.length; i++) {
    const t = cues[i]
    if (Math.floor(t) > clock) return false
    if (t >= start) return true
  }
  return false
}

/**
 * The minute the panels, the scoreboard and the commentary show: the clock's, or the minute before while a goal
 * or a cue of the minute shown is still to come (`cueWaiting`), so nothing is told before the pitch shows it. It
 * may fall below the segment's first minute: a goal at 46' (or in the minute a change in play resumes from) is
 * not on the board before it is struck.
 */
export function panelMinute(holds: readonly Pick<GoalHold, 't'>[], revealed: number, clock: number, start: number, cueWaiting: boolean): number {
  const goalWaiting = holds.some((h, i) => i >= revealed && Math.floor(h.t) <= clock && h.t >= start)
  return goalWaiting || cueWaiting ? clock - 1 : clock
}

/** A new anchor at `now` just past the hold the clock is in (Skip replay): the match carries on from the kick-off. Null outside a hold. */
export function skipHold(s: Anchor, now: number): Pick<LiveClockState, 'at' | 'since' | 'spent'> | null {
  const p = timeline(s, now)
  if (!p.hold) return null
  const h = s.holds[p.hold.index]
  return { at: h.t, since: now, spent: h.ms }
}

/** Is this goal still to be revealed (the ball not yet over the line)? */
export function hiddenGoal(s: Pick<LiveClockState, 'holds' | 'revealed'>, key: string): boolean {
  const i = s.holds.findIndex((h) => h.key === key)
  return i >= 0 && i >= s.revealed
}

/**
 * Drive the clock one whole minute at a time (the quick-season highlights reel): the minute runs
 * on continuously to its end and waits there for the next. Publishing the same minute again (a
 * pause or a resume) keeps the picture where it stands; no goal holds.
 */
export function publishClock(state: Pick<LiveClockState, 'clock' | 'speed' | 'running' | 'period' | 'pace'>, now: number = typeof performance !== 'undefined' ? performance.now() : 0): void {
  const prev = useLiveClock.getState()
  const same = state.clock === prev.clock && prev.end === state.clock + 1 && prev.holds.length === 0 && prev.pace === state.pace
  const base = same ? reanchor(prev, now) : { at: state.clock, since: now, spent: Infinity }
  useLiveClock.setState({ ...base, speed: state.speed, boost: 1, period: state.period, running: state.running, clock: state.clock, stopAt: state.clock, end: state.clock + 1, holds: [], revealed: 0, celebrating: -1, done: false, pace: state.pace })
}
