/**
 * Where everyone stands. Pure geometry for the pitch views: formation slots
 * adjusted by the side's instructions, mirrored for the away side, and the
 * shared coordinate system the ball and the charts use.
 *
 * Shared coordinates: x runs 0..100 along the pitch with the home side
 * attacking towards 100; y runs 0..100 across. An event's own position (from
 * the engine) is in attacking coordinates for its side, so an away shot is
 * mirrored through the centre spot.
 */
import type { Appearance } from '@engine/match'
import type { PitchPoint } from '@engine/matchDetail'
import { FORMATION_BY_ID, FORMATIONS } from '@engine/formations'
import type { FormationSlot, Position, Tactics } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import { BRAND_COLOURS } from '../brand'

export type Side = 'home' | 'away'

export interface PlacedPlayer extends Appearance {
  side: Side
  x: number
  y: number
}

export function other(side: Side): Side {
  return side === 'home' ? 'away' : 'home'
}

/** An event position (attacking coordinates for `side`) in shared coordinates. */
export function toShared(p: PitchPoint, side: Side): PitchPoint {
  return side === 'home' ? { x: p.x, y: p.y } : { x: 100 - p.x, y: 100 - p.y }
}

/**
 * A slot's resting point under the side's instructions: an attacking mentality
 * pushes the block up and a defensive one drops it; a high line lifts the
 * defenders and a deep one sits them back; width spreads or tucks the wide men.
 */
export function slotPoint(slot: FormationSlot, tactics: Tactics, side: Side): PitchPoint {
  let along = slot.y
  let across = slot.x
  if (slot.position !== 'GK') {
    along += tactics.mentality === 'attacking' ? 4 : tactics.mentality === 'defensive' ? -4 : 0
    if (slot.y < 36) along += tactics.defensiveLine === 'high' ? 7 : tactics.defensiveLine === 'deep' ? -6 : 0
    if (Math.abs(slot.x - 50) > 22) across = 50 + (slot.x - 50) * (tactics.width === 'wide' ? 1.14 : tactics.width === 'narrow' ? 0.8 : 1)
  }
  along = clamp(along, 3, 95)
  across = clamp(across, 4, 96)
  return side === 'home' ? { x: along, y: across } : { x: 100 - along, y: 100 - across }
}

/** A resting point for a man whose slot the formation does not know (a save from another version): by position. */
function fallbackPoint(position: Position, side: Side): PitchPoint {
  const along: Record<Position, number> = { GK: 6, CB: 22, LB: 26, RB: 26, DM: 42, CM: 55, AM: 66, LW: 76, RW: 76, ST: 86 }
  const across: Record<Position, number> = { GK: 50, CB: 50, LB: 15, RB: 85, DM: 50, CM: 50, AM: 50, LW: 18, RW: 82, ST: 50 }
  return side === 'home' ? { x: along[position], y: across[position] } : { x: 100 - along[position], y: 100 - across[position] }
}

/** Everyone who appeared for a side, each at his slot's resting point. */
export function placeSide(appearances: Appearance[], tactics: Tactics, side: Side): PlacedPlayer[] {
  const formation = FORMATION_BY_ID[tactics.formationId] ?? FORMATIONS[0]
  return appearances.map((a) => {
    const slot = formation.slots.find((s) => s.id === a.slotId)
    const pt = slot ? slotPoint(slot, tactics, side) : fallbackPoint(a.position, side)
    return { ...a, side, x: pt.x, y: pt.y }
  })
}

/** The men on the pitch at a minute: on by then, not yet off (a man replaced at 90 goes with the whistle), and not sent off. */
export function onPitchAt<T extends Appearance>(players: T[], minute: number): T[] {
  return players.filter((p) => p.onAt <= minute && (minute < p.offAt || (p.offAt >= 90 && !p.red && !players.some((q) => q !== p && q.slotId === p.slotId && q.onAt >= p.offAt && q.onAt <= minute))))
}

/** Two letters for a dot: first and last name initials, or the first two letters of a single name. */
export function initials(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Kit colour for a side: its primary unless that clashes with the other side's, then its secondary. */
export function kitColour(ours: { primary: string; secondary: string } | undefined, theirs: string, fallback: string): string {
  if (!ours) return fallback
  if (colourDistance(ours.primary, theirs) >= 90) return ours.primary
  if (colourDistance(ours.secondary, theirs) >= 90) return ours.secondary
  return ours.primary
}

/** Kit colours for the two sides: the user wears the host club's colours, an AI club its own; a clash falls back to the second colour. */
export function kitColours(u: LoadedUniverse, hostClubId: string, homeTeamId: string, awayTeamId: string): { home: string; away: string } {
  const clubOf = (teamId: string) => u.clubById[teamId === USER_TEAM ? hostClubId : teamId.replace(/^friendly-/, '')]
  const h = clubOf(homeTeamId)
  const a = clubOf(awayTeamId)
  // A club without colours wears the accent blue at home and near-white away (hex, as kitColour compares them)
  const home = kitColour(h?.colours, a?.colours.primary ?? BRAND_COLOURS.draw, BRAND_COLOURS.accent)
  const away = kitColour(a?.colours, home, BRAND_COLOURS.text)
  return { home, away }
}

/** A rough distance between two hex colours (0..~441). */
export function colourDistance(a: string, b: string): number {
  const pa = rgb(a)
  const pb = rgb(b)
  if (!pa || !pb) return 999
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2])
}

function rgb(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Metres per shared unit along and across a 105 by 68 pitch. */
const MX = 1.05
const MY = 0.68

/**
 * Mirrored formations put a full-back on top of the winger he faces. Push every
 * pair of opposing slots closer than `gap` metres apart (half each, across the
 * pitch when they coincide), a few passes over, and move every man who played
 * in a slot with it. Deterministic: the same shapes always give the same picture.
 */
export function separateSides(home: PlacedPlayer[], away: PlacedPlayer[], gap = 6): { home: PlacedPlayer[]; away: PlacedPlayer[] } {
  const slots = (list: PlacedPlayer[]) => {
    const m = new Map<string, PitchPoint>()
    for (const p of list) if (!m.has(p.slotId)) m.set(p.slotId, { x: p.x, y: p.y })
    return m
  }
  const hs = slots(home)
  const as = slots(away)
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const h of hs.values()) {
      for (const a of as.values()) {
        const dx = (a.x - h.x) * MX
        const dy = (a.y - h.y) * MY
        const d = Math.hypot(dx, dy)
        if (d >= gap) continue
        moved = true
        const ux = d > 0.01 ? dx / d : 0
        const uy = d > 0.01 ? dy / d : 1
        const push = (gap - d) / 2
        h.x = clamp(h.x - (ux * push) / MX, 1, 99)
        h.y = clamp(h.y - (uy * push) / MY, 2, 98)
        a.x = clamp(a.x + (ux * push) / MX, 1, 99)
        a.y = clamp(a.y + (uy * push) / MY, 2, 98)
      }
    }
    if (!moved) break
  }
  const apply = (list: PlacedPlayer[], m: Map<string, PitchPoint>) => list.map((p) => ({ ...p, ...(m.get(p.slotId) ?? { x: p.x, y: p.y }) }))
  return { home: apply(home, hs), away: apply(away, as) }
}

/** Distance in metres between two points in shared coordinates. */
export function metres(a: PitchPoint, b: PitchPoint): number {
  return Math.hypot((a.x - b.x) * MX, (a.y - b.y) * MY)
}
