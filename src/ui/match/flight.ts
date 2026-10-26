/**
 * The ball in flight as the live pitch draws it: how a kicked ball travels
 * along its hop and how high it is on the way, by the kind of ball it is.
 *
 * Football Manager's 2D view sells a long ball, a cross or a shot with the
 * ball itself: it grows as it rises, its shadow stays on the grass and falls
 * behind it, and a ball along the ground is quick off the boot and slows as
 * it reaches the man it was played to. Here every hop of the ball path
 * (playbook.ts) is classed by its keyframes (a pass along the ground, a
 * driven ball, a lofted one, a floated cross, a shot) and gets
 * - a time warp: the share of the hop covered at a share of its time (a
 *   ground pass decelerates with friction, a lofted ball barely slows, a shot
 *   holds its pace), always 0 at the start and 1 at the end, so the ball is
 *   where the path says at every keyframe and nothing about the path, its
 *   timing or the match changes;
 * - a height curve over the hop (a ball in the air peaks half-way in time, so
 *   with the warp it drops more steeply than it rose, as a real ball does; a
 *   shot over the bar keeps rising);
 * - the sprite: how far the drawn ball lifts off its shadow and how much it
 *   grows with that height, and how the shadow shrinks and fades.
 *
 * Pure and deterministic: a function of the path and the time.
 */
import type { PitchPoint } from '@engine/matchDetail'
import { ballAt, smoothPoint, type BallKeyframe, type BallState } from './possession'

export type FlightKind = 'carry' | 'ground' | 'driven' | 'lofted' | 'cross' | 'shot' | 'fetch'

/** What kind of ball the hop from `a` to `b` is. */
export function flightKind(a: BallKeyframe, b: BallKeyframe): FlightKind {
  if (b.kind === 'reset' || b.kind === 'kickoff' || b.kind === 'goal') return 'fetch'
  if (a.kind === 'shot' || b.kind === 'save' || b.kind === 'miss') return 'shot'
  if (b.kind === 'carry' || b.play === 'dribble' || b.play === 'rebound') return 'carry'
  const loft = b.loft ?? 0
  if (b.play === 'cross' || b.play === 'cutback') return loft >= 0.55 ? 'cross' : loft > 0.05 ? 'driven' : 'ground'
  if (loft >= 0.45) return 'lofted'
  if (loft > 0.05) return 'driven'
  return 'ground'
}

/** How fast each kind of ball loses its pace: the exponent of the warp `1 - (1 - f)^k` (1 is an even pace). */
export const DRAG: Record<FlightKind, number> = { carry: 1, fetch: 1, ground: 1.65, driven: 1.35, lofted: 1.15, cross: 1.2, shot: 1.25 }

/** The share of the hop covered `f` of the way through its time. Monotonic, 0 at 0 and 1 at 1. */
export function flightWarp(kind: FlightKind, f: number): number {
  const x = Math.min(1, Math.max(0, f))
  const k = DRAG[kind]
  return k === 1 ? x : 1 - Math.pow(1 - x, k)
}

/** The ball's height `f` of the way through a hop (time), 0 on the grass to about 1 at the top of a high ball. */
export function flightHeight(kind: FlightKind, loft: number, f: number): number {
  const x = Math.min(1, Math.max(0, f))
  const L = Math.max(0, loft)
  const arc = 4 * x * (1 - x)
  switch (kind) {
    case 'lofted':
    case 'cross':
      return L * arc
    case 'driven':
      // Kept low and flat: most of its height early, never as high as its loft says
      return L * 0.65 * Math.sin(Math.PI * Math.pow(x, 0.8))
    case 'shot':
      // A shot over the bar rises all the way to the line; a low drive skims a little off the grass
      return L > 0.3 ? L * (2 * x - x * x) : Math.max(L * arc, 0.06 * Math.sin(Math.PI * x))
    default:
      return 0
  }
}

/** The football as drawn this frame: where it is over the grass, how high, and the kind of ball. */
export interface BallView extends PitchPoint {
  h: number
  kind: FlightKind
}

/** Where to draw the ball at time T: the path's own point for a carry or a restart, the warped point and height for a kicked ball. `b` is `ballAt(path, T)` when the caller has it. */
export function ballView(path: BallKeyframe[], T: number, b: BallState | null = ballAt(path, T)): BallView | null {
  if (!b) return null
  const a = path[b.index]
  const n = b.next
  if (!a || !n || b.progress >= 1) return { x: b.x, y: b.y, h: 0, kind: 'carry' }
  const kind = flightKind(a, n)
  if (kind === 'carry' || kind === 'fetch') return { x: b.x, y: b.y, h: 0, kind }
  const p = smoothPoint(path, b.index, flightWarp(kind, b.progress))
  return { x: p.x, y: p.y, h: flightHeight(kind, n.loft ?? 0, b.progress), kind }
}

/** The sprite for a ball `h` high, ball radius `r` (SVG units): the lift off its shadow, the ball's scale, and the shadow's offset, scale and opacity. */
export interface BallSprite {
  lift: number
  scale: number
  shadowDx: number
  shadowDy: number
  shadowScale: number
  shadowOpacity: number
}

/** How far a ball at height 1 lifts off its shadow (radii) and how much bigger it is drawn. */
export const SPRITE = { lift: 3.6, grow: 0.8, shadowFall: 0.9 } as const

export function ballSprite(h: number, r: number): BallSprite {
  const x = Math.min(1.2, Math.max(0, h))
  return {
    lift: -x * SPRITE.lift * r,
    scale: 1 + x * SPRITE.grow,
    // The light is high and a little behind the camera: the shadow falls below and slightly right of the ball's ground point
    shadowDx: 0.25 * r + x * SPRITE.shadowFall * r * 0.5,
    shadowDy: 0.35 * r + x * SPRITE.shadowFall * r * 0.25,
    shadowScale: Math.max(0.45, 1 - x * 0.45),
    shadowOpacity: Math.max(0.12, 0.5 - x * 0.32),
  }
}
