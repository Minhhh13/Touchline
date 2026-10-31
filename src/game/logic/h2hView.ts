import { isComplete } from '@engine/draft'
import type { H2HDraft } from '@engine/h2h'

/**
 * Display helpers for the hot-seat head-to-head screen, pure. Kept out of `h2h.ts`, which an online room's verifier
 * bundles.
 */

/** Who picks first on the next spin, as `h2hSpin` decides it: the snake's first picker, or the other manager once that squad is complete. Null when both are. */
export function nextFirstPicker(h: Pick<H2HDraft, 'drafts' | 'first'>): 0 | 1 | null {
  if (!isComplete(h.drafts[h.first])) return h.first
  const other: 0 | 1 = h.first === 0 ? 1 : 0
  return isComplete(h.drafts[other]) ? null : other
}

/**
 * The turn a selection on the head-to-head pitch belongs to: the spin and the manager picking on it. Both managers pick
 * on the same spin, so a player one of them tapped (and then let the assistant pick past) never stays selected for the other.
 */
export function h2hTurnKey(h: Pick<H2HDraft, 'spins' | 'picking'> | undefined): string | null {
  return h && h.picking !== null ? `${h.spins}:${h.picking}` : null
}
