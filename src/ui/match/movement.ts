/**
 * Where a man's dot stands at a moment: the one formula the live pitch draws
 * with and every accumulator (heat maps, average positions) samples, so a heat
 * map shows where the dot actually went.
 *
 * Each man starts from his place in his side's shape (shape.ts: the block
 * climbing or dropping with the ball and with possession, the set pieces).
 * The man on the ball stands just behind it; the man a pass is meant for runs
 * to meet it; the passer is left where he struck it. Out of possession the
 * nearest men close the ball down goal-side of it, so the press shows; in
 * possession the nearest offer a short option; everyone sways a little; a
 * keeper dives towards the shot he saves.
 *
 * Off the ball, as in Football Manager's 2D view, the man a pass is for makes
 * his run before it is played: in the last moment of the passer's touch he
 * sets off towards where the ball will arrive (furthest for a ball in behind,
 * a switch or a cross), and he meets it there rather than waiting for it to
 * reach his spot. The back line out of possession holds its depth (it sways
 * across, never in and out), so it reads as a line.
 */
import type { PitchPoint } from '@engine/matchDetail'
import { metres, type PlacedPlayer } from './pitchGeometry'
import type { BallKeyframe, BallState, PlayTag } from './possession'
import type { Position } from '@engine/types'
import { sceneAt, shapePoint, type Scene } from './shape'

/** A fixed sway phase per man, from his id, so the picture is the same on every replay. */
export function swayPhase(psId: string): number {
  return [...psId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 6283, 7) / 1000
}

/** The save keyframe within half a minute of T among the last three the ball reached, with its index. */
function saveNear(path: BallKeyframe[], i: number, T: number): number {
  let found = -1
  for (let k = i; k >= 0 && k >= i - 2; k--) if (path[k].kind === 'save' && Math.abs(T - path[k].t) < 0.5) found = k
  return found
}

/** How hard the nearest men press the ball (share of the way to it) and from how far (metres). */
export const PRESS = { pull: 0.7, reach: 20, goalSide: 2.2 }
/** How the nearest team-mates come to offer an option: never closer than `gap` metres. */
export const SUPPORT = { pull: 0.35, reach: 26, gap: 9 }

/**
 * The run before a pass: how far towards the ball's landing point the man it is for has gone by the
 * moment it is struck (a share of the way from his place), by the kind of pass, and how long before
 * the strike he sets off (match minutes, about a second at 1x).
 */
export const RUN = { lead: 0.22, through: 0.5, long: 0.38, switch: 0.38, cross: 0.42, forward: 0.28, other: 0.15 } as const
export function runShare(play: PlayTag | undefined): number {
  switch (play) {
    case 'through':
      return RUN.through
    case 'long':
      return RUN.long
    case 'switch':
      return RUN.switch
    case 'cross':
    case 'cutback':
      return RUN.cross
    case 'forward':
      return RUN.forward
    default:
      return RUN.other
  }
}

const BACK_LINE = new Set<Position>(['CB', 'LB', 'RB'])

/**
 * The pass this man is about to receive or is receiving: the keyframe it lands on and how far he is
 * along his run to it (0..1). Before the strike (the passer's touch is the next keyframe, the pass the
 * one after) he has set off by up to `runShare` of the way; through the pass he goes the rest.
 */
export function runTo(p: PlacedPlayer, path: BallKeyframe[], b: BallState, T: number): { to: BallKeyframe; w: number } | null {
  const i = b.index
  const next = b.next
  if (!next) return null
  const mine = (k: BallKeyframe | undefined) => !!k && k.kind === 'pass' && k.holder === p.psId && k.side === p.side
  if (mine(next)) {
    const lead = runShare(next.play)
    return { to: next, w: lead + (1 - lead) * smoothStep(b.progress * 1.1) }
  }
  const after = path[i + 2]
  if (next.kind === 'carry' && next.side === p.side && next.holder !== p.psId && mine(after)) {
    const k = smoothStep((T - (next.t - RUN.lead)) / RUN.lead)
    return k > 0 ? { to: after, w: runShare(after.play) * k } : null
  }
  return null
}

export function dotPosition(p: PlacedPlayer, path: BallKeyframe[], ball: BallState | null, T: number, phase: number, scene?: Scene): PitchPoint {
  const b = ball
  const sc = scene ?? sceneAt(path, b, T)
  const base = shapePoint(p, sc, phase)
  if (!b) return base
  const i = b.index
  const cur = i >= 0 ? path[i] : undefined
  const next = b.next
  const f = b.progress
  const mine = (k: BallKeyframe | null | undefined) => !!k && k.holder === p.psId && k.side === p.side
  // On the ball: through a carry he has it at his feet; the receiver runs to meet the pass; the passer stays where he struck it
  const carrying = mine(cur) && mine(next) && next!.kind === 'carry'
  // A pass to him (or one about to be played to him): he runs to where it lands
  const run = !carrying && p.position !== 'GK' ? runTo(p, path, b, T) : null
  const wIn = carrying ? 1 : run ? run.w : mine(next) ? Math.min(1, f * 1.15) : 0
  const wOut = carrying ? 0 : mine(cur) ? (next ? 1 - smoothStep(f * 1.6) : 1) : 0
  const hold = Math.min(1, wIn + wOut)
  let x = base.x
  let y = base.y
  const spW = sc.setPiece?.w ?? 0
  if (hold < 1 && p.position !== 'GK') {
    const d = metres(b, base)
    if (p.side !== sc.poss) {
      // Close the ball down from the goal side, the nearest hardest
      const press = PRESS.pull * Math.max(0, 1 - d / PRESS.reach) * (1 - hold) * (1 - spW) * sc.settle
      const goalX = p.side === 'home' ? 0 : 100
      const gx = goalX - b.x
      const gy = 50 - b.y
      const gl = Math.hypot(gx * 1.05, gy * 0.68) || 1
      const tx = b.x + (gx / gl) * PRESS.goalSide
      const ty = b.y + (gy / gl) * PRESS.goalSide
      x += (tx - x) * press
      y += (ty - y) * press
    } else if (d > SUPPORT.gap) {
      // Come short to give the man on the ball an option, but not on top of him
      const pull = SUPPORT.pull * Math.max(0, 1 - d / SUPPORT.reach) * (1 - hold) * (1 - spW)
      const k = pull * (1 - SUPPORT.gap / d)
      x += (b.x - x) * k
      y += (b.y - y) * k
    }
    const sway = (1 - hold) * (1 - spW * 0.8)
    // The back line out of possession holds its depth: it sways across, not in and out
    const line = p.side !== sc.poss && BACK_LINE.has(p.position) ? 1 - sc.settle * 0.85 : 1
    x += Math.sin(T * 1.7 + phase) * 0.5 * sway * line
    y += Math.cos(T * 1.3 + phase) * 0.7 * sway
  }
  if (wOut > 0 && cur) {
    x += (cur.x - x) * wOut
    y += (cur.y - y) * wOut
  }
  if (wIn > 0) {
    // Just behind the ball, the way he is facing (his side's attacking direction); on a run, just behind where the pass lands
    const behind = p.side === 'home' ? -1.1 : 1.1
    const at = run ? run.to : b
    x += (at.x + behind - x) * wIn
    y += (at.y - y) * wIn
  }
  const s = i >= 0 ? saveNear(path, i, T) : -1
  if (s >= 0 && path[s].holder === p.psId && hold < 0.5) {
    const prev = path[s - 1]
    const dive = 1 - Math.abs(T - path[s].t) / 0.5
    if (prev) {
      x += (prev.x - x) * 0.35 * dive
      y += (prev.y - y) * 0.5 * dive
    }
  }
  return { x: Math.min(101, Math.max(-1, x)), y: Math.min(101, Math.max(-1, y)) }
}

function smoothStep(v: number): number {
  const x = Math.min(1, Math.max(0, v))
  return x * x * (3 - 2 * x)
}
