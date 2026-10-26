import type { Game } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { quickCupProblem, type QuickCupComp } from './quickCups'

/**
 * The leagues to load before a quick season's post-season cup can be skipped. The Continental Cup's field comes from
 * every other league, and the summary offers it (`quickCupStatus` reads it as open) before they are loaded, because
 * Play loads them first; Skip has to do the same or it only answers with the field's problem. Empty when the cup can
 * be settled as it is. Pure.
 */
export function leaguesBeforeSkip(game: Game, u: LoadedUniverse, comp: QuickCupComp): string[] {
  if (comp !== 'continental' || !quickCupProblem(game, u, comp)) return []
  const missing = u.available.some((l) => !u.leagues.some((x) => x.id === l.id))
  return missing ? u.available.map((l) => l.id) : []
}
