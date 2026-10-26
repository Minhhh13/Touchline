/**
 * Key moments on the live pitch, after Football Manager's match view: the
 * camera leans in on a big chance, and a goal is shown again in slow motion
 * once the celebration is over.
 *
 * Both are presentation only. The replay is the same ball path and the same
 * shapes played back over a window before the strike (the goal's clock hold
 * simply lasts longer, `REPLAY.ms`), so it shows exactly what was seen and a
 * second viewing of the match shows the same replay. The camera is a scale
 * and a pan of the drawn pitch towards the moment, kept inside the pitch.
 * Both follow a per-viewer setting (`keyMomentsPref`, on by default) and are
 * off with reduced motion.
 *
 * Pure: functions of the hold, the elapsed milliseconds and the match time.
 */
import type { MatchEvent } from '@engine/types'
import type { PitchPoint } from '@engine/matchDetail'
import { shotXg } from '@engine/matchStats'
import type { GoalHold } from './clockStore'
import { strikeTimes } from './timing'
import { toShared } from './pitchGeometry'

/**
 * The goal replay: `ms` added to the goal's hold, of which `cut` at each end is the cut to and from the
 * replay (a quick dip to dark), `window` match minutes before the strike are played back over the
 * time before the shot (about 0.65x of 1x), and `flight` ms show the ball going in slowly, then `rest`
 * ms on the net.
 */
export const REPLAY = { ms: 3900, cut: 240, window: 0.42, flight: 760, rest: 320 } as const

/** The replay's share of a hold, or 0 when it has none. */
export function replayMs(hold: Pick<GoalHold, 'replay'> | undefined): number {
  return hold?.replay ?? 0
}

/** The celebration's own length in a hold (the hold less its replay). */
export function celebrationMs(hold: Pick<GoalHold, 'ms' | 'replay'>): number {
  return hold.ms - replayMs(hold)
}

export interface ReplayFrame {
  /** The match time the replay is showing (fractional minute). */
  T: number
  /** The ball's flight into the net once T reaches the strike, 0..1 (0 before the strike). */
  flight: number
  /** Milliseconds since the ball hit the net in the replay (negative before). */
  landed: number
  /** How dark the cut is, 0..1 (1 at the very start and the very end). */
  cut: number
  /** How far into the replay, 0..1. */
  f: number
}

/** What the replay shows `elapsed` ms into a goal's hold struck at `strike`; null outside the replay. */
export function replayFrame(hold: Pick<GoalHold, 'ms' | 'replay'>, elapsed: number, strike: number): ReplayFrame | null {
  const total = replayMs(hold)
  if (total <= 0) return null
  const start = hold.ms - total
  const r = elapsed - start
  if (r < 0 || r > total) return null
  const pre = Math.max(1, total - REPLAY.flight - REPLAY.rest)
  // On the strike exactly once the build-up has played (the ball path's shot keyframe is there)
  const T = r >= pre ? strike : strike - REPLAY.window * (1 - r / pre)
  const flight = r <= pre ? 0 : Math.min(1, (r - pre) / REPLAY.flight)
  const cut = r < REPLAY.cut ? 1 - r / REPLAY.cut : r > total - REPLAY.cut ? (r - (total - REPLAY.cut)) / REPLAY.cut : 0
  return { T, flight, landed: r - pre - REPLAY.flight, cut: Math.min(1, Math.max(0, cut)), f: r / total }
}

/** A moment the camera leans in on: a goal, or a chance or save good enough to be a big chance. */
export interface FocusMoment {
  t: number
  at: PitchPoint
  goal: boolean
}

/** A chance at least this good gets the camera. */
export const FOCUS_XG = 0.25

/** Every moment in the ranges worth the camera, in shared coordinates, by strike time. */
export function focusMoments(events: MatchEvent[], ranges: Array<{ from: number; to: number }>): FocusMoment[] {
  const out: FocusMoment[] = []
  for (const r of ranges) {
    for (const [idx, t] of strikeTimes(events, r.from, r.to)) {
      const e = events[idx]
      const goal = e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal'
      if (!goal && shotXg(e) < FOCUS_XG) continue
      out.push({ t, at: toShared(e.position ?? { x: 88, y: 50 }, e.side), goal })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

function smooth(v: number): number {
  const x = Math.min(1, Math.max(0, v))
  return x * x * (3 - 2 * x)
}

/** How far the camera leans in at match time T (0..1) and on what: rising over `lead` minutes before the strike, falling over `tail` after. */
export function focusAt(moments: FocusMoment[], T: number, lead: number, tail: number): { w: number; at: PitchPoint | null } {
  let w = 0
  let at: PitchPoint | null = null
  for (const m of moments) {
    if (m.t - lead > T) break
    const k = T <= m.t ? smooth((T - (m.t - lead)) / Math.max(1e-6, lead)) : 1 - smooth((T - m.t) / Math.max(1e-6, tail))
    if (k > w) {
      w = k
      at = m.at
    }
  }
  return { w, at }
}

/** The camera's scale at full lean: a big chance in play, and the replay. */
export const CAMERA = { chance: 1.28, replay: 1.6, leadMs: 1500, tailMs: 1100 } as const

/** The box the camera may show (SVG units): the pitch with its margin. */
export interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The transform that shows the pitch `scale` times bigger centred as near `focus` (SVG units) as the
 * box allows: `translate(tx ty) scale(s)`, never showing anything outside the box. Scale 1 is the
 * whole box, untouched.
 */
export function cameraTransform(focus: { x: number; y: number }, scale: number, box: ViewBox): { tx: number; ty: number; s: number } {
  const s = Math.max(1, scale)
  if (s <= 1.0005) return { tx: 0, ty: 0, s: 1 }
  const vw = box.w / s
  const vh = box.h / s
  const cx = Math.min(box.x + box.w - vw / 2, Math.max(box.x + vw / 2, focus.x))
  const cy = Math.min(box.y + box.h - vh / 2, Math.max(box.y + vh / 2, focus.y))
  // The view's top-left (cx - vw/2, cy - vh/2) lands on the box's top-left
  return { tx: box.x - (cx - vw / 2) * s, ty: box.y - (cy - vh / 2) * s, s }
}
