/*
 * The case reel's motion, pure: how long each stage takes and where the strip
 * is at any moment of its slide. The strip runs one smooth curve: a very fast
 * start, a long deceleration that creeps over the last two or three cards, a
 * small overshoot past the stop point and an ease back onto it. The same
 * function drives the animation's keyframes and the tick schedule, so the
 * ticks fall exactly where the cards cross the marker. Presentation only.
 */

export interface ReelTiming {
  /** The season drum's roll, ms. */
  drum: number
  /** When the strip starts, ms from the run's start (the season shows first). */
  season: number
  /** The strip's slide, overshoot and ease back included, ms. */
  spin: number
  /** The last part of the slide: back from the overshoot onto the stop point, ms. */
  bounce: number
  /** The pause at rest before the reveal (the rarity glow, the reveal sound, the result line), ms. */
  hold: number
}

/** The full case opening: about 7.2 s from the click to the reveal. */
export const FULL_TIMING: ReelTiming = { drum: 850, season: 1000, spin: 5800, bounce: 200, hold: 400 }
/** Quick spin (the viewer's setting) and every re-spin: about 2.7 s to the reveal. */
export const QUICK_TIMING: ReelTiming = { drum: 450, season: 500, spin: 2000, bounce: 150, hold: 150 }

export const DRUM_MS = FULL_TIMING.drum
export const SEASON_MS = FULL_TIMING.season
/** The strip's slide at full length. */
export const SPIN_MS = FULL_TIMING.spin
/** From the click to the reveal (`onSettled`) at full length: the season, the slide, the hold. Change with SPIN_MS. */
export const SETTLE_MS = FULL_TIMING.season + FULL_TIMING.spin + FULL_TIMING.hold

/** The deceleration before the bounce, as a CSS cubic-bezier: steep at the start, flat at the end. */
export const STRIP_CURVE = [0.05, 0.7, 0.65, 1] as const
/** How far the strip runs past its stop point before easing back, in card widths. */
export const OVERSHOOT = 0.12

/** `cubic-bezier(x1, y1, x2, y2)` as CSS evaluates it: progress at a time fraction, both 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const coord = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // x rises monotonically on 0..1 for 0 <= x1, x2 <= 1, so bisection finds the curve parameter for time t
    let lo = 0
    let hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (coord(mid, x1, x2) < t) lo = mid
      else hi = mid
    }
    return coord((lo + hi) / 2, y1, y2)
  }
}

const decelerate = cubicBezier(...STRIP_CURVE)

/**
 * How far the strip has slid, px, `ms` into its slide: the deceleration covers `distance + overshoot`
 * and ends at rest (the curve is flat at its end), then a half-cosine brings it back by `overshoot`, also
 * starting and ending at rest, so position and speed are continuous throughout.
 */
export function reelPosition(ms: number, distance: number, overshoot: number, timing: Pick<ReelTiming, 'spin' | 'bounce'>): number {
  const main = timing.spin - timing.bounce
  if (ms <= 0) return 0
  if (ms >= timing.spin) return distance
  if (ms <= main) return (distance + overshoot) * decelerate(ms / main)
  const v = (ms - main) / timing.bounce
  return distance + overshoot - (overshoot * (1 - Math.cos(Math.PI * v))) / 2
}

/** Keyframes for the slide (linear between them), dense enough that the steps never show: one every ~16 ms of the deceleration, more in the bounce. */
export function reelKeyframes(distance: number, overshoot: number, timing: Pick<ReelTiming, 'spin' | 'bounce'>): Keyframe[] {
  const main = timing.spin - timing.bounce
  const times: number[] = []
  const steps = Math.max(24, Math.ceil(main / 16))
  for (let i = 0; i < steps; i++) times.push((main * i) / steps)
  for (let i = 0; i <= 12; i++) times.push(main + (timing.bounce * i) / 12)
  return times.map((ms) => ({ offset: Math.min(1, ms / timing.spin), transform: `translate3d(${(-reelPosition(ms, distance, overshoot, timing)).toFixed(2)}px, 0, 0)` }))
}
