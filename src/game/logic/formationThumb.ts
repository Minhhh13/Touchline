/**
 * The mini pitch drawn on every formation tile: the eleven slots of a shape
 * placed from the formation's own slot coordinates, standing up with the
 * player's goal at the bottom. Pure and RNG-free: the same formation always
 * gives the same picture, so the tiles and the full pitch can never disagree.
 */
import type { Formation, Position, PositionGroup } from '@engine/types'
import { groupOf } from '@engine/positions'

/** The tile pitch's viewBox, in the proportions of a real pitch (about 68 by 105). */
export const THUMB_W = 60
export const THUMB_H = 88
/** Inset from the touchlines and goal lines, so a dot on x 0 or y 100 still sits on the grass. */
export const THUMB_PAD = 6
/** Dot radius; two dots never overlap in any of the eight shapes (tested). */
export const THUMB_DOT_R = 3.4

export interface ThumbDot {
  slotId: string
  position: Position
  /** The slot's position group, which is what the draft fills it with (a 4-4-2's wide men are wingers). */
  group: PositionGroup
  cx: number
  cy: number
}

/** Slot x (0..100 across) and y (0..100 from own goal) mapped into the viewBox, attack pointing up. */
export function formationThumb(formation: Formation): ThumbDot[] {
  const w = THUMB_W - THUMB_PAD * 2
  const h = THUMB_H - THUMB_PAD * 2
  return formation.slots.map((s) => ({
    slotId: s.id,
    position: s.position,
    group: groupOf(s.position),
    cx: round(THUMB_PAD + (s.x / 100) * w),
    cy: round(THUMB_H - THUMB_PAD - (s.y / 100) * h),
  }))
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}
