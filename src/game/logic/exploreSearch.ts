import type { PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'

/**
 * Explore's database search and its Highest rated list (display only, pure, no RNG): one row per real player,
 * matched without accents or case, and the best player-seasons with one row per player on request.
 */

/** Lower case with the accents dropped: "Guéhi" and "guehi" match, "Ødegaard" reads "odegaard". */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
}

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

/** One real player of the loaded data: his seasons oldest first, his names as typed and folded, his career. */
export interface PlayerEntry {
  playerId: string
  seasons: PlayerSeason[]
  /** The fullest spelling of his name (of two the same length, the earlier season's). */
  name: string
  folded: string[]
  /** Each folded name cut into its parts, for the "starts a part of his name" rank. */
  parts: string[][]
  from: number
  to: number
  seasonCount: number
  /** Every club he played for, in the order he first did. */
  clubs: string[]
}

const indexCache = new WeakMap<LoadedUniverse, PlayerEntry[]>()

/** One entry per real player, his seasons oldest first, by player id; built once per universe (the search and the filter share it). */
export function playerIndex(u: LoadedUniverse): PlayerEntry[] {
  const hit = indexCache.get(u)
  if (hit) return hit
  const by = new Map<string, PlayerSeason[]>()
  for (const p of Object.values(u.index)) {
    const list = by.get(p.playerId)
    if (list) list.push(p)
    else by.set(p.playerId, [p])
  }
  const out: PlayerEntry[] = []
  for (const [playerId, list] of by) {
    const seasons = [...list].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    const names = [...new Set(seasons.map((p) => p.name))]
    const folded = names.map(foldName)
    const clubs: string[] = []
    for (const p of seasons) if (!clubs.includes(p.clubId)) clubs.push(p.clubId)
    out.push({
      playerId,
      seasons,
      name: names.reduce((m, n) => (n.length > m.length ? n : m), names[0]),
      folded,
      parts: folded.map((n) => n.split(/[\s.'-]+/)),
      from: seasons[0].season,
      to: seasons[seasons.length - 1].season,
      seasonCount: new Set(seasons.map((p) => p.season)).size,
      clubs,
    })
  }
  out.sort((a, b) => a.playerId.localeCompare(b.playerId))
  indexCache.set(u, out)
  return out
}

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
  const all = Object.values(u.index).filter((p) => (!opts.position || p.positions[0] === opts.position) && (opts.season === undefined || p.season === opts.season) && u.clubById[p.clubId]?.leagueId === opts.leagueId)
  // Best first; equals by the earlier season, then the id, so the order never depends on the index's order
  all.sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id))
  const out: PlayerSeason[] = []
  const seen = new Set<string>()
  for (const p of all) {
    if (opts.onePerPlayer) {
      if (seen.has(p.playerId)) continue
      seen.add(p.playerId)
    }
    out.push(p)
    if (out.length >= (opts.limit ?? 60)) break
  }
  return out
}
