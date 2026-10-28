import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'

/**
 * Explore's indexes over the loaded player-seasons (display only, pure, no RNG): built once per universe and kept in
 * WeakMaps, so a search, a career or a top list never walks all 78,000 player-seasons twice. The store builds a new
 * universe whenever a league or the classic pack loads, which drops these with it.
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

/** One real player: his seasons oldest first, his names folded for search, the span and clubs of his career. */
export interface PlayerEntry {
  playerId: string
  seasons: PlayerSeason[]
  /** The fullest spelling of his name ("Erling Haaland" over "E. Haaland"). */
  name: string
  folded: string[]
  parts: string[][]
  from: number
  to: number
  seasonCount: number
  /** Every club he played for, in the order he first did. */
  clubs: string[]
}

interface Built {
  list: PlayerEntry[]
  byId: Map<string, PlayerEntry>
}

const indexCache = new WeakMap<LoadedUniverse, Built>()

function built(u: LoadedUniverse): Built {
  const hit = indexCache.get(u)
  if (hit) return hit
  const by = new Map<string, PlayerSeason[]>()
  for (const p of Object.values(u.index)) {
    const list = by.get(p.playerId)
    if (list) list.push(p)
    else by.set(p.playerId, [p])
  }
  const list: PlayerEntry[] = []
  for (const [playerId, raw] of by) {
    const seasons = [...raw].sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    const names = [...new Set(seasons.map((p) => p.name))]
    const folded = names.map(foldName)
    const clubs: string[] = []
    for (const p of seasons) if (!clubs.includes(p.clubId)) clubs.push(p.clubId)
    list.push({
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
  list.sort((a, b) => a.playerId.localeCompare(b.playerId))
  const out = { list, byId: new Map(list.map((e) => [e.playerId, e])) }
  indexCache.set(u, out)
  return out
}

/** One entry per real player, by player id; built once per universe. */
export function playerIndex(u: LoadedUniverse): PlayerEntry[] {
  return built(u).list
}

/** One real player's entry, or undefined when no loaded league holds him. */
export function playerEntry(u: LoadedUniverse, playerId: string): PlayerEntry | undefined {
  return built(u).byId.get(playerId)
}

const ratedCache = new WeakMap<LoadedUniverse, PlayerSeason[]>()

/** Every loaded player-season, best first; equals by the earlier season, then the id, so the order never depends on the packs' order. */
export function byRating(u: LoadedUniverse): PlayerSeason[] {
  const hit = ratedCache.get(u)
  if (hit) return hit
  const all = Object.values(u.index).sort((a, b) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id))
  ratedCache.set(u, all)
  return all
}

/** Builds the indexes ahead of need (Explore calls it in an idle moment); a second call per universe is free. */
export function warmExplore(u: LoadedUniverse): void {
  playerIndex(u)
  byRating(u)
}
