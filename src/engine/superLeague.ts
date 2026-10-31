/**
 * The Super League: a Quick Draft's XI plays a double round-robin against the nineteen greatest club-seasons in the
 * data, across every loaded league and era. "Greatest" is the engine's own measure: each club-season's real squad as
 * an AI side (`aiClubOf`), its auto-picked best XI rated by `computeTeamStrength` (`aiStrength`). Each club enters once,
 * with its best season, so the field is nineteen different clubs. Classic seasons (1992-93 to 2007-08) count only
 * with the Classic opt-in.
 *
 * The field is a pure function of the loaded universe and the classic flag: no seed, no RNG, the same nineteen for
 * everyone. Ties in strength go to the earlier season, then the club id, so the order never depends on pack order.
 */
import type { ClubSeason } from './types'
import { aiClubOf, aiStrength, type AiClub } from './season'
import { poolClubSeasons, seasonLabel, type LoadedUniverse } from './universe'

/** Sides in the Super League besides the user's. */
export const SUPER_LEAGUE_RIVALS = 19
/** The name the league is shown under. */
export const SUPER_LEAGUE_NAME = 'Super League'
/** The pseudo league id the screens use for the Super League's flag and name; never a real league's id. */
export const SUPER_LEAGUE_ID = 'super'

/**
 * The rating points every Super League rival plays below its real strength when the game's rules carry `superEase`
 * (subtracted from each line like the calibration's offset, `withOffset` in match.ts). Measured over 250 seeds on the
 * data of 2026-10-25 (docs/GAME_DESIGN.md, the Super League's "How hard"): about six points more for the same strong XI,
 * the elite XI's titles from 62% to 84%, still no 38-0.
 */
export const SUPER_LEAGUE_HANDICAP = 1

/** A club-season ranked by the Super League's strength measure. */
export interface RankedClubSeason {
  cs: ClubSeason
  strength: number
}

const cache = new WeakMap<LoadedUniverse, Map<boolean, RankedClubSeason[]>>()

/**
 * Every club's best season by team strength, strongest first, one row per club (the pool `poolClubSeasons` gives:
 * classic seasons only with `classic`). Cached per universe and flag. Pure.
 */
export function rankedClubs(u: LoadedUniverse, classic: boolean | undefined): RankedClubSeason[] {
  const key = !!classic
  let byFlag = cache.get(u)
  if (!byFlag) cache.set(u, (byFlag = new Map()))
  const hit = byFlag.get(key)
  if (hit) return hit
  const best = new Map<string, RankedClubSeason>()
  for (const cs of poolClubSeasons(u, key)) {
    if (cs.squad.length < 11) continue
    const strength = aiStrength(u, aiClubOf(u, cs))
    const have = best.get(cs.clubId)
    if (!have || strength > have.strength || (strength === have.strength && cs.season < have.cs.season)) best.set(cs.clubId, { cs, strength })
  }
  const ranked = [...best.values()].sort((a, b) => b.strength - a.strength || a.cs.season - b.cs.season || (a.cs.clubId < b.cs.clubId ? -1 : a.cs.clubId > b.cs.clubId ? 1 : 0))
  byFlag.set(key, ranked)
  return ranked
}

/** The nineteen club-seasons of the Super League, strongest first. Pure. */
export function superLeagueField(u: LoadedUniverse, classic: boolean | undefined): ClubSeason[] {
  return rankedClubs(u, classic)
    .slice(0, SUPER_LEAGUE_RIVALS)
    .map((r) => r.cs)
}

/** The Super League's AI sides, keyed by club id (one season per club, so the id is unique), strongest first. */
export function buildSuperClubs(u: LoadedUniverse, classic: boolean | undefined, taken?: ReadonlySet<string>): Record<string, AiClub> {
  const ai: Record<string, AiClub> = {}
  // Named with the season it enters with, so the match feed and the highlights say "Barcelona 2010-11" too. The field
  // is chosen on full squads; the user's humans then leave them (`taken`, engine 6)
  for (const cs of superLeagueField(u, classic)) ai[cs.clubId] = { ...aiClubOf(u, cs, taken), name: superSideName(u.clubById[cs.clubId]?.name ?? cs.clubId, cs.season) }
  return ai
}

/**
 * The Super League's Continental Cup field: the next strongest clubs after the league's nineteen, one season each,
 * so the post-season run meets the best of the rest. Pure.
 */
export function buildSuperRestClubs(u: LoadedUniverse, classic: boolean | undefined, n: number, taken?: ReadonlySet<string>): Record<string, AiClub> {
  const ai: Record<string, AiClub> = {}
  for (const r of rankedClubs(u, classic).slice(SUPER_LEAGUE_RIVALS, SUPER_LEAGUE_RIVALS + n)) ai[r.cs.clubId] = { ...aiClubOf(u, r.cs, taken), name: superSideName(u.clubById[r.cs.clubId]?.name ?? r.cs.clubId, r.cs.season) }
  return ai
}

/** Club id to the season it enters with, for both Super League fields (the league and the rest). Pure. */
export function superSeasons(u: LoadedUniverse, classic: boolean | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rankedClubs(u, classic)) out[r.cs.clubId] = r.cs.season
  return out
}

/** "Barcelona 2010-11": a Super League side named with its season. */
export function superSideName(name: string, season: number | undefined): string {
  return season === undefined ? name : `${name} ${seasonLabel(season)}`
}
