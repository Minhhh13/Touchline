/**
 * Whether the Gauntlet's lifeline would change anything now. `buildLadder` (`src/engine/gauntlet.ts`) draws each
 * rung's alternate from the club-seasons the ladder has not used; a small pool (one league, one season) runs out of
 * them by rung 6, and the alternate is then any club-season of the band, the rung's own main among them (docs/QA.md
 * round 3, R8-O1). Changing the draw to the same side would spend the lifeline for nothing, so the store refuses it
 * and the Arena screen keeps the button off. Pure, no draws; kept out of `arena.ts`, which the verifier bundles.
 */
import type { ArenaState } from '../types'

export function lifelineChanges(a: Pick<ArenaState, 'ladder' | 'step'>): boolean {
  const rung = a.step + 1
  const main = a.ladder?.mains[rung - 1]
  const alternate = a.ladder?.alternates[rung - 1]
  return !!main && !!alternate && main !== alternate
}

/** The store's and the screen's words when it would not. */
export const LIFELINE_SAME_NOTE = 'The other draw for this rung is the same side: keep the lifeline for a later rung.'
