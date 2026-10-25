import type { LoadedUniverse } from '@engine/universe'
import { isClassicSeason } from '@engine/universe'

/**
 * The Setup screen's era control, as plain data: which seasons the wheel may
 * land on and whether classic seasons (1992-93 to 2007-08, estimated ratings)
 * are in. Pure, so the mapping is tested and the screen decides nothing.
 */

export type Era = 'all' | 'classic' | 'early' | 'mid' | 'modern' | 'custom'

/** The part of `DraftRules` an era sets. `classic` is only ever present as `true`, so a standard era adds no key at all. */
export interface EraRules {
  fromSeason?: number
  toSeason?: number
  classic?: true
}

export interface EraChoice {
  era: Era
  /** The custom range's two ends, in either order. */
  from: number
  to: number
  /** "All eras" plus classic seasons. Ignored by every other era. */
  includeClassic: boolean
  isDaily: boolean
  /** The wheel's leagues: classic seasons only count when one of them has some. */
  leagues: string[]
}

/** The first classic season among the wheel's leagues, when one of them has classic seasons loaded. */
export function classicFromFor(u: LoadedUniverse, leagues: string[]): number | undefined {
  const seasons = u.clubSeasons.filter((cs) => cs.classic && leagues.includes(cs.leagueId)).map((cs) => cs.season)
  return seasons.length ? Math.min(...seasons) : undefined
}

/** The wheel's season bounds and classic opt-in for an era choice; the Daily has none and is never classic. */
export function eraRules(u: LoadedUniverse, c: EraChoice): EraRules {
  if (c.isDaily) return {}
  const classicFrom = classicFromFor(u, c.leagues)
  switch (c.era) {
    case 'classic':
      return classicFrom === undefined ? {} : { fromSeason: classicFrom, toSeason: u.firstSeason - 1, classic: true }
    case 'early':
      return { fromSeason: u.firstSeason, toSeason: 2013 }
    case 'mid':
      return { fromSeason: 2014, toSeason: 2019 }
    case 'modern':
      return { fromSeason: 2020 }
    case 'custom': {
      const lo = Math.min(c.from, c.to)
      const hi = Math.max(c.from, c.to)
      // Any range that starts before the first standard season reaches into the classic ones
      return lo < u.firstSeason && classicFrom !== undefined ? { fromSeason: Math.max(lo, classicFrom), toSeason: hi, classic: true } : { fromSeason: Math.max(lo, u.firstSeason), toSeason: Math.max(hi, u.firstSeason) }
    }
    default:
      return c.includeClassic && classicFrom !== undefined ? { classic: true } : {}
  }
}

/** The seasons the custom range can name: classic ones too when a wheel league has them. */
export function eraSeasons(u: LoadedUniverse, leagues: string[]): number[] {
  const from = classicFromFor(u, leagues) ?? u.firstSeason
  return Array.from({ length: u.lastSeason - from + 1 }, (_, i) => from + i)
}

/** The league seasons a side can play in, oldest first, classic ones flagged (they use estimated ratings). */
export function leagueSeasonChoices(u: LoadedUniverse, leagueId: string): Array<{ season: number; classic: boolean }> {
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort((a, b) => a - b)
  return seasons.map((season) => ({ season, classic: isClassicSeason(u, leagueId, season) }))
}

/**
 * Whether a player-season's rating is TouchLine's estimate (a classic season)
 * rather than an EA one. Works for an id that is not in the universe too (a
 * developed copy in `customPlayers` keeps the `${playerId}@${season}@${clubId}` shape).
 */
export function isEstimated(u: LoadedUniverse, playerSeasonId: string): boolean {
  const p = u.index[playerSeasonId]
  if (p) return !!u.clubSeasonByKey[`${p.clubId}@${p.season}`]?.estimated
  const [, season, clubId] = playerSeasonId.split('@')
  return !!season && !!clubId && !!u.clubSeasonByKey[`${clubId}@${season}`]?.estimated
}

/**
 * The "estimated ratings" note for a result's share text and card, or null
 * when nothing in it is estimated: picks counts the XI's estimated players,
 * and a classic league season means every rival's rating is estimated too.
 */
export function estimatedNote(u: LoadedUniverse, xi: string[], leagueId: string, leagueSeason: number): string | null {
  const picks = xi.filter((id) => isEstimated(u, id)).length
  const league = u.clubSeasons.some((cs) => cs.estimated && cs.leagueId === leagueId && cs.season === leagueSeason)
  if (!picks && !league) return null
  const parts: string[] = []
  if (picks) parts.push(`${picks} classic pick${picks === 1 ? '' : 's'}`)
  if (league) parts.push('a classic league season')
  return `Estimated ratings: ${parts.join(', ')}`
}
