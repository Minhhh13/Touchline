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

/** Every player whose name holds each word of the query, best match first: a word that starts his name, then peak rating. */
export function searchPlayers(u: LoadedUniverse, query: string, opts: { position?: Position; limit?: number } = {}): PlayerHit[] {
  const words = foldName(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 2) return []
  const byPlayer = new Map<string, PlayerSeason[]>()
  for (const p of Object.values(u.index)) {
    const list = byPlayer.get(p.playerId)
    if (list) list.push(p)
    else byPlayer.set(p.playerId, [p])
  }
  const hits: Array<PlayerHit & { rank: number }> = []
  for (const [playerId, list] of byPlayer) {
    const names = [...new Set(list.map((p) => p.name))]
    const folded = names.map(foldName)
    if (!folded.some((n) => words.every((w) => n.includes(w)))) continue
    const ordered = [...list].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    const best = ordered.reduce((m, p) => (p.overall > m.overall ? p : m), ordered[0])
    if (opts.position && best.positions[0] !== opts.position) continue
    // A word that starts a part of his name ranks first ("Kane" finds Harry Kane before Kanté)
    const starts = folded.some((n) => words.every((w) => n.split(/[\s.'-]+/).some((part) => part.startsWith(w))))
    const clubs: string[] = []
    for (const p of ordered) if (!clubs.includes(p.clubId)) clubs.push(p.clubId)
    hits.push({
      playerId,
      name: names.reduce((m, n) => (n.length > m.length ? n : m), names[0]),
      best,
      latest: ordered[ordered.length - 1],
      seasons: new Set(ordered.map((p) => p.season)).size,
      from: ordered[0].season,
      to: ordered[ordered.length - 1].season,
      clubs,
      rank: starts ? 0 : 1,
    })
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
