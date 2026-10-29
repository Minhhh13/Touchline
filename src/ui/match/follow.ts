/**
 * How a man's dot on the live pitch follows where the movement formula puts him (movement.ts): a critically damped
 * spring (the "smooth damp" of game engines) rather than a plain exponential ease. An exponential ease sets off at
 * full speed the frame a target moves, so a man lurches when the ball changes hands; the spring starts from the speed
 * he already has, gathers pace and arrives without overshooting, and a cap on his speed keeps a big jump (a restart
 * lining up, a change of shape) a run rather than a dash. Presentation only: it reads nothing but the two points.
 */

export interface Follow {
  x: number
  y: number
  /** Velocity, pitch units per ms. */
  vx: number
  vy: number
}

/**
 * The follow's tuning: `smooth` ms is about how long a step takes to close (the same steady lag behind a moving target
 * as the old ease's time constant), `maxSpeed` the most a man covers, pitch units per ms at 1x (about 45 m/s of picture,
 * which runs some thirteen times faster than the match), scaled with the speed played.
 */
export const FOLLOW = { smooth: 150, maxSpeed: 0.045 } as const

/** The cap at a playback speed: the picture hurries, so may the men. */
export function followCap(speed: number): number {
  return FOLLOW.maxSpeed * Math.max(1, speed)
}

/** One step of the follow towards (tx, ty) over `dt` ms with smoothing `smooth` ms and speed cap `cap`. Pure. */
export function follow(cur: Follow, tx: number, ty: number, dt: number, smooth: number, cap: number): Follow {
  if (dt <= 0) return cur
  if (smooth <= 0) return { x: tx, y: ty, vx: 0, vy: 0 }
  const omega = 2 / smooth
  const k = omega * dt
  const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k)
  let cx = cur.x - tx
  let cy = cur.y - ty
  // Never further behind than the cap allows: a long way to go is a run at the cap, not a dash
  const most = cap * smooth
  const len = Math.hypot(cx, cy)
  if (len > most && len > 0) {
    cx *= most / len
    cy *= most / len
  }
  const gx = cur.x - cx
  const gy = cur.y - cy
  const ux = (cur.vx + omega * cx) * dt
  const uy = (cur.vy + omega * cy) * dt
  let vx = (cur.vx - omega * ux) * decay
  let vy = (cur.vy - omega * uy) * decay
  let x = gx + (cx + ux) * decay
  let y = gy + (cy + uy) * decay
  // Never past the target: arriving, he stops on it
  if ((tx - cur.x) * (x - tx) + (ty - cur.y) * (y - ty) > 0) {
    x = tx
    y = ty
    vx = 0
    vy = 0
  }
  return { x, y, vx, vy }
}
