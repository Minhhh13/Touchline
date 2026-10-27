import type { LiveChanges } from '@engine/match'
import type { Game } from '../types'

/**
 * The changes at a live match's stop with every substitution that would bring on an injured or suspended man left out.
 * The engine's stop (`advanceMatch`) takes any bench man it is handed, and the dashboard's bench (`benchAt`) already
 * hides the unavailable, so this keeps the store's actions honest for every caller (a stale screen, a test). Pure:
 * returns the same object when nothing is left out, so a stop with fit substitutes plays exactly as before.
 */
export function availableStopChanges<T extends LiveChanges | undefined>(game: Pick<Game, 'squad'>, changes: T): T {
  const subs = changes?.substitutions
  if (!changes || !subs?.length) return changes
  const fit = subs.filter((s) => {
    const st = game.squad[s.on]
    return !st?.injury && (st?.suspension ?? 0) <= 0
  })
  return fit.length === subs.length ? changes : { ...changes, substitutions: fit }
}
