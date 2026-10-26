/**
 * The one rating scheme every slot picker and the pitch use (docs/DESIGN_SYSTEM.md, "Ratings: overall and in a slot"):
 * - **overall**: the player's rating (cards, rows, lists), the same whichever slot he takes;
 * - **in a slot**: that overall less the out-of-position cost (`discRating`, the number on his pitch disc), the headline
 *   of the Draft's slot chips, the Dugout's slot sheet and the end case's Icon chips;
 * - **attributes for a position** (`ratingAt`): TouchLine's own weighting of his attributes there, which orders those
 *   lists, and is always named as such ("Attributes for RW: 75").
 * Display only, pure. Kept out of `slotSheet.ts` and `endCase.ts` so the edge verifier's bundle never moves.
 */
import { ratingAt } from '@engine/positions'
import type { PlayerSeason, Position } from '@engine/types'
import { discRating } from './slotSheet'

export interface SlotRating {
  /** The pitch disc's number there. */
  inSlot: number
  overall: number
  /** Overall minus the in-slot number: 0 in his natural position. */
  cost: number
  /** Math.round(ratingAt) there. */
  attributes: number
}

export function slotRating(p: Pick<PlayerSeason, 'overall' | 'positions' | 'attributes'>, position: Position): SlotRating {
  const inSlot = discRating(p, position)
  return { inSlot, overall: p.overall, cost: Math.max(0, p.overall - inSlot), attributes: Math.round(ratingAt(p, position)) }
}

/** The cost as a chip prints it: "−5 out of position", or "natural position". */
export function costLabel(r: Pick<SlotRating, 'cost'>): string {
  return r.cost > 0 ? `−${r.cost} out of position` : 'natural position'
}

/** The whole line, for a tooltip or a screen reader: "84 at RW (89 overall, −5 out of position)". */
export function slotRatingLine(r: SlotRating, at: string, opts: { attributes?: boolean } = {}): string {
  const head = r.cost > 0 ? `${r.inSlot} at ${at} (${r.overall} overall, ${costLabel(r)})` : `${r.inSlot} at ${at} (his overall, natural position)`
  return opts.attributes ? `${head}. Attributes for ${at}: ${r.attributes}` : head
}
