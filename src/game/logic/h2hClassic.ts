import { poolClubSeasons, isClassicSeason, type LoadedUniverse } from '@engine/universe'
import type { DraftRules } from '@engine/draft'
import { h2hRules } from './h2h'
export { h2hNeedsClassic } from './h2hNeedsClassic'

/**
 * Classic seasons (1992-93 to 2007-08, estimated ratings) in a hot-seat head-to-head: opt-in, as in Setup. Kept out of
 * `h2h.ts`, which an online room's verifier bundles: rooms stay classic-off (the server's universe never loads the
 * classic pack). Pure.
 */

/** A hot-seat's draft rules: `h2hRules`, plus `classic: true` only with the opt-in, so a classic-off draft's rules are the same object shape as before. */
export function h2hRulesFor(wheelLeagues: string[], hardMode: boolean, classic: boolean): DraftRules {
  const rules = h2hRules(wheelLeagues, hardMode)
  return classic ? { ...rules, classic: true } : rules
}

/** The league seasons a head-to-head can be played in, oldest first, classic ones (flagged) only with the opt-in. */
export function h2hSeasonChoices(u: LoadedUniverse, leagueId: string, classic: boolean): Array<{ season: number; classic: boolean }> {
  const seasons = [...new Set(poolClubSeasons(u, classic).filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort((a, b) => a - b)
  return seasons.map((season) => ({ season, classic: classic && isClassicSeason(u, leagueId, season) }))
}
