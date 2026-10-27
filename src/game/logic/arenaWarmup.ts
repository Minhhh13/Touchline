/**
 * The arena's first team-strength pass, done ahead of time. The first `beginArena` of a run (the Draft's "On to the
 * draw", "Onto the ladder", "On to the final") ranks the whole field pool by `teamStrengthOf`: about 0.5 ms a
 * club-season, so 1.3 s for the 2,526 club-seasons of a giants, champions or European field and 0.2 s for one league,
 * all at once on the click. `teamStrengthOf` is pure and memoised per universe (`src/engine/knockout.ts`), so working
 * the same values out earlier, a slice at a time while the player drafts, gives `beginArena` exactly the numbers it
 * would have computed and moves no field, ladder, bracket or draw (`arenaWarmup.test.ts`). No RNG, no clock: the
 * caller (the UI's idle slices) says when a slice is over. Kept out of `arena.ts`, whose text the edge verifier bundles.
 */
import { arenaPool, teamStrengthOf } from '@engine/knockout'
import type { LoadedUniverse } from '@engine/universe'
import type { ClubSeason } from '@engine/types'
import type { Game } from '../types'
import { fieldLeagues } from './arena'

/** Whether a game is an arena run whose first field pass is still to come (its ladder, bracket or opponent not drawn). */
export function arenaNeedsWarmup(game: Pick<Game, 'settings' | 'arena'>): boolean {
  const a = game.arena
  return game.settings.mode === 'arena' && !!a && a.step === 0 && !a.over && !a.next && !a.ladder && !a.bracket
}

/** The pool `beginArena` ranks (the Cup's decade field narrows it further, so this is never smaller); empty when no pass is due. */
export function arenaWarmPool(game: Pick<Game, 'settings' | 'arena'>, u: LoadedUniverse): ClubSeason[] {
  if (!arenaNeedsWarmup(game)) return []
  const r = game.settings.rules
  return arenaPool(u, { leagues: fieldLeagues(game, u), fromSeason: r.fromSeason, toSeason: r.toSeason })
}

/**
 * On the arena's setup, before any run exists: every club-season of the loaded leagues any field could rank, a superset
 * of a run's pool (every era, every field), so the warm-up can start before the draft does.
 */
export function arenaSetupPool(u: LoadedUniverse, leagues: string[]): ClubSeason[] {
  return arenaPool(u, { leagues })
}

/**
 * Work out the strengths of `pool[from]` onwards while `more()` says there is time (at least one each call), and
 * return the index to carry on from; `pool.length` when done.
 */
export function warmStrengths(u: LoadedUniverse, pool: ClubSeason[], from: number, more: () => boolean): number {
  let i = from
  while (i < pool.length) {
    teamStrengthOf(u, pool[i])
    i++
    if (!more()) break
  }
  return i
}
