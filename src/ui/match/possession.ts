/**
 * A procedural ball for the live pitch. Given the momentum series, the events
 * with their positions and both sides' placements, it lays out keyframes for
 * the ball over a range of minutes: passes between team-mates of the side with
 * the momentum when nothing is happening, a build-up towards the box in the
 * minute before a chance, the shot itself, the finish (into the net, into the
 * keeper's arms or wide) and a kick-off after a goal.
 *
 * Pure and deterministic for a seed, so it can be tested without a DOM. It
 * never touches the game's generator: the keyframes are decoration.
 */
import type { MatchEvent } from '@engine/types'
import { binOf, type PitchPoint } from '@engine/matchDetail'
import { Rng } from '@engine/rng'
import { onPitchAt, other, toShared, type PlacedPlayer, type Side } from './pitchGeometry'

export type BallKind = 'pass' | 'shot' | 'goal' | 'save' | 'miss' | 'reset'

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
  /** Where the ball stands when the stretch begins (absent: the centre spot), so a path can carry on from where the last one left it. */
  start?: { x: number; y: number; side: Side; holder?: string }
}

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])
const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
/** Passes and build-ups stay within this distance, so the ball never teleports except for a kick-off. */
export const MAX_HOP = 48

export function buildBallPath(input: PossessionInput): BallKeyframe[] {
  const { from, to, momentum, home, away } = input
  if (!home.length || !away.length) return []
  const rng = new Rng(`ball-${input.seed}-${from}`)
  const out: BallKeyframe[] = []
  let lastT = -1
  const push = (k: BallKeyframe) => {
    k.t = Math.max(k.t, lastT + 0.01)
    k.x = clamp(k.x, 0, 100)
    k.y = clamp(k.y, 0, 100)
    lastT = k.t
    out.push(k)
  }
  const byMinute = new Map<number, MatchEvent[]>()
  for (const e of input.events) {
    if (!SHOT_TYPES.has(e.type)) continue
    if (e.minute < Math.max(1, from) || (to < 90 ? e.minute > to : e.minute > 94)) continue
    const list = byMinute.get(e.minute) ?? []
    list.push(e)
    byMinute.set(e.minute, list)
  }
  const last = to >= 90 ? Math.max(90, ...byMinute.keys()) : to
  const squad = (side: Side, minute: number) => onPitchAt(side === 'home' ? home : away, Math.min(minute, 89))
  const outfield = (side: Side, minute: number) => {
    const all = squad(side, minute)
    const men = all.filter((p) => p.position !== 'GK')
    return men.length ? men : all
  }
  const keeper = (side: Side, minute: number) => squad(side, minute).find((p) => p.position === 'GK')
  const goalLine = (side: Side) => (side === 'home' ? 100 : 0)

  let pos: PitchPoint = input.start ? { x: input.start.x, y: input.start.y } : { x: 50, y: 50 }
  let side: Side = input.start ? input.start.side : from <= 1 ? 'home' : 'away'
  let holder: string | undefined = input.start?.holder

  /** Pass to a team-mate: nearer men more likely, forward passes favoured, and pulled towards `goal` when given. */
  const passTo = (s: Side, minute: number, t: number, goal?: PitchPoint) => {
    const men = outfield(s, minute).filter((p) => p.psId !== holder)
    if (!men.length) return
    // Within a hop of the ball, and of the goal when the move is building towards one
    const near = men.filter((p) => dist(p, pos) <= MAX_HOP && (!goal || dist(p, goal) <= MAX_HOP))
    const pool = near.length ? near : [men.reduce((a, b) => (dist(a, pos) < dist(b, pos) ? a : b))]
    const forward = s === 'home' ? 1 : -1
    const pick = rng.pickWeighted(pool, (p) => {
      const d = dist(p, pos)
      const progress = (p.x - pos.x) * forward
      let w = 1 / (1 + d / 25)
      if (progress > 0) w *= 1.6
      if (goal) w *= 1 / (1 + dist(p, goal) / 20)
      return w + 0.02
    })
    pos = { x: pick.x, y: pick.y }
    holder = pick.psId
    side = s
    push({ t, x: pos.x, y: pos.y, kind: 'pass', side: s, holder })
  }

  /** The ball changes hands: the nearest man of the other side takes it. */
  const turnover = (s: Side, minute: number, t: number) => {
    const men = outfield(s, minute)
    if (!men.length) return
    const taker = men.reduce((a, b) => (dist(a, pos) < dist(b, pos) ? a : b))
    pos = { x: taker.x, y: taker.y }
    holder = taker.psId
    side = s
    push({ t, x: pos.x, y: pos.y, kind: 'pass', side: s, holder })
  }

  for (let m = Math.max(1, from); m <= last; m++) {
    const evs = byMinute.get(m)
    if (evs?.length) {
      const span = 1 / evs.length
      evs.forEach((ev, i) => {
        const base = m + i * span
        const s = ev.side
        const target = toShared(ev.position ?? { x: 88, y: 50 }, s)
        // Build-up: a pass towards the box, then the shooter on the ball
        if (side !== s) turnover(s, m, base)
        passTo(s, m, base + 0.15 * span, target)
        const men = outfield(s, m)
        const shooter = men.find((p) => p.psId === ev.playerId) ?? (men.length ? men.reduce((a, b) => (dist(a, target) < dist(b, target) ? a : b)) : undefined)
        holder = shooter?.psId
        pos = target
        push({ t: base + 0.45 * span, x: target.x, y: target.y, kind: 'shot', side: s, holder })
        const gk = keeper(other(s), m)
        if (GOAL_TYPES.has(ev.type)) {
          pos = { x: goalLine(s), y: 50 + rng.float(-3, 3) }
          push({ t: base + 0.6 * span, x: pos.x, y: pos.y, kind: 'goal', side: s })
          pos = { x: 50, y: 50 }
          holder = undefined
          side = other(s)
          push({ t: base + 0.9 * span, x: 50, y: 50, kind: 'reset', side })
        } else if (ev.type === 'save') {
          pos = gk ? { x: gk.x, y: gk.y } : { x: s === 'home' ? 96 : 4, y: 50 }
          holder = gk?.psId
          side = other(s)
          push({ t: base + 0.6 * span, x: pos.x, y: pos.y, kind: 'save', side, holder })
        } else {
          pos = { x: goalLine(s), y: 50 + (rng.chance(0.5) ? 1 : -1) * rng.float(14, 24) }
          push({ t: base + 0.6 * span, x: pos.x, y: pos.y, kind: 'miss', side: s })
          // Goal kick
          pos = gk ? { x: gk.x, y: gk.y } : { x: s === 'home' ? 96 : 4, y: 50 }
          holder = gk?.psId
          side = other(s)
          push({ t: base + 0.9 * span, x: pos.x, y: pos.y, kind: 'pass', side, holder })
        }
      })
      continue
    }
    // Nothing on the log this minute: the side with the momentum has the ball, unless the next
    // minute brings a chance, when the side about to have it builds up.
    const next = byMinute.get(m + 1)
    const pHome = momentum[binOf(m)] ?? 0.5
    const s: Side = next?.length ? next[0].side : rng.next() < pHome ? 'home' : 'away'
    const goal = next?.length ? toShared(next[0].position ?? { x: 88, y: 50 }, s) : undefined
    if (s !== side) turnover(s, m, m)
    else passTo(s, m, m, goal)
    passTo(s, m, m + 0.5, goal)
  }
  return out
}

export interface BallState extends PitchPoint {
  kind: BallKind
  side: Side
  holder?: string
  /** The keyframe the ball last reached (its index in the path), the one it is moving towards, and how far along it is (0..1). */
  index: number
  next: BallKeyframe | null
  progress: number
}

/** Where the ball is at time `t`: between keyframes with an ease, or on the last one it reached when `jump` is set. */
export function ballAt(path: BallKeyframe[], t: number, jump = false): BallState | null {
  if (!path.length) return null
  if (t <= path[0].t) return { ...path[0], index: 0, next: null, progress: 1 }
  let lo = 0
  let hi = path.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (path[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  const a = path[lo]
  const b = path[lo + 1]
  if (!b || jump) return { ...a, index: lo, next: b ?? null, progress: 1 }
  const raw = (t - a.t) / Math.max(0.0001, b.t - a.t)
  const f = b.kind === 'reset' ? Math.min(1, raw * 1.5) : ease(Math.min(1, raw))
  const settled = b.kind === 'reset' && raw >= 0.67
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, kind: settled ? b.kind : a.kind, side: settled || f >= 1 ? b.side : a.side, holder: settled || f >= 1 ? b.holder : undefined, index: lo, next: b, progress: f }
}

function ease(f: number): number {
  return f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2
}

function dist(a: PitchPoint, b: PitchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
