import type { PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { byRating, foldName, playerIndex } from './exploreIndex'

/**
 * Explore's database search and its Highest rated list (display only, pure, no RNG): one row per real player,
 * matched without accents or case, and the best player-seasons with one row per player on request.
 */

export { foldName } from './exploreIndex'

/** One real player in the search: his best season, his latest, and the span and clubs of his database career. */
export interface PlayerHit {
  playerId: string
  /** The fullest spelling of his name across his seasons ("Erling Haaland" over "E. Haaland"). */
  name: string
  /** His highest-rated season (the earliest of equals). */
  best: PlayerSeason
  latest: PlayerSeason
  /** Distinct seasons in the database. */
  seasons: number
  from: number
  to: number
  /** Every club he played for, in the order he first did. */
  clubs: string[]
}

export const SEARCH_LIMIT = 100

/** Every player whose name holds each word of the query, best match first: a word that starts his name, then peak rating. */
export function searchPlayers(u: LoadedUniverse, query: string, opts: { position?: Position; limit?: number } = {}): PlayerHit[] {
  const words = foldName(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 2) return []
  const hits: Array<PlayerHit & { rank: number }> = []
  // The cached index, not a fresh pass over every player-season on each keystroke
  for (const e of playerIndex(u)) {
    if (!e.folded.some((n) => words.every((w) => n.includes(w)))) continue
    const best = e.seasons.reduce((m, p) => (p.overall > m.overall ? p : m), e.seasons[0])
    if (opts.position && best.positions[0] !== opts.position) continue
    // A word that starts a part of his name ranks first ("Kane" finds Harry Kane before Kanté)
    const starts = e.parts.some((parts) => words.every((w) => parts.some((part) => part.startsWith(w))))
    hits.push({ playerId: e.playerId, name: e.name, best, latest: e.seasons[e.seasons.length - 1], seasons: e.seasonCount, from: e.from, to: e.to, clubs: [...e.clubs], rank: starts ? 0 : 1 })
  }
  hits.sort((a, b) => a.rank - b.rank || b.best.overall - a.best.overall || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
  return hits.slice(0, opts.limit ?? SEARCH_LIMIT).map(({ rank: _rank, ...hit }) => hit)
}

/**
 * The highest-rated player-seasons of a league, best first: every season, or each player's best season only
 * (`onePerPlayer`), optionally one position (his first) and one season.
 */
export function topPlayerSeasons(u: LoadedUniverse, opts: { leagueId: string; position?: Position; onePerPlayer?: boolean; season?: number; limit?: number }): PlayerSeason[] {
  // The cached best-first list, read until the limit fills: equals by the earlier season, then the id
  const all = byRating(u)
  const out: PlayerSeason[] = []
  const seen = new Set<string>()
  for (const p of all) {
    if ((opts.position && p.positions[0] !== opts.position) || (opts.season !== undefined && p.season !== opts.season) || u.clubById[p.clubId]?.leagueId !== opts.leagueId) continue
    if (opts.onePerPlayer) {
      if (seen.has(p.playerId)) continue
      seen.add(p.playerId)
    }
    out.push(p)
    if (out.length >= (opts.limit ?? 60)) break
  }
  return out
}
