import type { PlayerSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { isEstimated } from './era'
import { playerEntry, playerIndex } from './exploreIndex'

/**
 * Explore's Records view (display only, pure, no RNG; no simulation path imports it): trivia derived from the data
 * TouchLine ships, not official records. Clubs' biggest climbs and falls between two seasons in a row, the longest
 * runs of titles, the longest-serving players at one club, the players with the most titles, the biggest jumps in
 * rating from one season to the next, and the youngest and oldest highly rated seasons. Every list is ordered by
 * data alone (equals by season, then id), and the whole set is cached per universe and league.
 */

/** How much data a league's trivia covers. */
export interface TriviaCoverage {
  seasons: number
  from: number
  to: number
  /** Seasons with a complete final table (the club lists need one). */
  withTable: number
  playerSeasons: number
  /** Classic seasons in the span: their ratings are TouchLine's estimates. */
  estimatedSeasons: number
}

/** A club's change of league position between two seasons in a row. */
export interface ClubMove {
  clubId: string
  /** The later season. */
  season: number
  before: number
  after: number
  /** Places climbed (negative for a fall). */
  change: number
  estimated: boolean
}

/** A run of titles in seasons in a row. */
export interface TitleStreak {
  clubId: string
  from: number
  to: number
  length: number
  estimated: boolean
}

/** A player's seasons at one club. */
export interface ServiceLine {
  playerId: string
  name: string
  clubId: string
  seasons: number
  from: number
  to: number
  estimated: boolean
}

/** A player's league titles in the data. */
export interface TitleHaul {
  playerId: string
  name: string
  titles: number
  /** The clubs he won them with, first title first. */
  clubs: string[]
  estimated: boolean
}

/** A player's biggest jump in rating between two seasons in a row. */
export interface RatingClimb {
  playerId: string
  name: string
  before: PlayerSeason
  after: PlayerSeason
  change: number
  estimated: boolean
}

export interface LeagueTrivia {
  coverage: TriviaCoverage
  climbs: ClubMove[]
  falls: ClubMove[]
  streaks: TitleStreak[]
  serving: ServiceLine[]
  titles: TitleHaul[]
  risers: RatingClimb[]
  /** The youngest player-seasons rated `STAR_RATING` or more, youngest first. */
  youngest: PlayerSeason[]
  /** The oldest player-seasons rated `STAR_RATING` or more, oldest first. */
  oldest: PlayerSeason[]
}

/** How many lines each list keeps. */
export const TRIVIA_LIMIT = 8

/** The rating the youngest and oldest lists ask for. */
export const STAR_RATING = 80

const cache = new WeakMap<LoadedUniverse, Map<string, LeagueTrivia>>()

/** Every list of a league's Records view, cached per universe and league. */
export function leagueTrivia(u: LoadedUniverse, leagueId: string): LeagueTrivia {
  let byLeague = cache.get(u)
  if (!byLeague) cache.set(u, (byLeague = new Map()))
  const hit = byLeague.get(leagueId)
  if (hit) return hit
  const out = buildTrivia(u, leagueId)
  byLeague.set(leagueId, out)
  return out
}

function buildTrivia(u: LoadedUniverse, leagueId: string): LeagueTrivia {
  const clubSeasons = u.clubSeasons.filter((cs) => cs.leagueId === leagueId)
  const seasonSet = new Set(clubSeasons.map((cs) => cs.season))
  const finished = clubSeasons.filter((cs) => cs.complete && cs.position > 0)
  const finishOf = new Map(finished.map((cs) => [`${cs.clubId}@${cs.season}`, cs]))
  const estimatedSeason = new Set(clubSeasons.filter((cs) => cs.estimated).map((cs) => cs.season))

  // Clubs: places moved between two seasons in a row, both with a final table
  const moves: ClubMove[] = []
  for (const cs of finished) {
    const prev = finishOf.get(`${cs.clubId}@${cs.season - 1}`)
    if (!prev) continue
    moves.push({ clubId: cs.clubId, season: cs.season, before: prev.position, after: cs.position, change: prev.position - cs.position, estimated: !!(cs.estimated || prev.estimated) })
  }
  const byId = (a: { clubId: string; season: number }, b: { clubId: string; season: number }) => a.season - b.season || a.clubId.localeCompare(b.clubId)
  const climbs = moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change || byId(a, b)).slice(0, TRIVIA_LIMIT)
  const falls = moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change || byId(a, b)).slice(0, TRIVIA_LIMIT)

  // Title runs: champions in seasons in a row
  const streaks: TitleStreak[] = []
  const champs = finished.filter((cs) => cs.champions).sort((a, b) => a.season - b.season)
  for (const cs of champs) {
    const last = streaks[streaks.length - 1]
    if (last && last.clubId === cs.clubId && last.to === cs.season - 1) {
      last.to = cs.season
      last.length++
      last.estimated ||= !!cs.estimated
    } else streaks.push({ clubId: cs.clubId, from: cs.season, to: cs.season, length: 1, estimated: !!cs.estimated })
  }
  const topStreaks = streaks.filter((s) => s.length > 1).sort((a, b) => b.length - a.length || a.from - b.from || a.clubId.localeCompare(b.clubId)).slice(0, TRIVIA_LIMIT)

  // Players: one walk over the league's player-seasons
  const inLeague = (p: PlayerSeason) => u.clubById[p.clubId]?.leagueId === leagueId
  const service = new Map<string, { playerId: string; clubId: string; seasons: Set<number>; estimated: boolean }>()
  const hauls = new Map<string, { seasons: Set<number>; clubs: string[]; estimated: boolean }>()
  const risers: RatingClimb[] = []
  const stars: PlayerSeason[] = []
  let playerSeasons = 0
  for (const e of playerIndex(u)) {
    const mine = e.seasons.filter(inLeague)
    if (!mine.length) continue
    playerSeasons += mine.length
    let best: RatingClimb | null = null
    const bestBySeason = new Map<number, PlayerSeason>()
    for (const p of mine) {
      const est = isEstimated(u, p)
      const key = `${p.playerId}|${p.clubId}`
      const s = service.get(key)
      if (s) {
        s.seasons.add(p.season)
        s.estimated ||= est
      } else service.set(key, { playerId: p.playerId, clubId: p.clubId, seasons: new Set([p.season]), estimated: est })
      if (p.accolades.includes('Champion')) {
        const h = hauls.get(p.playerId) ?? { seasons: new Set<number>(), clubs: [], estimated: false }
        if (!h.seasons.has(p.season)) {
          h.seasons.add(p.season)
          if (!h.clubs.includes(p.clubId)) h.clubs.push(p.clubId)
          h.estimated ||= est
        }
        hauls.set(p.playerId, h)
      }
      if (p.overall >= STAR_RATING) stars.push(p)
      const cur = bestBySeason.get(p.season)
      if (!cur || p.overall > cur.overall) bestBySeason.set(p.season, p)
    }
    // A jump compares two ratings of the same kind: never an estimated season against an EA one
    for (const [season, after] of bestBySeason) {
      const before = bestBySeason.get(season - 1)
      if (!before) continue
      const estA = isEstimated(u, after)
      if (estA !== isEstimated(u, before)) continue
      const change = after.overall - before.overall
      if (change > 0 && (!best || change > best.change || (change === best.change && after.season < best.after.season))) best = { playerId: e.playerId, name: e.name, before, after, change, estimated: estA }
    }
    if (best) risers.push(best)
  }
  const nameOf = (id: string) => playerEntry(u, id)?.name ?? id
  const serving = [...service.values()]
    .map((s) => ({ playerId: s.playerId, name: nameOf(s.playerId), clubId: s.clubId, seasons: s.seasons.size, from: Math.min(...s.seasons), to: Math.max(...s.seasons), estimated: s.estimated }))
    .sort((a, b) => b.seasons - a.seasons || a.from - b.from || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
    .slice(0, TRIVIA_LIMIT)
  const titles = [...hauls]
    .map(([playerId, h]) => ({ playerId, name: nameOf(playerId), titles: h.seasons.size, clubs: h.clubs, estimated: h.estimated, first: Math.min(...h.seasons) }))
    .sort((a, b) => b.titles - a.titles || a.first - b.first || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
    .slice(0, TRIVIA_LIMIT)
    .map(({ first: _first, ...h }) => h)
  risers.sort((a, b) => b.change - a.change || a.after.season - b.after.season || a.playerId.localeCompare(b.playerId))
  const ageTie = (a: PlayerSeason, b: PlayerSeason) => b.overall - a.overall || a.season - b.season || a.id.localeCompare(b.id)
  const youngest = onePer([...stars].sort((a, b) => a.age - b.age || ageTie(a, b)))
  const oldest = onePer([...stars].sort((a, b) => b.age - a.age || ageTie(a, b)))
  const seasons = [...seasonSet].sort((a, b) => a - b)
  return {
    coverage: { seasons: seasons.length, from: seasons[0] ?? 0, to: seasons[seasons.length - 1] ?? 0, withTable: new Set(finished.map((cs) => cs.season)).size, playerSeasons, estimatedSeasons: estimatedSeason.size },
    climbs,
    falls,
    streaks: topStreaks,
    serving,
    titles,
    risers: risers.slice(0, TRIVIA_LIMIT),
    youngest,
    oldest,
  }
}

/** The first season of each player in an ordered list, up to the limit. */
function onePer(list: PlayerSeason[]): PlayerSeason[] {
  const seen = new Set<string>()
  const out: PlayerSeason[] = []
  for (const p of list) {
    if (seen.has(p.playerId)) continue
    seen.add(p.playerId)
    out.push(p)
    if (out.length >= TRIVIA_LIMIT) break
  }
  return out
}
