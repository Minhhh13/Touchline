/**
 * Where a side stands as a team, moment by moment: the shape the live pitch,
 * the heat maps and the ball path's choice of receivers all read.
 *
 * A side's formation slots are its attacking layout (keeper at 6, strikers
 * at 86 along its own direction). On the pitch they are squeezed into a
 * block between a back line and a front line that follow the ball: in
 * possession the block stretches and climbs with it (full-backs push on and
 * overlap in the final third, the wide men hold the touchline), out of
 * possession it drops, narrows and slides across towards the ball. A change
 * of possession blends from one to the other over about two seconds at 1x
 * (`Scene.settle`), so nobody snaps.
 *
 * Set pieces override the shape while they are staged: both halves at a
 * kick-off, the box filled for a corner or a free kick near goal (with a
 * wall), everyone out of the box for a penalty, the press held outside the
 * box at a goal kick. A ball being crossed sends the attackers into the box
 * and the defenders back to it.
 *
 * Pure: a function of the ball path and the time, so a replay looks the same.
 */
import type { PitchPoint } from '@engine/matchDetail'
import type { Position } from '@engine/types'
import type { BallKeyframe, BallState, SetPieceKind } from './possession'
import type { PlacedPlayer, Side } from './pitchGeometry'

export interface SceneSetPiece {
  kind: SetPieceKind
  /** The side taking it. */
  side: Side
  at: PitchPoint
  /** How far it is set up, 0..1 (rises while the ball is fetched, falls once it is taken). */
  w: number
  taker?: string
}

export interface Scene {
  ball: PitchPoint | null
  /** The side on the ball. */
  poss: Side
  /** How settled that possession is, 0 (just won) to 1. */
  settle: number
  setPiece: SceneSetPiece | null
  /** A ball into the box on its way or just arrived, 0..1, and the side that put it in. */
  box: number
  boxSide: Side
}

/** Seconds-ish of match time a change of possession takes to reshape both sides. */
export const SETTLE_MINUTES = 0.5

const DELIVERIES = new Set(['cross', 'cutback'])

export function smooth01(v: number): number {
  const x = Math.min(1, Math.max(0, v))
  return x * x * (3 - 2 * x)
}

/** The scene at time T, from the ball path and the ball's state there. */
export function sceneAt(path: BallKeyframe[], b: BallState | null, T: number): Scene {
  if (!b || !path.length) return { ball: null, poss: 'home', settle: 1, setPiece: null, box: 0, boxSide: 'home' }
  const i = b.index
  const poss = b.side
  // When possession last changed: half-way along the hop on which it changed hands
  let k = i
  while (k >= 0 && i - k < 80 && path[k].side === poss) k--
  let settle = 1
  if (k >= 0 && i - k < 80) {
    const a = path[k]
    const n = path[k + 1] ?? a
    settle = smooth01((T - (a.t + n.t) / 2) / SETTLE_MINUTES)
  }
  // A set piece being set up or just taken nearby
  let setPiece: SceneSetPiece | null = null
  for (let j = Math.min(path.length - 1, i + 1); j >= 0 && j >= i - 5; j--) {
    const kf = path[j]
    if (!kf.setPiece) continue
    const start = j > 0 ? path[j - 1].t : kf.t
    // Back into their halves after a goal takes a moment longer than walking to a corner flag
    const rise = j === 0 ? 1 : smooth01((T - start) / Math.max(kf.setPiece.kind === 'kickoff' ? 0.25 : 0.12, kf.t - start))
    const fall = 1 - smooth01((T - kf.setPiece.until - 0.05) / 0.4)
    const w = Math.min(rise, fall)
    if (w > 0) setPiece = { kind: kf.setPiece.kind, side: kf.side, at: { x: kf.x, y: kf.y }, w, taker: kf.holder }
    break
  }
  // A cross on its way in, or just arrived
  let box = 0
  let boxSide: Side = poss
  const cur = path[i]
  const next = b.next
  if (next && next.play && DELIVERIES.has(next.play)) {
    box = 0.35 + 0.65 * b.progress
    boxSide = cur.side
  } else if (cur.play && DELIVERIES.has(cur.play) && T - cur.t < 0.4) {
    box = 1 - (T - cur.t) / 0.4
    boxSide = path[i - 1]?.side ?? cur.side
  }
  return { ball: { x: b.x, y: b.y }, poss, settle, setPiece, box, boxSide }
}

/** Along (towards the goal the side attacks) and across in the side's own attacking coordinates. */
function along(side: Side, p: PitchPoint): number {
  return side === 'home' ? p.x : 100 - p.x
}
function across(side: Side, p: PitchPoint): number {
  return side === 'home' ? p.y : 100 - p.y
}
function shared(side: Side, a: number, c: number): PitchPoint {
  return side === 'home' ? { x: a, y: c } : { x: 100 - a, y: 100 - c }
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f
}

const FULL_BACK = new Set<Position>(['LB', 'RB'])
const FORWARD = new Set<Position>(['ST', 'LW', 'RW', 'AM'])

/** A small fixed jitter per man, 0..1, from his sway phase (so two men never stand on the same spot of the box). */
function jitter(phase: number, k: number): number {
  const v = Math.sin(phase * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

/** The block between the back line and the front line, in the side's attacking coordinates, with the ball at `ab` along. */
export function block(ab: number, inPossession: boolean): { back: number; front: number } {
  if (inPossession) return { back: clamp(ab - 30, 18, 50), front: clamp(ab + 22, 58, 90) }
  const back = clamp(ab - 22, 8, 40)
  return { back, front: clamp(back + 32, 38, 72) }
}

/** A man's place in his side's shape at this scene (before the man on the ball, the press and his sway). */
export function shapePoint(p: PlacedPlayer, sc: Scene, phase = 0): PitchPoint {
  const ball = sc.ball
  if (!ball) return { x: p.x, y: p.y }
  const s = p.side
  const a0 = along(s, p)
  const c0 = across(s, p)
  const ab = along(s, ball)
  const cb = across(s, ball)
  const q = s === sc.poss ? sc.settle : 1 - sc.settle
  let a: number
  let c: number
  if (p.position === 'GK') {
    const inA = clamp(3 + Math.max(0, ab - 40) * 0.2, 3, 16)
    const outA = clamp(3 + Math.max(0, ab - 55) * 0.1, 2.5, 8)
    a = lerp(outA, inA, q)
    c = 50 + (cb - 50) * lerp(0.22, 0.12, q)
  } else {
    const r = clamp((a0 - 22) / 64, -0.15, 1.1)
    const bi = block(ab, true)
    const bo = block(ab, false)
    let inA = bi.back + r * (bi.front - bi.back)
    let outA = bo.back + r * (bo.front - bo.back)
    let inC = 50 + (c0 - 50) * (Math.abs(c0 - 50) > 22 ? 1.1 : 1.02) + (cb - 50) * 0.1
    const outC = 50 + (c0 - 50) * 0.72 + (cb - 50) * 0.3
    // Full-backs overlap in the final third
    if (FULL_BACK.has(p.position) && ab > 58) {
      const f = clamp((ab - 58) / 20, 0, 1)
      inA += 10 * f
      inC = 50 + (inC - 50) * (1 + 0.18 * f)
    }
    // Forwards never stand far beyond the ball nor beyond the last line; nobody else beyond the forwards
    if (FORWARD.has(p.position)) inA = Math.min(inA, Math.max(ab + 24, 60), 91)
    else inA = Math.min(inA, Math.max(ab + 12, 52), 84)
    outA = Math.max(outA, 4)
    a = lerp(outA, inA, q)
    c = lerp(outC, inC, q)
  }
  let pt = { a, c }
  const sp = sc.setPiece
  if (sp && sp.w > 0) {
    const target = setPieceSpot(p, sp, a, c, c0, phase)
    pt = { a: lerp(a, target.a, sp.w), c: lerp(c, target.c, sp.w) }
  }
  if (sc.box > 0 && !(sp && sp.w > 0.5) && p.position !== 'GK') {
    const attacking = s === sc.boxSide
    const into = attacking ? FORWARD.has(p.position) || (p.position === 'CM' && c0 < 50) : true
    if (into) {
      const ta = attacking ? 84 + jitter(phase, 1) * 9 : 4 + jitter(phase, 2) * 9
      const tc = 50 + (c0 - 50) * (attacking ? 0.42 : 0.45)
      const w = sc.box * (attacking ? 0.8 : 0.7)
      pt = { a: lerp(pt.a, ta, w), c: lerp(pt.c, tc, w) }
    }
  }
  const out = shared(s, clamp(pt.a, 1, 99), clamp(pt.c, 2, 98))
  return out
}

/** Where a man goes for a set piece, in his side's attacking coordinates (`a`, `c` is his open-play spot). */
function setPieceSpot(p: PlacedPlayer, sp: SceneSetPiece, a: number, c: number, c0: number, phase: number): { a: number; c: number } {
  const s = p.side
  const taking = s === sp.side
  const ba = along(s, sp.at)
  const bc = across(s, sp.at)
  const keeper = p.position === 'GK'
  switch (sp.kind) {
    case 'kickoff': {
      let na = Math.min(a, 46.5)
      let nc = c
      // Out of the centre circle, except the man taking it
      if (p.psId !== sp.taker || !taking) {
        const dx = (na - 50) * 1.05
        const dy = (nc - 50) * 0.68
        const d = Math.hypot(dx, dy)
        if (d < 10.5) {
          na = 50 - 10.5 / 1.05
          nc = 50 + (d > 0.1 ? (dy / d) * 4 : 0)
        }
      }
      return { a: na, c: nc }
    }
    case 'corner': {
      if (keeper) return taking ? { a: Math.max(a, 8), c: 50 } : { a: 1.5, c: 50 + (bc - 50) * 0.08 }
      if (taking) {
        const attack = FORWARD.has(p.position) || (p.position === 'CB' && c0 < 50) || (p.position === 'CM' && c0 >= 50)
        if (attack) return { a: 86 + jitter(phase, 3) * 8, c: 50 + (c0 - 50) * 0.38 + (jitter(phase, 4) - 0.5) * 8 }
        if (p.position === 'CB') return { a: 50, c: 50 + (c0 - 50) * 0.5 }
        return { a: 70 + jitter(phase, 5) * 6, c: 50 + (c0 - 50) * 0.7 }
      }
      // Defending it: all back in the box but one man left up for the break
      if (p.position === 'ST' && c0 <= 50) return { a: 40, c: 50 }
      return { a: 3 + jitter(phase, 6) * 10, c: 50 + (c0 - 50) * 0.42 }
    }
    case 'freekick': {
      const near = taking ? ba >= 64 : ba <= 36
      if (!near) {
        // A free kick in the middle of the pitch: the opponents stand ten yards off
        if (taking) return { a, c }
        return away(a, c, ba, bc, 10)
      }
      if (keeper) return taking ? { a: Math.max(a, 10), c: 50 } : { a: 1.5, c: 50 + (bc - 50) * 0.2 }
      if (taking) {
        if (p.psId === sp.taker) return { a, c }
        const attack = FORWARD.has(p.position) || p.position === 'CB' || p.position === 'CM'
        if (attack) return { a: Math.min(ba + 6, 84) + jitter(phase, 7) * 4, c: 50 + (c0 - 50) * 0.45 }
        return { a: 52, c: 50 + (c0 - 50) * 0.6 }
      }
      // Defending: a wall of the forwards between the ball and the middle of the goal, the rest in the box
      if (FORWARD.has(p.position)) {
        const dx = (0 - ba) * 1.05
        const dy = (50 - bc) * 0.68
        const d = Math.hypot(dx, dy) || 1
        const wa = ba + (dx / d) * 9.2 / 1.05
        const wc = bc + (dy / d) * 9.2 / 0.68 + (c0 - 50) * 0.05
        return { a: wa, c: wc }
      }
      return { a: 5 + jitter(phase, 8) * 9, c: 50 + (c0 - 50) * 0.45 }
    }
    case 'penalty': {
      if (keeper) return taking ? { a: Math.max(a, 8), c: 50 } : { a: 0.8, c: 50 }
      if (p.psId === sp.taker && taking) return { a, c }
      // Everyone else outside the box and the arc, spread along its edge
      const edge = taking ? 80 + jitter(phase, 9) * 2 : 18 + jitter(phase, 10) * 3
      return { a: taking ? Math.min(a, edge) : Math.max(a, edge), c: 50 + (c0 - 50) * 0.75 }
    }
    case 'goalkick': {
      if (taking) {
        if (keeper) return { a, c }
        if (p.position === 'CB') return { a: 12, c: c0 < 50 ? 26 : 74 }
        if (FULL_BACK.has(p.position)) return { a: 24, c: c0 < 50 ? 8 : 92 }
        return { a, c }
      }
      // The press waits outside the box
      return { a: Math.min(a, 80), c }
    }
    case 'throw':
    default:
      return { a, c }
  }
}

/** Ten yards (metres `r`) off the ball at (ba, bc), in attacking coordinates. */
function away(a: number, c: number, ba: number, bc: number, r: number): { a: number; c: number } {
  const dx = (a - ba) * 1.05
  const dy = (c - bc) * 0.68
  const d = Math.hypot(dx, dy)
  if (d >= r) return { a, c }
  if (d < 0.1) return { a: ba - r / 1.05, c }
  return { a: ba + ((dx / d) * r) / 1.05, c: bc + ((dy / d) * r) / 0.68 }
}

/** The caption over the live pitch: what the side on the ball is doing (a set piece, a counter, the phase of its move). */
export interface PhaseCaption {
  text: string
  side: Side
}

const SET_PIECE_TEXT: Record<SetPieceKind, string> = { kickoff: 'Kick-off', corner: 'Corner', freekick: 'Free kick', penalty: 'Penalty', goalkick: 'Goal kick', throw: 'Throw-in' }

export function phaseCaption(path: BallKeyframe[], b: BallState | null, sc: Scene): PhaseCaption | null {
  if (!b) return null
  if (sc.setPiece && sc.setPiece.w > 0.3) return { text: SET_PIECE_TEXT[sc.setPiece.kind], side: sc.setPiece.side }
  const at = b.progress >= 0.5 && b.next ? b.index + 1 : b.index
  const k = path[at]
  if (!k) return null
  if (k.phase === 'setpiece') {
    // A set piece just taken (the corner swung in, the free kick on its way): it keeps its name until the ball is won or struck
    for (let j = at; j >= 0 && j >= at - 4; j--) {
      const sp = path[j].setPiece
      if (sp) return { text: SET_PIECE_TEXT[sp.kind], side: path[j].side }
    }
  }
  if (k.kind === 'shot' || k.kind === 'goal' || k.kind === 'miss' || k.kind === 'save') return { text: 'Shot', side: k.kind === 'save' ? (k.side === 'home' ? 'away' : 'home') : k.side }
  switch (k.phase) {
    case 'counter':
      return { text: 'Counter-attack', side: k.side }
    case 'buildup':
      return { text: 'Building from the back', side: k.side }
    case 'progression':
      return { text: k.play === 'switch' ? 'Switch of play' : 'Through midfield', side: k.side }
    case 'final':
      return { text: k.play === 'cross' ? 'Cross' : k.play === 'through' ? 'Ball in behind' : 'Final third', side: k.side }
    default:
      return { text: 'Possession', side: k.side }
  }
}
