/*
 * The match day's mix: how loud the crowd's bed is at each moment (it rises with an attack, a chance, a goal and a
 * tight finish, and falls back in a quiet spell), and one shared budget for the two hooks that sound the match
 * (useMatchSounds: whistles, chances, cards, goals; useBallSounds: the ball, swells and the bed), so their sounds
 * never stack, above all at 3x and 4x. A goal ducks everything under it for its roar, the bed included.
 *
 * Pure: the mood is a function of the drawn ball path and the match time, and the mixer of the real clock (ms) it is
 * handed. It never reads the game's RNG; the path is decoration over the decided events.
 */
import type { BallKeyframe } from '../match/possession'

/** What a sound is to the mix. */
export type MixKind = 'whistle' | 'goal' | 'crowd' | 'swell' | 'strike' | 'ball' | 'chime'

/** The mix's constants, real milliseconds. */
export const MIX = {
  /** Two crowd reactions (an "ooh", a save) never closer than this at 1x and 2x... */
  crowdGap: 350,
  /** ...and this at 3x and up, where a busy spell passes in a second. */
  crowdGapFast: 900,
  /** A swell never this soon after a crowd reaction (it would only blur the "ooh"). */
  swellQuiet: 1600,
  /** After a goal's net, nothing but the whistle and the goal itself for this long: the roar has the stadium. */
  goalDuck: 3200,
  /** The window the budget counts over. */
  window: 1000,
  /** At most this many sounds in the window at 1x and 2x (whistles and goals apart)... */
  budget: 5,
  /** ...and this many at 3x and up. */
  budgetFast: 3,
} as const

/** The speed from which the mix thins harder. */
export const FAST_SPEED = 3

export interface MixState {
  crowdAt?: number
  goalAt?: number
  /** When each budgeted sound played, oldest first. */
  played: number[]
}

export function createMix(): MixState {
  return { played: [] }
}

/** The kinds the budget may drop: the background. A chance, a strike or a chime counts toward it but always plays. */
const DROPPABLE: ReadonlySet<MixKind> = new Set(['ball', 'swell'])

/**
 * Whether a sound may play now, and the bookkeeping if it does (`s` is updated). Whistles always play; a goal always
 * plays and ducks the rest; a crowd reaction keeps its gap; a swell keeps clear of reactions and is off at speed; the
 * ball and swells give way when the window's budget is spent.
 */
export function admit(s: MixState, kind: MixKind, now: number, speed: number): boolean {
  if (kind === 'whistle') return true
  if (kind === 'goal') {
    s.goalAt = now
    s.crowdAt = now
    return true
  }
  const fast = speed >= FAST_SPEED
  if (s.goalAt !== undefined && now >= s.goalAt && now - s.goalAt < MIX.goalDuck) return false
  while (s.played.length && (now - s.played[0] >= MIX.window || now < s.played[0])) s.played.shift()
  if (kind === 'crowd') {
    if (s.crowdAt !== undefined && now >= s.crowdAt && now - s.crowdAt < (fast ? MIX.crowdGapFast : MIX.crowdGap)) return false
    s.crowdAt = now
  } else if (kind === 'swell') {
    if (fast) return false
    if (s.crowdAt !== undefined && now >= s.crowdAt && now - s.crowdAt < MIX.swellQuiet) return false
  }
  if (DROPPABLE.has(kind) && s.played.length >= (fast ? MIX.budgetFast : MIX.budget)) return false
  s.played.push(now)
  return true
}

/** True while a goal's roar holds the mix (the bed is hushed and restarts after it). */
export function ducked(s: MixState, now: number): boolean {
  return s.goalAt !== undefined && now >= s.goalAt && now - s.goalAt < MIX.goalDuck
}

/** The one mix both match hooks share on a page (presentation state, never saved). */
export const matchMix: MixState = createMix()

/** The mood's terms: a floor, the ball's danger, the lift after a chance and a goal, and a tight finish. */
export const MOOD = {
  floor: 0.3,
  /** The most the ball's position adds, in the attacking half (depth 50 to 100). */
  danger: 0.25,
  /** A goal's lift, falling away over about `goalFade` minutes. */
  goal: 0.5,
  goalFade: 2.5,
  /** A shot's lift (a save, a miss). */
  shot: 0.22,
  shotFade: 0.8,
  /** A level or one-goal game from 70': the crowd on edge, up to this much by 90'. */
  tension: 0.2,
} as const

/** The keyframe the ball is at, or last left, at `t` (binary search; the path is sorted by time). */
function at(path: readonly BallKeyframe[], t: number): BallKeyframe | null {
  let lo = 0
  let hi = path.length - 1
  let out = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (path[mid].t <= t) {
      out = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return out >= 0 ? path[out] : null
}

/**
 * How roused the crowd is at match time `t`, 0.1 to 1 in steps of 0.1 (so the bed's scores are shared): the floor, the
 * ball's danger, the lift after the latest goals and shots, and from 70' the tension of a level or one-goal game.
 */
export function crowdMood(path: readonly BallKeyframe[], t: number): number {
  let m = MOOD.floor
  const k = at(path, t)
  if (k && k.kind !== 'reset' && k.kind !== 'kickoff') {
    const depth = k.side === 'home' ? k.x : 100 - k.x
    m += MOOD.danger * Math.max(0, Math.min(1, (depth - 50) / 50))
  }
  let home = 0
  let away = 0
  for (const p of path) {
    if (p.t > t) break
    const dt = t - p.t
    if (p.kind === 'goal') {
      if (p.side === 'home') home++
      else away++
      m += MOOD.goal * Math.exp(-dt / MOOD.goalFade)
    } else if (p.kind === 'save' || p.kind === 'miss') m += MOOD.shot * Math.exp(-dt / MOOD.shotFade)
  }
  if (t >= 70 && Math.abs(home - away) <= 1) m += MOOD.tension * Math.min(1, (t - 70) / 20)
  return Math.round(Math.max(0.1, Math.min(1, m)) * 10) / 10
}

/**
 * The bed's level for a mood (the hook's `bed` is the screen's share: 1 on the match day, less in the reel): a quiet
 * spell at under half, a roused crowd at full, a little under at 3x and up, where the picture hurries and the bed
 * should not crowd it. Rounded to tenths.
 */
export function bedLevel(bed: number, mood: number, speed: number): number {
  const v = bed * (0.4 + 0.6 * Math.max(0, Math.min(1, mood))) * (speed >= FAST_SPEED ? 0.8 : 1)
  return Math.round(Math.max(0, Math.min(1, v)) * 10) / 10
}
