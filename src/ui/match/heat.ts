/**
 * Heat maps, average positions, pass networks and action zones, accumulated
 * from the same ball path and the same dot movement the live pitch draws, so
 * every map shows where the dots actually went. Shared coordinates throughout
 * (x 0..100 with the home side attacking towards 100, y 0..100 across).
 * Pure: no React, no DOM.
 */
import { onPitchAt, type Side } from './pitchGeometry'
import { ballAt } from './possession'
import { dotPosition, swayPhase } from './movement'
import { epochAt, type MatchPath } from './epochs'

export interface PlayerSample {
  psId: string
  side: Side
  /** Fractional match minute. */
  t: number
  x: number
  y: number
}

/** Where every man on the pitch stood, `perMinute` times in each minute from 1 to `upTo`. */
export function samplePlayers(mpath: MatchPath, upTo: number, perMinute = 4): PlayerSample[] {
  const out: PlayerSample[] = []
  if (!mpath.epochs.length) return out
  const last = Math.min(upTo, mpath.epochs[mpath.epochs.length - 1].to >= 90 ? 99 : mpath.epochs[mpath.epochs.length - 1].to)
  const phases = new Map<string, number>()
  for (let m = 1; m <= last; m++) {
    const epoch = epochAt(mpath, m)
    const men = [...onPitchAt(epoch.home, m), ...onPitchAt(epoch.away, m)]
    for (let i = 0; i < perMinute; i++) {
      const t = m + (i + 0.5) / perMinute
      const b = ballAt(mpath.path, t)
      for (const p of men) {
        let phase = phases.get(p.psId)
        if (phase === undefined) phases.set(p.psId, (phase = swayPhase(p.psId)))
        const pt = dotPosition(p, mpath.path, b, t, phase)
        out.push({ psId: p.psId, side: p.side, t, x: pt.x, y: pt.y })
      }
    }
  }
  return out
}

export interface HeatGrid {
  cols: number
  rows: number
  /** Row-major, 0..1 of the hottest cell. */
  cells: number[]
  /** The hottest cell before normalising (0 when the man has no samples). */
  max: number
}

/** One man's heat: counts per cell of a cols × rows grid over the pitch, blurred [1 2 1] both ways and normalised. */
export function heatGrid(samples: PlayerSample[], psId: string, cols = 21, rows = 14): HeatGrid {
  const raw = new Array<number>(cols * rows).fill(0)
  for (const s of samples) {
    if (s.psId !== psId) continue
    const c = Math.min(cols - 1, Math.max(0, Math.floor((s.x / 100) * cols)))
    const r = Math.min(rows - 1, Math.max(0, Math.floor((s.y / 100) * rows)))
    raw[r * cols + c]++
  }
  const blur = (src: number[], dx: number, dy: number) => {
    const out = new Array<number>(cols * rows).fill(0)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let v = 2 * src[r * cols + c]
        const a = { r: r - dy, c: c - dx }
        const b = { r: r + dy, c: c + dx }
        if (a.r >= 0 && a.c >= 0) v += src[a.r * cols + a.c]
        if (b.r < rows && b.c < cols) v += src[b.r * cols + b.c]
        out[r * cols + c] = v
      }
    }
    return out
  }
  const blurred = blur(blur(raw, 1, 0), 0, 1)
  const max = Math.max(0, ...blurred)
  return { cols, rows, cells: max > 0 ? blurred.map((v) => v / max) : blurred, max }
}

export interface AveragePosition {
  psId: string
  x: number
  y: number
  /** Minutes sampled. */
  minutes: number
}

/** Each man's mean position over his samples (one side). */
export function averagePositions(samples: PlayerSample[], side: Side): AveragePosition[] {
  const acc = new Map<string, { x: number; y: number; n: number; minutes: Set<number> }>()
  for (const s of samples) {
    if (s.side !== side) continue
    const a = acc.get(s.psId) ?? { x: 0, y: 0, n: 0, minutes: new Set<number>() }
    a.x += s.x
    a.y += s.y
    a.n++
    a.minutes.add(Math.floor(s.t))
    acc.set(s.psId, a)
  }
  return [...acc.entries()].map(([psId, a]) => ({ psId, x: a.x / a.n, y: a.y / a.n, minutes: a.minutes.size }))
}

export interface PassNetwork {
  passes: Array<{ from: string; to: string; count: number }>
  total: number
}

/**
 * One side's passes on the ball path up to the end of minute `upTo`: two
 * consecutive passes by the side between different men count one pass from
 * the first to the second; a turnover, a shot, a save, a goal or a new epoch
 * breaks the chain.
 */
export function passNetwork(mpath: MatchPath, side: Side, upTo: number): PassNetwork {
  const counts = new Map<string, number>()
  let total = 0
  let prev: { holder?: string; side: Side; epoch: number } | null = null
  for (const k of mpath.path) {
    if (k.t >= upTo + 1) break
    // A carry keeps the ball at the feet of the man who received it: the chain goes on
    if (k.kind === 'carry' && prev && k.holder === prev.holder && k.side === prev.side) continue
    if (k.kind !== 'pass') {
      prev = null
      continue
    }
    const epoch = epochAt(mpath, k.t).from
    if (prev && prev.side === k.side && prev.epoch === epoch && k.side === side && prev.holder && k.holder && prev.holder !== k.holder) {
      const key = `${prev.holder}>${k.holder}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
      total++
    }
    prev = { holder: k.holder, side: k.side, epoch }
  }
  const passes = [...counts.entries()].map(([key, count]) => {
    const [from, to] = key.split('>')
    return { from, to, count }
  })
  passes.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return { passes, total }
}

export interface Zones {
  /** Per cent of the side's time on the ball in its own third, the middle and the attacking third (adds up to 100). */
  thirds: { defensive: number; middle: number; attacking: number }
  /** Per cent down its left, the centre and its right, facing the way it attacks (adds up to 100). */
  channels: { left: number; centre: number; right: number }
  /** Ball samples counted for the side. */
  samples: number
}

/** Where each side had the ball: eight samples a minute from 1 to `upTo`, by third and channel in its attacking direction. */
export function actionZones(mpath: MatchPath, upTo: number): { home: Zones; away: Zones } {
  const tally = {
    home: { d: 0, m: 0, a: 0, l: 0, c: 0, r: 0, n: 0 },
    away: { d: 0, m: 0, a: 0, l: 0, c: 0, r: 0, n: 0 },
  }
  for (let m = 1; m <= upTo; m++) {
    for (let i = 0; i < 8; i++) {
      const b = ballAt(mpath.path, m + (i + 0.5) / 8)
      if (!b) continue
      const t = tally[b.side]
      // Facing the way the side attacks: home towards x = 100, away towards x = 0
      const along = b.side === 'home' ? b.x : 100 - b.x
      const across = b.side === 'home' ? b.y : 100 - b.y
      if (along < 100 / 3) t.d++
      else if (along < 200 / 3) t.m++
      else t.a++
      if (across < 100 / 3) t.l++
      else if (across < 200 / 3) t.c++
      else t.r++
      t.n++
    }
  }
  const zones = (t: typeof tally.home): Zones => {
    const pct = (v: number) => (t.n ? (v / t.n) * 100 : 0)
    const even = t.n ? null : 100 / 3
    return {
      thirds: { defensive: even ?? pct(t.d), middle: even ?? pct(t.m), attacking: even ?? pct(t.a) },
      channels: { left: even ?? pct(t.l), centre: even ?? pct(t.c), right: even ?? pct(t.r) },
      samples: t.n,
    }
  }
  return { home: zones(tally.home), away: zones(tally.away) }
}
