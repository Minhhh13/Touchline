/*
 * The Upgrader dial's motion, pure: where the needle stops for a roll and where it is at any moment of its spin.
 * The ring holds the hundred rolls clockwise from twelve o'clock, 3.6 degrees each, and the win arc covers rolls 0 to
 * chance - 1, so the needle lands inside the arc exactly when the logic's roll won. The spin is several full turns
 * and a long ease-out onto that spot; the ticks are the needle passing the ring's marks. The roll is the game's,
 * already made: this only animates it. Presentation only.
 */
import { cubicBezier } from './reelCurve'

/** Degrees of ring per roll: 100 rolls round the dial. */
export const DEG_PER_ROLL = 3.6
/** Full turns before the needle settles. */
export const DIAL_TURNS = 5
/** The spin's length, ms: the full spin, Quick spin (the viewer's setting), and the reduced-motion jump's pause. */
export const DIAL_FULL_MS = 5200
export const DIAL_QUICK_MS = 2200
export const DIAL_REDUCED_MS = 500
/** The pause at rest before the verdict shows, ms. */
export const DIAL_HOLD_MS = 350
/** A tick every this many degrees: the ring's twenty marks, one per 5%. */
export const TICK_DEG = 18

/** A long ease-out: fast off the mark, then a slow creep onto the stop, flat at the end. */
export const DIAL_CURVE = [0.08, 0.72, 0.12, 1] as const
const ease = cubicBezier(...DIAL_CURVE)

/**
 * Where, from twelve o'clock clockwise, the needle stops for `roll` (0 to 99): inside that roll's 3.6 degrees, at a
 * spot fixed by the roll (a fifth to four fifths across), so the same result always lands the same way and never on
 * the line between a win and a loss.
 */
export function landingAngle(roll: number): number {
  const r = Math.min(99, Math.max(0, Math.round(roll)))
  const within = 0.2 + ((r * 37) % 61) / 100
  return (r + within) * DEG_PER_ROLL
}

/** The roll under an angle of the ring. */
export function rollAt(angle: number): number {
  const a = ((angle % 360) + 360) % 360
  return Math.min(99, Math.floor(a / DEG_PER_ROLL))
}

/** Whether an angle of the ring is inside the win arc of a `chance` per cent gamble. */
export function inWinArc(angle: number, chance: number): boolean {
  return rollAt(angle) < chance
}

/** The needle's whole travel for a roll: the turns and the landing. */
export function dialTravel(roll: number, turns = DIAL_TURNS): number {
  return turns * 360 + landingAngle(roll)
}

/** The needle's angle `ms` into a spin of `total` ms onto `roll`: the travel times the ease-out, exact at both ends. */
export function needleAngle(ms: number, total: number, roll: number, turns = DIAL_TURNS): number {
  const travel = dialTravel(roll, turns)
  if (ms <= 0 || total <= 0) return ms <= 0 && total > 0 ? 0 : travel
  if (ms >= total) return travel
  return travel * ease(ms / total)
}

/** How many tick marks the needle has passed at `angle` of travel. */
export function ticksPassed(angle: number): number {
  return Math.floor(Math.max(0, angle) / TICK_DEG)
}

/**
 * The Upgrader's one line for a screen reader (its live region stays mounted, so each moment is said once): the gamble
 * while the dial turns, then the verdict. The dial itself is a picture. Ratings are left out when they are hidden.
 */
export function upgraderAnnouncement(r: { name: string; chance: number; boost: number; landed: boolean; won: boolean; locked: boolean; delta: number; base: number; hideRatings: boolean; roll: number }): string {
  if (!r.landed) return `${r.name}: ${r.chance}% for plus ${r.boost}. The dial is turning.`
  const head = r.won ? 'Upgraded!' : r.locked ? 'The lock held.' : 'Downgraded.'
  const change = r.locked ? `${r.name} keeps his rating` : `${r.name} ${r.delta > 0 ? 'plus' : 'minus'} ${Math.abs(r.delta)}${r.hideRatings ? '' : `, ${r.base} to ${r.base + r.delta}`}`
  return `${head} ${change}. Rolled ${r.roll} against ${r.chance}%.`
}
