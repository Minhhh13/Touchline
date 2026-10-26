/**
 * What the live pitch draws over the play, as Football Manager's 2D view
 * does: the name of the man on the ball, a short flash of the line a pass is
 * played along, and the line of every shot coloured by its expected goals
 * (white for a hopeful one, amber for a decent chance, red for a big one).
 *
 * Pure: functions of the ball path, the match's events and the time.
 */
import type { MatchEvent } from '@engine/types'
import type { PitchPoint } from '@engine/matchDetail'
import { shotXg } from '@engine/matchStats'
import type { BallKeyframe, BallState, PlayTag } from './possession'
import { strikeTimes } from './timing'
import type { Side } from './pitchGeometry'

/** The passes whose line flashes: the ones that move the play on (not a touch back or a tackle). */
export const FLASHED = new Set<PlayTag>(['forward', 'through', 'switch', 'long', 'cross', 'cutback', 'layoff', 'distribution', 'short'])
/** How long the pass line shows, as a share of the pass, and how strongly at the start. */
export const FLASH = { share: 0.6, alpha: 0.6 } as const

export interface PassFlash {
  from: PitchPoint
  to: PitchPoint
  side: Side
  /** 0..1, fading as the ball travels. */
  alpha: number
  /** A ball into space or over the top (drawn dashed). */
  air: boolean
}

/** The pass line at this moment: from where it was played to where it is going, fading out over the first part of its travel; null when no pass is on. */
export function passFlash(path: BallKeyframe[], b: BallState | null): PassFlash | null {
  if (!b || !b.next) return null
  const a = path[b.index]
  const n = b.next
  if (!a || n.kind !== 'pass' || !n.play || !FLASHED.has(n.play) || !n.holder || n.side !== a.side || b.progress >= FLASH.share) return null
  const x = b.progress / FLASH.share
  const alpha = FLASH.alpha * (1 - x * x)
  if (alpha <= 0.01) return null
  return { from: { x: a.x, y: a.y }, to: { x: n.x, y: n.y }, side: n.side, alpha, air: (n.loft ?? 0) >= 0.3 || n.play === 'through' }
}

/** A shot's colour band by its expected goals. */
export type XgBand = 'low' | 'mid' | 'high'
export const XG_BANDS = { mid: 0.08, high: 0.25 } as const
export function xgBand(xg: number): XgBand {
  return xg >= XG_BANDS.high ? 'high' : xg >= XG_BANDS.mid ? 'mid' : 'low'
}

/** Every shot keyframe of the path with its event: its index in the events, its expected goals and its band. */
export interface ShotMark {
  event: number
  xg: number
  band: XgBand
  side: Side
}

/** The shot keyframes of a path that runs over `ranges` (the epochs, or one from..to), each matched to its event by the strike moment (timing.ts). */
export function shotMarks(path: BallKeyframe[], events: MatchEvent[], ranges: Array<{ from: number; to: number }>): Map<number, ShotMark> {
  const strikes: Array<{ t: number; idx: number }> = []
  for (const r of ranges) for (const [idx, t] of strikeTimes(events, r.from, r.to)) strikes.push({ t, idx })
  const out = new Map<number, ShotMark>()
  if (!strikes.length) return out
  path.forEach((k, i) => {
    if (k.kind !== 'shot') return
    let best: { t: number; idx: number } | null = null
    for (const s of strikes) if (Math.abs(s.t - k.t) < 0.02 && events[s.idx]?.side === k.side && (!best || Math.abs(s.t - k.t) < Math.abs(best.t - k.t))) best = s
    if (!best) return
    const e = events[best.idx]
    const xg = shotXg(e)
    out.set(i, { event: best.idx, xg, band: xgBand(xg), side: e.side })
  })
  return out
}

/** The shot whose line is on screen at time T: the strike among the last few keyframes, and how strongly to draw it (fading over `fade` minutes). A goal is left out: its flight is drawn while the clock holds. */
export function shotTrailAt(path: BallKeyframe[], b: BallState | null, T: number, fade = 0.7): { index: number; alpha: number } | null {
  if (!b) return null
  for (let k = b.index; k >= 0 && k >= b.index - 2; k--) {
    const kf = path[k]
    if (kf.kind !== 'shot' || k >= path.length - 1) continue
    if (path[k + 1].kind === 'goal') return null
    const age = T - kf.t
    if (age < 0 || age >= fade) return null
    return { index: k, alpha: 0.85 * (1 - age / fade) }
  }
  return null
}

/** The name to print under a dot: the surname (the last word of a name, or all of a single one), cut to `max` letters. */
export function dotName(name: string | undefined, max = 12): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  // Keep a particle with the surname (van Dijk, De Bruyne)
  let last = parts[parts.length - 1]
  const prev = parts[parts.length - 2]
  if (prev && parts.length > 2 && /^(van|von|de|da|di|del|der|le|la|dos|das|ter|ten|el|al|mac|mc)$/i.test(prev)) last = `${prev} ${last}`
  return last.length > max ? `${last.slice(0, max - 1)}.` : last
}

/** Where a corner is being swung in while it flies: to the near post, the far post, the middle of the goal or the edge of the box. */
export type Delivery = 'near post' | 'far post' | 'six-yard box' | 'edge of the box'

/** The delivery of a corner in flight at this moment (the ball has left the flag for the box), or null. */
export function cornerDelivery(path: BallKeyframe[], b: BallState | null): Delivery | null {
  if (!b || !b.next || b.progress >= 1) return null
  const a = path[b.index]
  const n = b.next
  const atFlag = (a.x < 2 || a.x > 98) && (a.y < 2 || a.y > 98)
  if (!atFlag || n.kind !== 'pass' || n.play !== 'cross') return null
  const right = a.x > 50
  const along = right ? n.x : 100 - n.x
  if (along < 84) return 'edge of the box'
  const flagTop = a.y < 50
  // Shared units across: the goal mouth is 44.6 to 55.4; a ball on the flag's side of the middle is at the near post
  const off = n.y - 50
  if (Math.abs(off) < 3.5) return 'six-yard box'
  return (off < 0) === flagTop ? 'near post' : 'far post'
}
