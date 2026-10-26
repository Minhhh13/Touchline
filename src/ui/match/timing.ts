/**
 * The live pitch's pace and the moments it is built around: how long a match
 * minute lasts on screen at 1x, how fast the ball travels, when each shot is
 * struck (`strikeTimes`) and when the foul behind each booking is committed
 * (`foulTimes`). The ball path, the clock's goal holds and the dashboard's
 * cues all read these, so the pitch, the scoreboard and the commentary agree
 * on when something happens.
 *
 * Pure and deterministic: nothing here draws from any generator (the foul
 * moments come from a hash of the minute and the side).
 */
import type { MatchEvent } from '@engine/types'
import type { PitchPoint } from '@engine/matchDetail'
import { hashString } from '@engine/rng'
import { toShared } from './pitchGeometry'

/**
 * Milliseconds per match minute at 1x on the live pitch. A minute lasts 4.5 s, so a 20-metre pass
 * rolls for about two seconds, a man takes a touch and looks up before he passes, and a corner
 * stands for three seconds before it is swung in; a half takes about three and a half minutes.
 */
export const PITCH_MS = 4500
/** One second of the picture at 1x, in match minutes. */
export const SECOND = 1000 / PITCH_MS
/** A speed in metres per second at 1x as metres per match minute (the ball path's unit of time). */
export function perMinute(mps: number): number {
  return (mps * PITCH_MS) / 1000
}

/** Passes and build-ups stay within this distance (shared units), so the ball never teleports except for a kick-off or a fetch for a restart. */
export const MAX_HOP = 48
/** The ball's speed along the ground, in shared units per match minute: about 11 metres a second at 1x. */
export const PASS_SPEED = 46
/** A hop squeezed to fit before a deadline may go at most this much faster than its own speed. */
export const MAX_SQUEEZE = 1.8

/** Speeds by the kind of ball, in metres per match minute (metres a second at 1x in brackets). */
export const SPEED = {
  /** A firm pass along the ground (11). */
  pass: perMinute(11),
  /** A soft lay-off or a pass back to the keeper (8). */
  soft: perMinute(8),
  /** A ball over the top, a switch, a clearance or a keeper's kick: in the air longer (14). */
  long: perMinute(14),
  /** A through ball into space (12.5). */
  through: perMinute(12.5),
  /** A driven cross or a corner (15). */
  cross: perMinute(15),
  /** A man running with the ball (5). */
  carry: perMinute(5),
  /** A dribble at speed on the break (6.5). */
  dribble: perMinute(6.5),
  /** A shot (22). */
  shot: perMinute(22),
  /** A ball fetched for a restart (6). */
  fetch: perMinute(6),
} as const

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])
const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
const CARD_TYPES = new Set<MatchEvent['type']>(['yellow', 'red'])

/** The minutes an event range covers: from `max(1, from)` to `to`, or to stoppage time (94) when `to` reaches 90. */
export function inRange(e: MatchEvent, from: number, to: number): boolean {
  return e.minute >= Math.max(1, from) && (to < 90 ? e.minute <= to : e.minute <= 94)
}

/**
 * The least match time between two strikes: time for the ball to get from
 * where the last one ended up to where the next is struck, at a brisk pace
 * (`STRIKE_TRAVEL` units a minute), plus the restart in between (a goal kick
 * or the keeper's throw, or a kick-off from the centre spot after a goal).
 */
export const STRIKE_TRAVEL = 70
export const STRIKE_RESTART = 0.35
export const STRIKE_KICKOFF = 0.3

/**
 * The strike moment of every shot in the range (goals, penalties, own goals,
 * chances and saves), keyed by the event's index in `events`. The k shots of
 * a minute m start at m + (i + 0.55) / k and are then spread apart, never
 * leaving their minute (between m + 0.05 and m + 0.95), so that consecutive
 * strikes leave the ball the time it needs to get from one to the next
 * wherever the minutes allow: it never has to cross the pitch in a few
 * frames because two shots, at either end, came close together.
 */
export function strikeTimes(events: MatchEvent[], from: number, to: number): Map<number, number> {
  const byMinute = new Map<number, number[]>()
  events.forEach((e, i) => {
    if (!SHOT_TYPES.has(e.type) || !inRange(e, from, to)) return
    const list = byMinute.get(e.minute) ?? []
    list.push(i)
    byMinute.set(e.minute, list)
  })
  const shots: Array<{ idx: number; t: number; lo: number; hi: number; goal: boolean; at: PitchPoint }> = []
  for (const [m, list] of [...byMinute].sort((a, b) => a[0] - b[0])) {
    list.forEach((idx, i) => {
      const e = events[idx]
      shots.push({ idx, t: m + (i + 0.55) / list.length, lo: m + 0.05, hi: m + 0.95, goal: GOAL_TYPES.has(e.type), at: toShared(e.position ?? { x: 88, y: 50 }, e.side) })
    })
  }
  // The first strike leaves time to get there from the kick-off that starts the range
  if (shots.length) {
    const f = shots[0]
    f.t = Math.min(f.hi, Math.max(f.t, from + STRIKE_KICKOFF + dist({ x: 50, y: 50 }, f.at) / STRIKE_TRAVEL))
    f.lo = Math.max(f.lo, Math.min(f.hi, from + STRIKE_KICKOFF + dist({ x: 50, y: 50 }, f.at) / STRIKE_TRAVEL))
  }
  const gap = (i: number) => {
    const prev = shots[i - 1]
    return prev.goal ? STRIKE_KICKOFF + dist({ x: 50, y: 50 }, shots[i].at) / STRIKE_TRAVEL : STRIKE_RESTART + dist(prev.at, shots[i].at) / STRIKE_TRAVEL
  }
  // Push later strikes on, then earlier ones back, each within its own minute (twice, to settle a crowded run)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < shots.length; i++) shots[i].t = Math.min(shots[i].hi, Math.max(shots[i].t, shots[i - 1].t + gap(i)))
    for (let i = shots.length - 2; i >= 0; i--) shots[i].t = Math.max(shots[i].lo, Math.min(shots[i].t, shots[i + 1].t - gap(i + 1)))
  }
  // Never out of order, whatever the squeeze
  for (let i = 1; i < shots.length; i++) shots[i].t = Math.max(shots[i].t, shots[i - 1].t + 0.01)
  return new Map(shots.map((s) => [s.idx, s.t]))
}

/** One booking's foul: when it is committed, and whether the pitch stages it (a stop and a free kick) or there is no room for it between the shots. */
export interface FoulTime {
  t: number
  staged: boolean
}

/** How long before a strike its build-up starts, and how long after it the restart runs: a foul is staged outside both. */
export const FOUL_CLEAR_BEFORE = 1.4
export const FOUL_CLEAR_AFTER = 0.7
/** The stop for a foul: the whistle, the card and the free kick being set up. */
export const FOUL_STOP = 0.75

/**
 * The moment of the foul behind every booking in the range (yellow and red
 * cards), keyed by the event's index. Each minute with a card has one foul,
 * at a point picked by a hash of the minute and the side, then moved to the
 * nearest point of its minute that keeps clear of every shot's build-up and
 * restart (and of the very end of the range); with no such point it is not staged
 * and its cue is the start of the minute. The cards of one minute share it.
 */
export function foulTimes(events: MatchEvent[], from: number, to: number): Map<number, FoulTime> {
  const strikes = [...strikeTimes(events, from, to).values()]
  const out = new Map<number, FoulTime>()
  const byMinute = new Map<number, number[]>()
  events.forEach((e, i) => {
    if (!CARD_TYPES.has(e.type) || !inRange(e, from, to)) return
    const list = byMinute.get(e.minute) ?? []
    list.push(i)
    byMinute.set(e.minute, list)
  })
  const end = to >= 90 ? Infinity : to + 1
  const taken: number[] = []
  for (const [m, list] of [...byMinute].sort((a, b) => a[0] - b[0])) {
    const first = events[list[0]]
    const h = hashString(`foul-${m}-${first.side}`) >>> 0
    const want = m + 0.2 + ((h % 1000) / 1000) * 0.6
    const clear = (t: number) => t + 0.3 < end && t > from + 0.3 && strikes.every((s) => t < s - FOUL_CLEAR_BEFORE - FOUL_STOP || t > s + FOUL_CLEAR_AFTER) && taken.every((f) => Math.abs(f - t) > FOUL_STOP + 0.5)
    let best: number | null = null
    for (let k = 0; k <= 18; k++) {
      const t = m + 0.05 + k * 0.05
      if (clear(t) && (best === null || Math.abs(t - want) < Math.abs(best - want))) best = t
    }
    const f: FoulTime = best === null ? { t: m + 0.02, staged: false } : { t: best, staged: true }
    if (f.staged) taken.push(f.t)
    for (const idx of list) out.set(idx, f)
  }
  return out
}

/** Every moment in the range that the dashboard waits for before showing its minute: each strike and each foul behind a card, in order. */
export function cueTimes(events: MatchEvent[], from: number, to: number): number[] {
  return [...strikeTimes(events, from, to).values(), ...[...foulTimes(events, from, to).values()].map((f) => f.t)].sort((a, b) => a - b)
}

function dist(a: PitchPoint, b: PitchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
