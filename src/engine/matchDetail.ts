/**
 * Match detail for the pitch views: where each shot was taken from and how
 * the pressure swung over the ninety minutes.
 *
 * Everything here is drawn from a stream forked off a copy of the match's
 * generator once a segment's result is decided, so adding or changing it never
 * moves a draw that decides a goal, a card or an injury: the same seed gives
 * the same scoreline with or without the detail.
 */
import type { MatchEvent, Tactics } from './types'
import type { Rng } from './rng'

/** Pitch coordinates for a shot: x runs 0..100 along the length towards the attacking goal, y 0..100 across. */
export interface PitchPoint {
  x: number
  y: number
}

/** Landmarks of a 105 by 68 metre pitch, in percent: the box edge, the six-yard box edge, the spot and the half-widths. */
export const PITCH = { boxEdge: 84.3, sixYardEdge: 94.8, penaltySpot: 89.5, boxHalfWidth: 29.6, sixYardHalfWidth: 13.5 }

/** The match is split into eighteen five-minute bins for the momentum series; stoppage time joins the last. */
export const MOMENTUM_BINS = 18

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])

/** The five-minute bin a minute falls in (1-5 is bin 0, 86-90 and stoppage time bin 17). */
export function binOf(minute: number): number {
  return Math.min(MOMENTUM_BINS - 1, Math.max(0, Math.ceil(minute / 5) - 1))
}

/** Give every shot event of the segment (`from`..`to`, stoppage time included for the last) a position it does not have yet. */
export function placeEvents(rng: Rng, events: MatchEvent[], from: number, to: number): void {
  for (const e of events) {
    if (e.position || !SHOT_TYPES.has(e.type)) continue
    if (e.minute < from || (to < 90 && e.minute > to)) continue
    e.position = shotPosition(rng, e)
  }
}

/**
 * Where a shot was taken from. Penalties are at the spot; headers and tap-ins
 * cluster around the six-yard box; one chance in five is from outside the box;
 * the rest fall in and around the box.
 */
export function shotPosition(rng: Rng, e: Pick<MatchEvent, 'type' | 'text'>): PitchPoint {
  if (e.type === 'penalty') return { x: PITCH.penaltySpot, y: 50 }
  const text = e.text.toLowerCase()
  if (e.type === 'own_goal') return { x: clamp(rng.gaussian(96, 1.5), 92, 99), y: clamp(rng.gaussian(50, 7), 36, 64) }
  const close = text.includes('head') || text.includes('corner') || text.includes('six yards') || text.includes('close range') || text.includes('taps in') || text.includes('on the line')
  if (close) return { x: clamp(rng.gaussian(95, 2), 90, 99), y: clamp(rng.gaussian(50, 7), 30, 70) }
  const long = text.includes('edge of the box') || rng.chance(0.2)
  if (long) return { x: clamp(rng.gaussian(79, 3.5), 68, PITCH.boxEdge - 0.5), y: clamp(rng.gaussian(50, 11), 25, 75) }
  return { x: clamp(rng.gaussian(90, 3.5), PITCH.boxEdge, 98.5), y: clamp(rng.gaussian(50, 11), 22, 78) }
}

export interface MomentumInput {
  /** Expected goals of each side for this segment, as the engine used them. */
  lamH: number
  lamA: number
  homeTactics: Tactics
  awayTactics: Tactics
  /** Every event so far, this segment's included. */
  events: MatchEvent[]
  from: number
  to: number
  /** The bins already filled by earlier segments. */
  previous: number[]
}

const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/**
 * The home side's share of the pressure, 0..1, for each five-minute bin of the
 * segment: the sides' expected goals set the base, the mentalities and pressing
 * tilt it, a side chasing the game pushes (harder as the clock runs down), a
 * goal or a chance swings the bin it falls in and a little the next, a small
 * wobble keeps it alive, and each bin carries a third of the one before.
 */
export function momentumBins(rng: Rng, input: MomentumInput): number[] {
  const { lamH, lamA, events, from, to, previous } = input
  const base = lamH + lamA > 0 ? lamH / (lamH + lamA) : 0.5
  const tilt = lean(input.homeTactics) - lean(input.awayTactics)
  const first = binOf(from)
  const last = binOf(to)
  // A match paused before the detail existed has no earlier bins: they read as the sides' base share
  const out = previous.slice(0, first)
  while (out.length < first) out.push(Math.round(clamp(base, 0.08, 0.92) * 1000) / 1000)
  for (let b = first; b <= last; b++) {
    const start = b * 5 + 1
    const end = b === MOMENTUM_BINS - 1 ? 99 : b * 5 + 5
    let hg = 0
    let ag = 0
    let swing = 0
    for (const e of events) {
      if (GOAL_TYPES.has(e.type)) {
        if (e.minute < start) {
          if (e.side === 'home') hg++
          else ag++
          // A goal in the bin before still carries
          if (e.minute >= start - 5) swing += e.side === 'home' ? 0.05 : -0.05
        } else if (e.minute <= end) swing += e.side === 'home' ? 0.12 : -0.12
      } else if ((e.type === 'chance' || e.type === 'save') && e.minute >= start && e.minute <= end) swing += e.side === 'home' ? 0.04 : -0.04
    }
    const diff = hg - ag
    const urgency = b >= 14 ? 1.6 : b >= 9 ? 1.2 : 1
    const chase = -Math.sign(diff) * Math.min(2, Math.abs(diff)) * 0.05 * urgency
    const raw = clamp(base + tilt + chase + swing + rng.gaussian(0, 0.06), 0.08, 0.92)
    const prev = out.length ? out[out.length - 1] : base
    out.push(Math.round(clamp(prev * 0.35 + raw * 0.65, 0.08, 0.92) * 1000) / 1000)
  }
  return out
}

/** How far forward a side's instructions lean: mentality first, pressing second. */
function lean(t: Tactics): number {
  return (t.mentality === 'attacking' ? 0.03 : t.mentality === 'defensive' ? -0.03 : 0) + (t.pressing === 'high' ? 0.015 : t.pressing === 'low' ? -0.015 : 0)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
