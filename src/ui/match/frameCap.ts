/**
 * The live pitch's frame cap: a device that keeps missing 60 fps draws every other frame (30 fps) instead of
 * struggling at an uneven 35 to 45, and goes back to every frame once its drawn frames fit a 60 fps frame again. What
 * a frame shows is untouched: the pitch reads the shared clock at the moment it draws, so a capped picture is the
 * same picture at fewer moments. Presentation only, pure (the caller passes the rAF timestamps).
 */

/**
 * A frame interval over `slow` ms misses 60 fps. The share of slow frames is a running mean (`keep` per frame): over
 * `on` after `warm` frames caps the pitch. Capped, the share of drawn frames followed by a frame within `fit` ms is
 * tracked the same way; over `off` after `recover` drawn frames lifts the cap.
 */
export const FRAME_CAP = { slow: 22, fit: 19, keep: 0.92, on: 0.5, off: 0.9, warm: 20, recover: 90, interval: 1000 / 30, slack: 4 } as const

export interface FrameCap {
  capped: boolean
  /** The previous animation frame's timestamp (drawn or skipped), 0 after a sleep. */
  lastFrame: number
  /** The last drawn frame's timestamp. */
  lastDrawn: number
  /** Whether the previous frame was drawn (its interval then holds what drawing costs). */
  drewLast: boolean
  /** Uncapped: the running share of slow frames; capped: of drawn frames that fit. */
  share: number
  /** Frames counted since the last switch. */
  counted: number
}

export function frameCap(): FrameCap {
  return { capped: false, lastFrame: 0, lastDrawn: 0, drewLast: false, share: 0, counted: 0 }
}

/** After a sleep (paused, at a stop): the next frame draws and measures nothing. */
export function wakeCap(c: FrameCap): void {
  c.lastFrame = 0
  c.drewLast = false
}

/**
 * Account for an animation frame at `now` and say whether to draw it. Returns the interval since the frame before
 * (0 after a sleep) for the caller's own frame-time measure.
 */
export function capFrame(c: FrameCap, now: number): { draw: boolean; interval: number } {
  const interval = c.lastFrame ? now - c.lastFrame : 0
  c.lastFrame = now
  // Only an interval that follows a drawn frame says what drawing costs (a skipped frame costs nothing)
  if (interval > 0 && c.drewLast) {
    const hit = c.capped ? interval <= FRAME_CAP.fit : interval > FRAME_CAP.slow
    c.share = c.share * FRAME_CAP.keep + (hit ? 1 - FRAME_CAP.keep : 0)
    c.counted++
    if (!c.capped && c.counted >= FRAME_CAP.warm && c.share > FRAME_CAP.on) {
      c.capped = true
      c.share = 0
      c.counted = 0
    } else if (c.capped && c.counted >= FRAME_CAP.recover && c.share > FRAME_CAP.off) {
      c.capped = false
      c.share = 0
      c.counted = 0
    }
  }
  const draw = !c.capped || !c.lastDrawn || interval === 0 || now - c.lastDrawn >= FRAME_CAP.interval - FRAME_CAP.slack
  c.drewLast = draw
  if (draw) c.lastDrawn = now
  return { draw, interval }
}
