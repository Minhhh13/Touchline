/**
 * How a goal goes in on the live pitch: the shape of the ball's flight from
 * the strike into the net, read from the goal's own line in the log ("thumps
 * it into the roof of the net", "chips the keeper", "finishes low into the
 * corner"). A drive into the roof rises all the way to the net, a chip loops
 * high and drops in, a curler bends and dips into the top corner, a tap-in
 * and a ball rolled past a keeper who was rounded stay on the grass.
 *
 * Presentation only, over the decided events: the flight is drawn while the
 * clock holds for the goal, and nothing here touches the match or its
 * generator. Pure: a function of the event (and a hash of it for a penalty).
 */
import type { MatchEvent } from '@engine/types'
import type { PitchPoint } from '@engine/matchDetail'
import { hashString } from '@engine/rng'
import { netPoint } from './celebration'
import { bentPoint } from './possession'
import type { Side } from './pitchGeometry'

export interface Finish {
  /** The extra rise of the arc half-way (0 for a ball along the ground). */
  loft: number
  /** The ball's height as it reaches the net (0 on the grass, about 0.6 under the bar). */
  end: number
  /** The sideways bend of the flight, as a share of its length (a curler bends most). */
  bend: number
  /** How far towards a post it goes in, 0 (where the path aims it) to 1 (inside the post). */
  wide: number
  /** How the flight's time is spent: above 1 the ball is quick off the boot and slows (a lob), below 1 it is struck hard and keeps its pace. */
  pace: number
}

const LOW: Finish = { loft: 0.08, end: 0.06, bend: 0.05, wide: 0.3, pace: 1 }

/** The flight of a goal from its event. */
export function finishOf(ev: Pick<MatchEvent, 'type' | 'text' | 'minute' | 'side'> | undefined): Finish {
  if (!ev) return LOW
  const text = ev.text.toLowerCase()
  if (ev.type === 'penalty') {
    // Low into the corner or high into the side of the net, the same for every viewing
    const high = (hashString(`pen-${ev.minute}-${ev.side}`) >>> 0) % 3 === 0
    return high ? { loft: 0.05, end: 0.5, bend: 0.02, wide: 0.85, pace: 0.85 } : { loft: 0.02, end: 0.05, bend: 0.02, wide: 0.9, pace: 0.85 }
  }
  if (ev.type === 'own_goal') return { loft: 0.12, end: 0.08, bend: 0.08, wide: 0.2, pace: 1.1 }
  if (text.includes('roof of the net')) return { loft: 0.05, end: 0.62, bend: 0.02, wide: 0.2, pace: 0.8 }
  if (text.includes('chips')) return { loft: 0.85, end: 0.35, bend: 0.03, wide: 0.1, pace: 1.35 }
  if (text.includes('curls')) return { loft: 0.18, end: 0.5, bend: 0.16, wide: 0.9, pace: 1 }
  if (text.includes('volleys')) return { loft: 0.1, end: 0.45, bend: 0.06, wide: 0.6, pace: 0.8 }
  if (text.includes('low into the corner')) return { loft: 0.02, end: 0.03, bend: 0.04, wide: 0.95, pace: 0.9 }
  if (text.includes('head')) return { loft: 0.12, end: 0.12, bend: 0.03, wide: 0.5, pace: 1.1 }
  if (text.includes('taps in') || text.includes('rounds the keeper') || text.includes('pounces')) return { loft: 0, end: 0, bend: 0.02, wide: 0.2, pace: 1.15 }
  if (text.includes('drills')) return { loft: 0.04, end: 0.15, bend: 0.03, wide: 0.5, pace: 0.8 }
  return LOW
}

/** The ball's height `f` of the way through the flight (time): from the grass at the strike to `end` at the net, with the arc's rise on top. */
export function finishHeight(fin: Finish, f: number): number {
  const x = Math.min(1, Math.max(0, f))
  return fin.end * x * x * (3 - 2 * x) + fin.loft * 4 * x * (1 - x)
}

/** Shared units from the middle of the goal to just inside a post (the posts stand at 5.4). */
const INSIDE_POST = 4.6
/** Milliseconds the ball takes to drop to the floor of the net after it lands there high. */
export const NET_DROP_MS = 200

/**
 * Where the ball is `x` of the way through a goal's flight (its share of the flight's time, 0..1) from the strike
 * at `shot` to the goal mouth the path aims it at (`mouth`), for side `side` scoring: bent, aimed towards a post
 * by the finish, quick off the boot and slowing into the net; `after` ms past the landing it drops to the floor.
 */
export function goalFlightAt(shot: PitchPoint, mouth: PitchPoint, side: Side, fin: Finish, x: number, after = 0): { at: PitchPoint; h: number } {
  const t = Math.min(1, Math.max(0, x))
  const fp = 1 - Math.pow(1 - t, 2.2 * fin.pace)
  const off = mouth.y - 50
  const dir = off !== 0 ? Math.sign(off) : shot.y >= 50 ? 1 : -1
  const y = 50 + dir * (Math.min(INSIDE_POST, Math.abs(off)) + Math.max(0, INSIDE_POST - Math.abs(off)) * fin.wide)
  const inNet = netPoint({ x: mouth.x, y })
  // A curler bends back towards the middle of the goal
  const bend = (shot.y > 50 ? -1 : 1) * fin.bend * (side === 'home' ? 1 : -1)
  const drop = t < 1 ? 1 : Math.max(0, 1 - after / NET_DROP_MS)
  return { at: bentPoint(shot, inNet, bend, fp), h: finishHeight(fin, t) * drop }
}
