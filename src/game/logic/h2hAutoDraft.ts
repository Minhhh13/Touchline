import { h2hAutoPick, h2hComplete, h2hSpin, type H2HDraft } from '@engine/h2h'
import { Rng, type RngState } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'

/** More steps than any head-to-head draft takes (two squads of at most 22, a spin per two picks): a guard, never reached. */
const AUTO_STEP_CAP = 400

/**
 * The hot-seat's Auto-complete (playtest round 2, P8): the rest of the draft as the assistant would make it, one step at
 * a time exactly as the buttons do it: Spin (`h2hSpin`, on the game's stream) when no spin is on the wheel, then "Let
 * the assistant pick" (`h2hAutoPick`, no draw) for whoever picks, until both squads are complete. The draws are those of
 * pressing the two buttons in turn; nothing is drawn that they would not draw. Mutates `h` in place (an Immer draft
 * from the store) and writes the stream back; returns the assistant's picks made. Kept out of `h2h.ts`, which the edge
 * verifier bundles.
 */
export function h2hAutoComplete(u: LoadedUniverse, h: { draft: H2HDraft; rngState: RngState }): number {
  const rng = Rng.fromState(h.rngState)
  let picks = 0
  for (let step = 0; step < AUTO_STEP_CAP && !h2hComplete(h.draft); step++) {
    if (h.draft.picking === null) {
      h2hSpin(u, h.draft, rng)
      continue
    }
    const before = h.draft.log.length
    h2hAutoPick(u, h.draft)
    // The assistant found no pick (a spin `skipIfStuck` should have passed): stop rather than spin past it
    if (h.draft.log.length === before) break
    picks++
  }
  h.rngState = rng.getState()
  return picks
}
