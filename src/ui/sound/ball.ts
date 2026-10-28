/*
 * The ball's own sounds on the live pitch, read from the same keyframes the pitch draws (`BallKeyframe`, playbook.ts):
 * a kick as the ball leaves each keyframe (a soft touch for a dribble, a pass, a firmer long ball or goal kick, a
 * strike for a shot, a duller header), a throw's soft slap, the keeper's gloves as a save arrives, the clang of the
 * woodwork, and the crowd swelling as an attack reaches the box. Pure: a function of the path and two readings of
 * the clock, thinned so a busy spell never machine-guns, quieter at speed, silent through a goal's hold and a skip.
 * It never reads the game's RNG: the keyframes are decoration over the decided events.
 */
import type { BallKeyframe } from '../match/possession'
import type { TimelinePoint } from '../match/clockStore'

export type BallTouch = 'touch' | 'pass' | 'long' | 'strike' | 'header' | 'throw' | 'goalkick' | 'keeper' | 'woodwork'

export interface BallCue {
  /** Match time (fractional minute) when it sounds. */
  t: number
  touch: BallTouch
  /** How hard, 0 to 1, before the speed's scaling. */
  power: number
}

export interface SwellCue {
  t: number
  /** How close to goal the attack is, 0 to 1. */
  danger: number
}

/** The plays that send the ball long and high: a firmer kick. */
const LONG = new Set(['long', 'switch', 'clearance', 'cross', 'distribution', 'through'])
/** The hop that leaves the shooter's keyframe (kind 'shot', at the strike moment) arrives as one of these: that hop is the strike. */
const SHOTS = new Set(['goal', 'save', 'miss'])

/** Every kick, throw, save and woodwork in the path, by match time. */
export function ballCues(path: readonly BallKeyframe[]): BallCue[] {
  const out: BallCue[] = []
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    // A reset (the ball carried back for a restart) is not a kick
    if (b.kind === 'reset') continue
    const t = a.setPiece ? a.setPiece.until : a.t
    const sp = a.setPiece?.kind
    let touch: BallTouch
    let power: number
    if (sp === 'throw') [touch, power] = ['throw', 0.5]
    else if (sp === 'goalkick') [touch, power] = ['goalkick', 0.85]
    else if (b.play === 'header') [touch, power] = ['header', SHOTS.has(b.kind) ? 0.8 : 0.55]
    else if (SHOTS.has(b.kind)) [touch, power] = ['strike', 1]
    else if (b.play === 'dribble' || b.kind === 'carry') [touch, power] = ['touch', 0.35]
    else if (b.play && LONG.has(b.play)) [touch, power] = ['long', 0.75]
    else if (sp === 'corner' || sp === 'freekick' || sp === 'penalty') [touch, power] = ['long', 0.8]
    else [touch, power] = ['pass', 0.5]
    out.push({ t, touch, power })
    // The ball arriving: the gloves on a save, the woodwork on a shot that comes back off it
    if (b.kind === 'save') out.push({ t: b.t, touch: 'keeper', power: 0.9 })
    else if (b.kind === 'miss' && path[i + 2]?.play === 'rebound') out.push({ t: b.t, touch: 'woodwork', power: 1 })
  }
  return out.sort((x, y) => x.t - y.t)
}

/** The side attacking toward x = 100 is home; a keyframe this deep in the other half is danger. */
export const DANGER_FROM = 78

/** The crowd rising each time an attack first gets into the last fifth of the pitch (the box and its edge). */
export function swellCues(path: readonly BallKeyframe[]): SwellCue[] {
  const out: SwellCue[] = []
  let inside = false
  for (const k of path) {
    const depth = k.side === 'home' ? k.x : 100 - k.x
    const now = depth >= DANGER_FROM && k.kind !== 'reset' && k.kind !== 'kickoff'
    if (now && !inside) out.push({ t: k.t, danger: Math.min(1, (depth - DANGER_FROM) / (100 - DANGER_FROM) + 0.3) })
    inside = now
  }
  return out
}

/** Below this real gap (ms) two ordinary touches never both sound. */
export const BALL_GAP_MS = 350
/** The touches that always sound, whatever the gap: the ones a viewer waits for. */
export const ALWAYS: ReadonlySet<BallTouch> = new Set(['strike', 'keeper', 'woodwork'])
/** A clock step longer than this (match minutes) is a skip: nothing of the ball sounds. */
export const BALL_MAX_STEP = 1

/** How loud the ball is at a playback speed: full at 1x, quieter as the picture hurries. */
export function speedScale(speed: number): number {
  return speed <= 1 ? 1 : speed <= 2 ? 0.75 : 0.55
}

/**
 * The ball's cues passed between two readings of the clock, thinned: never through a goal's hold (the net and the
 * roar have it) or a skip, never backwards, an ordinary touch only `BALL_GAP_MS` after the last one that sounded (the
 * first of a cluster wins), and at 3x and up only the long balls and the touches in `ALWAYS`. `last` keeps when the
 * last ordinary touch sounded (real ms) and is updated.
 */
export function dueBallCues(prev: TimelinePoint, cur: TimelinePoint, cues: readonly BallCue[], speed: number, now: number, last: { at?: number }): BallCue[] {
  if (cur.t <= prev.t + 1e-9 || cur.t - prev.t > BALL_MAX_STEP || cur.hold || prev.hold) return []
  const out: BallCue[] = []
  for (const c of cues) {
    if (c.t <= prev.t || c.t > cur.t) continue
    if (ALWAYS.has(c.touch)) {
      out.push(c)
      continue
    }
    if (speed >= 3 && c.touch !== 'long' && c.touch !== 'goalkick') continue
    if (last.at !== undefined && now - last.at < BALL_GAP_MS && now >= last.at) continue
    last.at = now
    out.push(c)
  }
  return out
}

/** The swells passed between two readings of the clock (the voices' own thinning keeps them apart). */
export function dueSwells(prev: TimelinePoint, cur: TimelinePoint, swells: readonly SwellCue[]): SwellCue[] {
  if (cur.t <= prev.t + 1e-9 || cur.t - prev.t > BALL_MAX_STEP || cur.hold) return []
  return swells.filter((s) => s.t > prev.t && s.t <= cur.t)
}

/** The goals arriving in the net between two readings (the highlights reel, which has no goal holds of its own). */
export function dueGoals(prev: TimelinePoint, cur: TimelinePoint, path: readonly BallKeyframe[]): BallKeyframe[] {
  if (cur.t <= prev.t + 1e-9 || cur.t - prev.t > BALL_MAX_STEP) return []
  return path.filter((k) => k.kind === 'goal' && k.t > prev.t && k.t <= cur.t)
}
