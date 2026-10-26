import type { LoadedUniverse } from '@engine/universe'
import { isClassicSeason } from '@engine/universe'
import type { LeagueInfo } from '@engine/types'

/**
 * Classic seasons (1992-93 to 2007-08, estimated ratings) for the screens: where
 * they start, which league seasons are classic, and whether a player-season is
 * estimated. The Setup's Classic toggle becomes `DraftRules.classic` through
 * `setupRules` (`setup.ts`). Pure, so the screens decide nothing.
 */

/**
 * Whether a game needs the classic seasons in the universe to be shown or played: only one that opted in can hold a
 * classic pick, play a classic league season or take a classic job (every other pool leaves them out), and the store
 * loads the classic packs on demand for exactly these (`packs.ts`).
 */
export function needsClassic(game: { settings: { rules: { classic?: boolean } } }): boolean {
  return !!game.settings.rules.classic
}

/** The first classic season among the wheel's leagues by the data index, loaded or not (the Classic toggle shows before its pack loads). */
export function classicFromIndex(available: LeagueInfo[], leagues: string[]): number | undefined {
  const seasons = available.filter((l) => leagues.includes(l.id) && l.classicFrom !== undefined).map((l) => l.classicFrom!)
  return seasons.length ? Math.min(...seasons) : undefined
}

/** The first classic season among the wheel's leagues, when one of them has classic seasons loaded. */
export function classicFromFor(u: LoadedUniverse, leagues: string[]): number | undefined {
  const seasons = u.clubSeasons.filter((cs) => cs.classic && leagues.includes(cs.leagueId)).map((cs) => cs.season)
  return seasons.length ? Math.min(...seasons) : undefined
}

/** The first season a rule set's era starts at, for labels: its `fromSeason`, else the first season the wheel holds (a classic one with the opt-in). */
export function eraFirstSeason(u: LoadedUniverse, r: { fromSeason?: number; classic?: boolean }): number {
  return r.fromSeason ?? (r.classic ? u.classicFirstSeason ?? u.firstSeason : u.firstSeason)
}

/** The league seasons a side can play in, oldest first, classic ones flagged (they use estimated ratings). */
export function leagueSeasonChoices(u: LoadedUniverse, leagueId: string): Array<{ season: number; classic: boolean }> {
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort((a, b) => a - b)
  return seasons.map((season) => ({ season, classic: isClassicSeason(u, leagueId, season) }))
}

/** A player-season to check: its id, or the player-season itself (a copy in `customPlayers` keeps the `clubId` and `season` it came from). */
export type EstimatedRef = string | { clubId: string; season: number }

/**
 * Whether a player-season's rating is TouchLine's estimate (a classic season)
 * rather than an EA one. Pass the player-season itself where it is at hand:
 * a dynasty's aged copy (`${playerId}@dyn${year}`) is not in the universe and
 * its id names no season, but it keeps the club-season it was drafted from.
 * A bare id not in the universe is read from its `${playerId}@${season}@${clubId}` shape.
 */
export function isEstimated(u: LoadedUniverse, ref: EstimatedRef): boolean {
  if (typeof ref !== 'string') return !!u.clubSeasonByKey[`${ref.clubId}@${ref.season}`]?.estimated
  const p = u.index[ref]
  if (p) return !!u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.estimated
  const [, season, clubId] = ref.split('@')
  return !!season && !!clubId && !!u.clubSeasonByKey[`${clubId}@${season}`]?.estimated
}

/**
 * The "estimated ratings" note for a result's share text and card, or null
 * when nothing in it is estimated: picks counts the XI's estimated players,
 * and a classic league season means every rival's rating is estimated too.
 */
export function estimatedNote(u: LoadedUniverse, xi: EstimatedRef[], leagueId: string, leagueSeason: number): string | null {
  const picks = xi.filter((ref) => isEstimated(u, ref)).length
  const league = u.clubSeasons.some((cs) => cs.estimated && cs.leagueId === leagueId && cs.season === leagueSeason)
  if (!picks && !league) return null
  const parts: string[] = []
  if (picks) parts.push(`${picks} classic pick${picks === 1 ? '' : 's'}`)
  if (league) parts.push('a classic league season')
  return `Estimated ratings: ${parts.join(', ')}`
}
