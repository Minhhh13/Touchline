/**
 * A procedural ball for the live pitch. Given the momentum series, the events
 * with their positions and both sides' placements, it lays out keyframes for
 * the ball over a range of minutes on one continuous timeline: a kick-off,
 * then cycles of a carry (the man on the ball runs with it a few yards) and a
 * pass to a team-mate of the side with the momentum, an interception now and
 * then, a build-up towards the box before a chance, the strike itself at the
 * event's position, and its end (a kick-off after a goal, the keeper's
 * distribution after a save, a goal kick after a miss).
 *
 * Every hop takes time in proportion to its length, so the ball never covers
 * half the pitch in a frame, and `ballAt` moves it along a gently bent curve
 * with an ease in and out, lifting long balls, crosses and clearances into an
 * arc. The strike moment of every shot comes from `strikeTimes`, which the
 * ticker uses to hold the clock for a goal, so the two always agree.
 *
 * Pure and deterministic for a seed, so it can be tested without a DOM. It
 * never touches the game's generator: the keyframes are decoration.
 */
import type { MatchEvent } from '@engine/types'
import { binOf, type PitchPoint } from '@engine/matchDetail'
import { Rng } from '@engine/rng'
import { onPitchAt, other, toShared, type PlacedPlayer, type Side } from './pitchGeometry'
import { HOLD_MS, type GoalHold } from './clockStore'

export type BallKind = 'kickoff' | 'carry' | 'pass' | 'shot' | 'goal' | 'save' | 'miss' | 'reset'

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
  /** Where the ball stood when the previous segment ended (a replay from 71 picks up from the 70th-minute stop); a kick-off from the centre spot when missing. */
  startAt?: { x: number; y: number; side: Side; holder?: string }
}

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])
const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])
/** Passes and build-ups stay within this distance, so the ball never teleports except for a kick-off. */
export const MAX_HOP = 48
/** The ball's top speed along the ground, in shared units per match minute (a hop of 30 takes about two thirds of a minute). */
export const PASS_SPEED = 46
/** A strike flies at about twice that. */
export const SHOT_SPEED = 120

/** The minutes an event range covers: from `max(1, from)` to `to`, or to stoppage time (94) when `to` reaches 90. */
function inRange(e: MatchEvent, from: number, to: number): boolean {
  return e.minute >= Math.max(1, from) && (to < 90 ? e.minute <= to : e.minute <= 94)
}

/**
 * The strike moment of every shot in the range (goals, penalties, own goals,
 * chances and saves): the k shots of a minute m fall at m + (i + 0.55) / k.
 * Keyed by the event's index in `events`.
 */
export function strikeTimes(events: MatchEvent[], from: number, to: number): Map<number, number> {
  const byMinute = new Map<number, number[]>()
  events.forEach((e, i) => {
    if (!SHOT_TYPES.has(e.type) || !inRange(e, from, to)) return
    const list = byMinute.get(e.minute) ?? []
    list.push(i)
    byMinute.set(e.minute, list)
  })
  const out = new Map<number, number>()
  for (const [m, list] of byMinute) list.forEach((idx, i) => out.set(idx, m + (i + 0.55) / list.length))
  return out
}

/** The clock holds for the goals in a range: our goals get the full celebration, theirs a short one; a still frame when motion is reduced. */
export function goalHolds(events: MatchEvent[], from: number, to: number, opts: { userSide?: Side; reduced?: boolean } = {}): GoalHold[] {
  const times = strikeTimes(events, from, to)
  const out: GoalHold[] = []
  for (const [idx, t] of times) {
    const e = events[idx]
    if (!GOAL_TYPES.has(e.type)) continue
    const tone: GoalHold['tone'] = !opts.userSide ? 'neutral' : e.side === opts.userSide ? 'ours' : 'theirs'
    out.push({ t, ms: opts.reduced ? HOLD_MS.reduced : HOLD_MS[tone], side: e.side, key: String(idx), tone })
  }
  return out.sort((a, b) => a.t - b.t)
}

export function buildBallPath(input: PossessionInput): BallKeyframe[] {
  const { from, to, momentum, home, away } = input
  if (!home.length || !away.length) return []
  const rng = new Rng(`ball-${input.seed}-${from}`)
  const out: BallKeyframe[] = []
  const push = (k: BallKeyframe) => {
    const last = out[out.length - 1]
    if (last && k.t <= last.t) k.t = last.t + 0.001
    k.x = clamp(k.x, 0, 100)
    k.y = clamp(k.y, 0, 100)
    out.push(k)
  }
  const strikes = strikeTimes(input.events, from, to)
  const shots = [...strikes.entries()].map(([idx, t]) => ({ ev: input.events[idx], t })).sort((a, b) => a.t - b.t)
  const end = to >= 90 ? Math.max(90, ...shots.map((s) => s.ev.minute)) + 1 : to + 1
  const squad = (side: Side, minute: number) => onPitchAt(side === 'home' ? home : away, Math.min(Math.floor(minute), 89))
  const outfield = (side: Side, minute: number) => {
    const all = squad(side, minute)
    const men = all.filter((p) => p.position !== 'GK')
    return men.length ? men : all
  }
  const keeper = (side: Side, minute: number) => squad(side, minute).find((p) => p.position === 'GK')
  const forward = (s: Side) => (s === 'home' ? 1 : -1)
  const nearest = (men: PlacedPlayer[], p: PitchPoint) => men.reduce((a, b) => (dist(a, p) < dist(b, p) ? a : b))

  let pos: PitchPoint = { x: 50, y: 50 }
  let side: Side = from >= 46 && from < 71 ? 'away' : 'home'
  let holder: string | undefined
  let now = Math.max(0, from)
  /** No hop may land after this: the next strike's run-up, or the end of the range. */
  let deadline = end

  /** A hop to `target` that takes as long as its length needs (at least `min` minutes), squeezed to the deadline; false when it does not fit. */
  const hop = (target: PitchPoint, kind: BallKind, s: Side, who: string | undefined, speed = PASS_SPEED, min = 0.22, extra: Partial<BallKeyframe> = {}): boolean => {
    let dur = Math.max(min, dist(pos, target) / speed)
    if (now + dur > deadline) dur = deadline - now
    if (dur < 0.1) return false
    now += dur
    pos = { x: target.x, y: target.y }
    side = s
    holder = who
    push({ t: now, x: pos.x, y: pos.y, kind, side: s, holder: who, ...extra })
    return true
  }
  /** The man on the ball runs with it a few yards, mostly forwards (the ball stays at his feet). */
  const carry = (minutes: number) => {
    const dur = Math.min(minutes, deadline - now)
    if (dur <= 0.02) return
    if (!holder) {
      now += dur
      return
    }
    const step = rng.float(1.5, 5) * Math.min(1, dur / 0.3)
    pos = { x: clamp(pos.x + forward(side) * step, 3, 97), y: clamp(pos.y + rng.float(-2.5, 2.5), 4, 96) }
    now += dur
    push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder })
  }
  const kickOff = (s: Side, t: number) => {
    const men = outfield(s, t)
    const taker = men.length ? nearest(men, { x: 50, y: 50 }) : undefined
    pos = { x: 50, y: 50 }
    side = s
    holder = taker?.psId
    now = t
    push({ t, x: 50, y: 50, kind: 'kickoff', side: s, holder })
  }
  /** Pass to a team-mate: most passes are ten to twenty-five yards, forward passes favoured, pulled towards `goal` when given. */
  const passTo = (s: Side, goal?: PitchPoint): boolean => {
    const men = outfield(s, now).filter((p) => p.psId !== holder)
    if (!men.length) return false
    const near = men.filter((p) => dist(p, pos) <= MAX_HOP && (!goal || dist(p, goal) <= MAX_HOP))
    const pool = near.length ? near : [nearest(men, pos)]
    const pick = rng.pickWeighted(pool, (p) => {
      const d = dist(p, pos)
      const progress = (p.x - pos.x) * forward(s)
      let w = Math.exp(-(((d - 16) / 13) ** 2))
      if (progress > 0) w *= 1.5
      if (goal) w *= 1 / (1 + dist(p, goal) / 18)
      return w + 0.02
    })
    const d = dist(pick, pos)
    const loft = d > 34 ? 0.55 + rng.float(0, 0.25) : d > 24 && rng.chance(0.3) ? 0.3 : 0
    return hop({ x: pick.x, y: pick.y }, 'pass', s, pick.psId, PASS_SPEED, 0.24, { loft, bend: rng.float(-0.08, 0.08) })
  }
  /** The ball changes hands: the nearest man of the other side steps in and nicks it. */
  const turnover = (s: Side): boolean => {
    const men = outfield(s, now)
    if (!men.length) return false
    const taker = nearest(men, pos)
    const at = { x: taker.x + (pos.x - taker.x) * 0.35, y: taker.y + (pos.y - taker.y) * 0.35 }
    if (hop(at, 'pass', s, taker.psId, PASS_SPEED * 1.1, 0.2, { bend: rng.float(-0.05, 0.05) })) return true
    // No time for the ball to travel: he simply has it now
    side = s
    holder = taker.psId
    return false
  }
  const share = (s: Side, t: number) => {
    const pHome = momentum[binOf(Math.max(1, Math.floor(t)))] ?? 0.5
    return s === 'home' ? pHome : 1 - pHome
  }

  if (input.startAt) {
    pos = { x: input.startAt.x, y: input.startAt.y }
    side = input.startAt.side
    holder = input.startAt.holder
    push({ t: now, x: pos.x, y: pos.y, kind: 'carry', side, holder })
  } else kickOff(side, now)

  /** Ordinary play up to the deadline: carry, pass, now and then lose it. */
  const play = () => {
    for (let guard = 0; guard < 600 && deadline - now > 0.05; guard++) {
      carry(rng.float(0.16, 0.34))
      if (deadline - now < 0.3) {
        carry(deadline - now)
        return
      }
      const lose = 0.06 + 0.4 * (1 - share(side, now))
      if (!(rng.chance(lose) ? turnover(other(side)) : passTo(side))) carry(deadline - now)
    }
  }

  for (let si = 0; si < shots.length; si++) {
    const { ev, t: strike } = shots[si]
    const s = ev.side
    const target = toShared(ev.position ?? { x: 88, y: 50 }, s)
    // Ordinary play up to the build-up, which takes a minute or two (less when shots crowd a minute)
    deadline = strike - Math.min(1.8, Math.max(0.3, strike - now - 0.05))
    play()
    deadline = strike - 0.12
    if (side !== s) turnover(s)
    const men = outfield(s, ev.minute)
    const shooter = men.find((p) => p.psId === ev.playerId) ?? (men.length ? nearest(men, target) : undefined)
    // A pass towards the box first, when there is time for it and for the last ball after it
    if (holder !== shooter?.psId && strike - now > 0.95) {
      deadline = strike - 0.5
      passTo(s, target)
      deadline = strike - 0.12
    }
    // Into the shooter's stride (a cross when it comes in from wide), or his own run with it
    let own = holder === shooter?.psId
    const d = dist(pos, target)
    if (own && d / (PASS_SPEED * 0.5) > strike - now) own = d < 4
    const need = Math.max(0.2, d / (own ? PASS_SPEED * 0.5 : PASS_SPEED))
    if (strike - need > now + 0.05) carry(strike - need - now)
    const last = out[out.length - 1]
    if (last.t < strike - 0.004) {
      const cross = !own && Math.abs(pos.y - target.y) > 22
      push({ t: strike - 0.002, x: target.x, y: target.y, kind: own ? 'carry' : 'pass', side: s, holder: shooter?.psId, loft: cross ? 0.45 : 0, bend: cross ? (pos.y > target.y ? 0.12 : -0.12) * forward(s) : 0 })
    }
    pos = target
    side = s
    holder = shooter?.psId
    now = strike
    push({ t: strike, x: target.x, y: target.y, kind: 'shot', side: s, holder })
    deadline = si + 1 < shots.length ? shots[si + 1].t - 0.3 : end
    const gk = keeper(other(s), ev.minute)
    const goalLine = s === 'home' ? 100 : 0
    if (GOAL_TYPES.has(ev.type)) {
      // In the net (the flight is drawn while the clock holds), then a kick-off from the centre spot
      push({ t: strike + 0.001, x: goalLine, y: 50 + clamp((target.y - 50) * 0.25, -4, 4), kind: 'goal', side: s })
      kickOff(other(s), strike + 0.002)
      carry(0.3)
      if (holder && deadline - now > 0.3) passTo(side)
    } else if (ev.type === 'save') {
      const at = gk ? { x: gk.x + (target.x - gk.x) * 0.15, y: gk.y + (target.y - gk.y) * 0.35 } : { x: s === 'home' ? 96 : 4, y: 50 }
      if (!hop(at, 'save', other(s), gk?.psId, SHOT_SPEED, 0.12)) continue
      // The keeper gathers, then sends it long
      if (deadline - now > 0.9) {
        now += 0.35
        push({ t: now, x: at.x, y: at.y, kind: 'carry', side: other(s), holder: gk?.psId })
        const outs = outfield(other(s), now)
        const mid = outs.filter((p) => Math.abs(p.x - 50) < 22 && Math.abs(p.x - at.x) < 55)
        const pool = mid.length ? mid : outs
        if (pool.length) {
          const pick = pool[rng.int(0, pool.length - 1)]
          hop({ x: pick.x, y: pick.y }, 'pass', other(s), pick.psId, PASS_SPEED * 0.9, 0.6, { loft: 0.85, bend: rng.float(-0.06, 0.06) })
        }
      }
    } else {
      const wide = { x: goalLine + (s === 'home' ? 1.5 : -1.5), y: 50 + (rng.chance(0.5) ? 1 : -1) * rng.float(14, 24) }
      if (!hop(wide, 'miss', s, undefined, SHOT_SPEED, 0.14, { loft: rng.chance(0.4) ? 0.5 : 0.15, bend: rng.float(-0.1, 0.1) })) continue
      // Fetched and placed for the goal kick, then played out
      const kick = gk ? { x: gk.x + forward(other(s)) * 3, y: 50 } : { x: s === 'home' ? 94 : 6, y: 50 }
      if (!hop(kick, 'reset', other(s), gk?.psId, PASS_SPEED * 0.8, 0.45)) continue
      if (deadline - now > 0.6) {
        now += 0.2
        push({ t: now, x: kick.x, y: kick.y, kind: 'carry', side: other(s), holder: gk?.psId })
        const outs = outfield(other(s), now)
        if (outs.length) {
          const pick = nearest(outs, { x: kick.x + forward(other(s)) * 20, y: rng.float(25, 75) })
          hop({ x: pick.x, y: pick.y }, 'pass', other(s), pick.psId, PASS_SPEED, 0.3, { loft: 0.25, bend: rng.float(-0.06, 0.06) })
        }
      }
    }
  }
  deadline = end
  play()
  return out
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
  const f = b.kind === 'carry' ? easeInOut(raw) : b.kind === 'reset' ? easeInOut(raw) : easePass(raw)
  const p = bentPoint(a, b, b.bend ?? 0, f)
  const h = arcHeight(b.loft ?? 0, f)
  // On the ball during a carry; the receiver once a pass has all but arrived
  const holder = b.kind === 'carry' ? b.holder : raw >= 0.92 ? b.holder : raw <= 0.08 && b.kind !== 'reset' ? a.holder : undefined
  return { x: p.x, y: p.y, h, kind: raw >= 1 ? b.kind : a.kind, side: raw >= 0.5 ? b.side : a.side, holder, index: lo, next: b, progress: f }
}

function dist(a: PitchPoint, b: PitchPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
