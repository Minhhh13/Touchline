/**
 * The ball on the live pitch: its keyframes, and how it moves between them.
 *
 * `buildBallPath` (playbook.ts) lays out keyframes for the ball over a range
 * of minutes on one continuous timeline: possession spells that build from
 * the back, progress through midfield, go wide or in behind and end in a
 * cross, a turnover, a set piece or a shot, every shot struck at the event's
 * position on the moment `strikeTimes` (timing.ts) gives it, which the clock
 * uses to hold for a goal, so the two always agree.
 *
 * `ballAt` moves the ball along a smooth curve through the keyframes with an
 * ease in and out, lifting long balls, crosses and clearances into an arc.
 *
 * Pure and deterministic for a seed, so it can be tested without a DOM. It
 * never touches the game's generator: the keyframes are decoration.
 */
import type { MatchEvent } from '@engine/types'
import type { PitchPoint } from '@engine/matchDetail'
import type { PlacedPlayer, Side } from './pitchGeometry'
import { HOLD_MS, type GoalHold } from './clockStore'
import { strikeTimes } from './timing'
import { REPLAY } from './keyMoments'

export { buildBallPath } from './playbook'
export { cueTimes, foulTimes, MAX_HOP, MAX_SQUEEZE, PASS_SPEED, STRIKE_KICKOFF, STRIKE_RESTART, STRIKE_TRAVEL, strikeTimes } from './timing'

export type BallKind = 'kickoff' | 'carry' | 'pass' | 'shot' | 'goal' | 'save' | 'miss' | 'reset'

/** What a hop is in footballing terms, for the commentary, the trail on the pitch and the shape (shape.ts). */
export type PlayTag =
  | 'short'
  | 'forward'
  | 'back'
  | 'switch'
  | 'long'
  | 'through'
  | 'cross'
  | 'cutback'
  | 'layoff'
  | 'dribble'
  | 'tackle'
  | 'interception'
  | 'press'
  | 'clearance'
  | 'claim'
  | 'header'
  | 'deflection'
  | 'rebound'
  | 'foul'
  | 'distribution'
  | 'out'
  | 'setpiece'
/** The phase of the move a keyframe belongs to. */
export type Phase = 'buildup' | 'progression' | 'final' | 'counter' | 'setpiece'
/** A restart the pitch stages before it is taken. */
export type SetPieceKind = 'kickoff' | 'corner' | 'freekick' | 'penalty' | 'goalkick' | 'throw'

export interface BallKeyframe {
  /** Match minute, fractional. */
  t: number
  x: number
  y: number
  kind: BallKind
  /** The side in possession once the ball arrives. */
  side: Side
  /** The man who has it, when one does. */
  holder?: string
  /** Peak height of the hop that arrives here, 0 (along the ground) to 1 (a high ball). */
  loft?: number
  /** Sideways bend of that hop as a share of its length (signed). */
  bend?: number
  /** What the hop that arrives here is (a switch, a cross, a tackle...). */
  play?: PlayTag
  /** The phase of play once it arrives. */
  phase?: Phase
  /** A restart set up here: the ball waits on this spot until `until`, then it is taken. */
  setPiece?: { kind: SetPieceKind; until: number }
}

/** How a side plays, from its instructions (the ball path's tempo, its long balls, its width and its press). */
export interface PlayStyle {
  tempo: 'slow' | 'standard' | 'fast'
  passing: 'short' | 'mixed' | 'direct'
  width: 'narrow' | 'standard' | 'wide'
  pressing: 'low' | 'mid' | 'high'
}

export interface PossessionInput {
  /** First and last minute to lay out (stoppage-time events are included when `to` reaches 90). */
  from: number
  to: number
  /** The home side's share of the pressure per five-minute bin (missing bins read as even). */
  momentum: number[]
  events: MatchEvent[]
  home: PlacedPlayer[]
  away: PlacedPlayer[]
  seed: string
  /**
   * Where the ball stands when the stretch begins, so a path can carry on from where the last one
   * left it (epochs.ts: a change in play, the stretch from 71). Absent, or on the centre spot with
   * nobody on it, the stretch starts with a kick-off (by `side`) at 0 and 46, and elsewhere (a
   * highlight's build-up) with the keeper of the side on top rolling it out.
   */
  start?: { x: number; y: number; side: Side; holder?: string }
  /** Each side's style of play (its instructions); standard when absent. */
  styles?: Partial<Record<Side, PlayStyle>>
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/** The clock holds for the goals in a range: our goals get the full celebration, theirs a short one; a still frame when motion is reduced. With `replay` (and motion) each hold ends with the goal's replay (keyMoments.ts `REPLAY`). */
export function goalHolds(events: MatchEvent[], from: number, to: number, opts: { userSide?: Side; reduced?: boolean; replay?: boolean } = {}): GoalHold[] {
  const times = strikeTimes(events, from, to)
  const out: GoalHold[] = []
  for (const [idx, t] of times) {
    const e = events[idx]
    if (!GOAL_TYPES.has(e.type)) continue
    const tone: GoalHold['tone'] = !opts.userSide ? 'neutral' : e.side === opts.userSide ? 'ours' : 'theirs'
    const replay = opts.replay && !opts.reduced ? REPLAY.ms : 0
    out.push({ t, ms: (opts.reduced ? HOLD_MS.reduced : HOLD_MS[tone]) + replay, side: e.side, key: String(idx), tone, ...(replay ? { replay } : {}) })
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface BallState extends PitchPoint {
  /** Height above the ground, 0..1 (the top of a high ball). */
  h: number
  kind: BallKind
  side: Side
  /** The man in control: on the ball during a carry, the receiver as a pass arrives. */
  holder?: string
  /** The keyframe the ball last reached (its index in the path), the one it is moving towards, and how far along it is (0..1, eased). */
  index: number
  next: BallKeyframe | null
  progress: number
}

/** Ease in and out: no jolt as the ball is struck or trapped (smootherstep). */
export function easeInOut(f: number): number {
  const x = clamp(f, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** A kicked ball: a gentler ease in and out (smoothstep), so its top speed is only half as much again as its mean. */
export function easePass(f: number): number {
  const x = clamp(f, 0, 1)
  return x * x * (3 - 2 * x)
}

/** The height of a lofted hop `f` of the way along: a parabola peaking at `loft` half-way. */
export function arcHeight(loft: number, f: number): number {
  const x = clamp(f, 0, 1)
  return Math.max(0, loft) * 4 * x * (1 - x)
}

/** A point `f` of the way along a hop from `a` to `b` that bends sideways by `bend` of its length (a quadratic curve). */
export function bentPoint(a: PitchPoint, b: PitchPoint, bend: number, f: number): PitchPoint {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  // The control point sits off the midpoint, at right angles to the hop
  const cx = mx - dy * bend * 2
  const cy = my + dx * bend * 2
  const u = 1 - f
  return { x: u * u * a.x + 2 * u * f * cx + f * f * b.x, y: u * u * a.y + 2 * u * f * cy + f * f * b.y }
}

/** Where the ball is at time `t`: along the hop between keyframes with its ease, bend and arc, or on the last keyframe it reached when `jump` is set. */
export function ballAt(path: BallKeyframe[], t: number, jump = false): BallState | null {
  if (!path.length) return null
  if (t <= path[0].t) return { ...path[0], h: 0, index: 0, next: path[1] ?? null, progress: 0 }
  let lo = 0
  let hi = path.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (path[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const a = path[lo]
  const b = path[lo + 1]
  if (!b || jump) return { ...a, h: 0, index: lo, next: b ?? null, progress: 1 }
  const raw = Math.min(1, (t - a.t) / Math.max(0.0001, b.t - a.t))
  const p = smoothPoint(path, lo, raw)
  const h = arcHeight(b.loft ?? 0, raw)
  // On the ball during a carry; the receiver once a pass has all but arrived
  const holder = b.kind === 'carry' ? b.holder : raw >= 0.92 ? b.holder : raw <= 0.08 && b.kind !== 'reset' ? a.holder : undefined
  return { x: p.x, y: p.y, h, kind: raw >= 1 ? b.kind : a.kind, side: raw >= 0.5 ? b.side : a.side, holder, index: lo, next: b, progress: raw }
}

/** Keyframes where the ball changes direction at once (struck, saved, in the net, placed for a restart): no velocity carries through them. */
const SHARP = new Set<BallKind>(['kickoff', 'shot', 'goal', 'save', 'miss', 'reset'])

function velocity(a: BallKeyframe, b: BallKeyframe): PitchPoint {
  const dt = Math.max(0.0001, b.t - a.t)
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }
}

/**
 * The ball's velocity through keyframe k, shared by the hop into it and the hop out of it, so the
 * ball never stops dead at a keyframe nor turns on the spot: the mean of the two hops' velocities,
 * no faster than twice the slower of them (a ball at a man's feet slows the pass that reaches him).
 * Through a sharp keyframe (a strike, a save, a restart) each hop keeps its own velocity.
 */
function tangent(path: BallKeyframe[], k: number, side: 'in' | 'out'): PitchPoint {
  const prev = path[k - 1]
  const cur = path[k]
  const next = path[k + 1]
  const vin = prev ? velocity(prev, cur) : null
  const vout = next ? velocity(cur, next) : null
  if (SHARP.has(cur.kind) || !vin || !vout) return (side === 'in' ? vin : vout) ?? vin ?? vout ?? { x: 0, y: 0 }
  const m = { x: (vin.x + vout.x) / 2, y: (vin.y + vout.y) / 2 }
  const cap = 2 * Math.min(Math.hypot(vin.x, vin.y), Math.hypot(vout.x, vout.y))
  const len = Math.hypot(m.x, m.y)
  return len > cap && len > 0 ? { x: (m.x * cap) / len, y: (m.y * cap) / len } : m
}

/**
 * A point `f` (linear in time) of the way along the hop from keyframe `lo`: a cubic Hermite curve
 * with the shared velocities at both ends, so the speed and direction are continuous from one hop
 * to the next, plus the hop's own sideways bend. The instant hops of a goal (into the net, back
 * to the centre spot, drawn during the clock's hold) are straight lines.
 */
export function smoothPoint(path: BallKeyframe[], lo: number, f: number): PitchPoint {
  const a = path[lo]
  const b = path[lo + 1]
  if (!b) return { x: a.x, y: a.y }
  const dt = b.t - a.t
  if (b.kind === 'goal' || b.kind === 'kickoff' || dt < 0.02) return bentPoint(a, b, 0, f)
  const m0 = tangent(path, lo, 'out')
  const m1 = tangent(path, lo + 1, 'in')
  const f2 = f * f
  const f3 = f2 * f
  const h00 = 2 * f3 - 3 * f2 + 1
  const h10 = f3 - 2 * f2 + f
  const h01 = -2 * f3 + 3 * f2
  const h11 = f3 - f2
  let x = h00 * a.x + h10 * dt * m0.x + h01 * b.x + h11 * dt * m1.x
  let y = h00 * a.y + h10 * dt * m0.y + h01 * b.y + h11 * dt * m1.y
  const bend = b.bend ?? 0
  if (bend) {
    // Off the line at right angles, most half-way (as bentPoint bends it)
    const k = 4 * f * (1 - f) * bend
    x += -(b.y - a.y) * k
    y += (b.x - a.x) * k
  }
  return { x: clamp(x, 0, 100), y: clamp(y, 0, 100) }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
