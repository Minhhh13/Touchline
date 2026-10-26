import { ratingsHidden, type DraftRules, type Twist } from '@engine/draft'

/**
 * Where a rating is about to be shown, for the blind-mode rule "hidden while choosing, shown once he is yours":
 * - `squad`: a player in the user's own squad (drafted into the XI or onto the bench, signed, or the head-to-head
 *   manager's own picks): the squad list, the pitch, the bench, his draft-log row, kick-off, team strength and
 *   chemistry figures, the season playback, the summary, the share card and the player card.
 * - `offer`: a player being chosen: the candidates a spin offers, the slot chips before the pick, an Icon from the end
 *   case before he is brought in. A blind twist hides these too.
 * - `market`: a player offered from outside the squad (the January window's deals and their gain in the slot).
 * - `ghost`: the challenge ghost chip of the opponent's picks while the user is still choosing.
 * - `grades`: the pick grades in the draft log, which compare each pick with the best on its spin.
 */
export type RatingPlace = 'squad' | 'offer' | 'market' | 'ghost' | 'grades'

export interface RatingContext {
  /** The twist on the spin being chosen from (a blind twist hides an offer even with ratings on). */
  twist?: Twist | null
  /** The draft is complete: nothing is being chosen any more, so the pick grades may show. */
  complete?: boolean
}

/**
 * Whether a rating is shown here. Display only: nothing in the engine or the game reads it. With ratings on (and no
 * blind twist) everything shows, as before; blind mode (`ratingsHidden`: hard difficulty or Show ratings off) hides
 * only what is still being chosen, and a player in the user's own squad always shows his real rating.
 */
export function ratingShown(rules: DraftRules, place: RatingPlace, ctx: RatingContext = {}): boolean {
  if (place === 'squad') return true
  if (place === 'grades') return !!ctx.complete
  if (ratingsHidden(rules)) return false
  return !(place === 'offer' && ctx.twist === 'blind')
}

/** The inverse, for the `hideRatings` / `hidden` props. */
export function ratingHidden(rules: DraftRules, place: RatingPlace, ctx: RatingContext = {}): boolean {
  return !ratingShown(rules, place, ctx)
}

/**
 * Whether a pick just landed in the squad with a rating the user could not see while choosing it, so the squad
 * screens play the small "revealed" moment on it (the rating flips in). Display only.
 */
export function revealsOnPick(rules: DraftRules, twist?: Twist | null): boolean {
  return !ratingShown(rules, 'offer', { twist })
}
