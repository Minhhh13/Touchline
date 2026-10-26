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
