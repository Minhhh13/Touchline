/**
 * Where a man's dot stands at a moment: the one formula the live pitch draws
 * with and every accumulator (heat maps, average positions) samples, so a heat
 * map shows where the dot actually went.
 *
 * The man on the ball (or about to receive it) stands where the ball is;
 * everyone else moves with his block as the ball moves up and down the pitch,
 * the nearest drift towards the ball and all of them sway; a keeper dives
 * towards the shot he saves.
 */
import type { PitchPoint } from '@engine/matchDetail'
import { metres, type PlacedPlayer } from './pitchGeometry'
import type { BallKeyframe, BallState } from './possession'

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

export function dotPosition(p: PlacedPlayer, path: BallKeyframe[], ball: BallState | null, T: number, phase: number): PitchPoint {
  const b = ball
  const lean = b ? (b.x - 50) * 0.08 : 0
  const i = b?.index ?? -1
  const cur = i >= 0 ? path[i] : undefined
  const next = b?.next ?? null
  const f = b?.progress ?? 1
  let hold = 0
  if (cur?.holder === p.psId) hold += next ? 1 - f : 1
  if (next?.holder === p.psId) hold += f
  hold = Math.min(1, hold)
  let x = p.x + lean * (1 - hold) * (p.position === 'GK' ? 0.35 : 1)
  let y = p.y
  if (b && hold < 1 && p.position !== 'GK') {
    const pull = 0.24 * Math.max(0, 1 - metres(b, { x, y }) / 26) * (1 - hold)
    x += (b.x - x) * pull
    y += (b.y - y) * pull
    x += Math.sin(T * 1.7 + phase) * 0.5 * (1 - hold)
    y += Math.cos(T * 1.3 + phase) * 0.7 * (1 - hold)
  }
  const s = i >= 0 ? saveNear(path, i, T) : -1
  if (s >= 0 && path[s].holder === p.psId) {
    const prev = path[s - 1]
    const dive = 1 - Math.abs(T - path[s].t) / 0.5
    if (prev) {
      x += (prev.x - p.x) * 0.35 * dive
      y += (prev.y - p.y) * 0.5 * dive
    }
  }
  return { x, y }
}
