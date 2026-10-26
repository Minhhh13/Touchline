/**
 * The quick summary's one main call. With a post-season cup still to play, the main call is that cup's Play button
 * (the Cup before the Continental Cup, in the order the cards stand); once neither is open it is Copy result. Every
 * other call is secondary, so the screen never shows three bright buttons at once. Pure, display only.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '../types'
import { quickCupStatus, type QuickCupComp } from './quickCups'
import { isSuperLeague } from './superLeague'

export type SummaryCall = QuickCupComp | 'copy'

export function summaryMainCall(game: Game, u: LoadedUniverse): SummaryCall {
  if (!game.quickResult) return 'copy'
  // The Super League has no domestic cup card
  if (!isSuperLeague(game.settings) && quickCupStatus(game, u, 'cup').state === 'open') return 'cup'
  if (quickCupStatus(game, u, 'continental').state === 'open') return 'continental'
  return 'copy'
}

/**
 * Pass on a post-season cup that is on offer. `skipQuickCup` refuses the Continental Cup while the other leagues are
 * not loaded (its field is short only for want of loading, which `quickCupStatus` still reads as open), so its Skip it
 * did nothing but say "Too few clubs from the other leagues are loaded". Passing needs no field: any cup the summary
 * offers (`open`) can be passed, as skipping stores it (null). Returns false, changing nothing, otherwise.
 */
export function passQuickCup(game: Game, u: LoadedUniverse, comp: QuickCupComp): boolean {
  const q = game.quickResult
  if (!q || quickCupStatus(game, u, comp).state !== 'open') return false
  if (comp === 'cup') q.cup = null
  else q.continentalCup = null
  return true
}
