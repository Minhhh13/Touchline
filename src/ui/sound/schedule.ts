/*
 * When the case reel's ticks fall: one tick each time a card boundary crosses
 * the centre marker, in either direction, read off the same position function
 * the strip slides on (`reelPosition`), so the ticks run dense at the start and
 * sparse at the end. Pure: no DOM, no audio, no randomness.
 */

export interface TickGeometry {
  /** The boundaries between cards (the middle of each gap) in the strip's own coordinates, px, ascending. */
  boundaries: readonly number[]
  /** Where the marker sits in strip coordinates before the slide (half the window's width), px. */
  marker: number
}

export interface TickTiming {
  /** How far the strip has slid, px, `ms` into the slide. */
  position: (ms: number) => number
  /** The slide's length, ms. */
  duration: number
  /** The ease back at the end of the slide, ms: when it crosses no boundary, one settle tick falls in its middle. */
  bounce?: number
  /** ms before the slide starts (the season stage). */
  delay?: number
  /** Sampling step, ms. */
  step?: number
}

/** The first index whose boundary is above `x`. */
function above(b: readonly number[], x: number): number {
  let lo = 0
  let hi = b.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (b[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The ms (from the run's start) at which a boundary passes the marker, in order; crossings back (the overshoot's return) count too. */
export function tickTimes(g: TickGeometry, timing: TickTiming): number[] {
  const delay = timing.delay ?? 0
  const step = timing.step ?? 1
  const bounce = timing.bounce ?? 0
  if (!(timing.duration > 0)) return []
  const out: number[] = []
  let prevT = 0
  let prev = g.marker + timing.position(0)
  for (let t = step; prevT < timing.duration; t += step) {
    const now = Math.min(t, timing.duration)
    const cur = g.marker + timing.position(now)
    if (cur !== prev) {
      // Every boundary strictly between the two samples (or reached by the later one), interpolated inside the step
      const lo = Math.min(prev, cur)
      const hi = Math.max(prev, cur)
      for (let i = above(g.boundaries, lo); i < g.boundaries.length && g.boundaries[i] <= hi; i++) {
        const f = (g.boundaries[i] - prev) / (cur - prev)
        out.push(delay + prevT + f * (now - prevT))
      }
    }
    prev = cur
    prevT = now
  }
  out.sort((a, b) => a - b)
  if (bounce > 0 && out.length) {
    const backFrom = delay + timing.duration - bounce
    if (!out.some((t) => t > backFrom)) out.push(backFrom + bounce / 2)
  }
  return out
}
