/**
 * Pure helpers for the goal celebration on the live pitch: how far into it
 * the players are (an envelope that rises after the ball hits the net, holds,
 * and falls back to nothing before the kick-off, so nobody jumps when play
 * resumes), the net's bulge, the follow-through flight into the net, and the
 * confetti, all as functions of the milliseconds since the strike. Nothing
 * here draws from any generator: it presents a goal the engine already made.
 */
import type { PitchPoint } from '@engine/matchDetail'

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function smooth(v: number): number {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}

/** How much of the celebration is on, 0..1, `elapsed` ms into a hold of `ms` whose ball crosses the line at `flight`: up over half a second, held, back to 0 by 150 ms before the end. */
export function celebrationEnvelope(elapsed: number, ms: number, flight: number): number {
  const rise = smooth((elapsed - flight) / 500)
  const fallStart = Math.max(flight + 500, ms - 800)
  const fall = 1 - smooth((elapsed - fallStart) / Math.max(1, ms - 150 - fallStart))
  return Math.max(0, Math.min(rise, fall))
}

/** The net's bulge `since` ms after the ball hits it: out to `peak` at once, then a damped wobble back to rest within about a second. */
export function netBulge(since: number, peak = 0.7): number {
  if (since < 0) return 0
  return peak * Math.exp(-since / 260) * Math.cos(since / 85) * (since < 1200 ? 1 : 0)
}

/** The ball's follow-through: from the strike to the point in the net, quick off the boot and slowing as it lands (0..1 eased progress). */
export function flightProgress(elapsed: number, flight: number): number {
  if (flight <= 0) return 1
  const x = clamp01(elapsed / flight)
  return 1 - Math.pow(1 - x, 2.2)
}

/** Where the ball ends up in the net (shared coordinates): past the line by `depth`, pulled towards the middle of the goal. */
export function netPoint(mouth: PitchPoint, depth = 1.6): PitchPoint {
  return { x: mouth.x >= 50 ? Math.min(103, mouth.x + depth) : Math.max(-3, mouth.x - depth), y: 50 + (mouth.y - 50) * 0.8 }
}

/** The scorer's run: from where he struck it towards the corner flag on that end, a little over half the way. */
export function scorerRun(shot: PitchPoint, attackingRight: boolean, f: number): PitchPoint {
  const corner = { x: attackingRight ? 97 : 3, y: shot.y < 50 ? 6 : 94 }
  const k = 0.62 * smooth(f)
  return { x: shot.x + (corner.x - shot.x) * k, y: shot.y + (corner.y - shot.y) * k }
}

export interface ConfettiPiece {
  /** Where it flies to, in per cent of the burst box from its centre. */
  dx: number
  dy: number
  rot: number
  delay: number
  colour: string
  wide: boolean
}

/** A fixed spray of confetti in the scoring club's colours (the same every time: the golden angle spreads it evenly). */
export function confetti(colours: string[], n = 42): ConfettiPiece[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = ((i * 137.508) % 360) * (Math.PI / 180)
    const reach = 26 + ((i * 53) % 34)
    return { dx: Math.cos(angle) * reach * 1.4, dy: Math.sin(angle) * reach - 8, rot: ((i * 97) % 720) - 360, delay: (i % 7) * 28, colour: colours[i % colours.length], wide: i % 3 === 0 }
  })
}
