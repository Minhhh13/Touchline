import type { PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { foldName } from './exploreSearch'

/**
 * Explore's filtered search (display only, pure, no RNG): any mix of a name, a nation, a league, a position, an age
 * range, a rating range and a season range over every loaded player-season, one row per player (at his best matching
 * season) or one per season, sorted. The index behind it is built once per universe.
 */

export type FilterSort = 'relevance' | 'rating' | 'age' | 'name' | 'season' | 'value'

export interface PlayerFilter {
  query?: string
  nation?: string
  leagueId?: string
  position?: Position
  /** Match any of his positions, not only his first. */
  anyPosition?: boolean
  minAge?: number
  maxAge?: number
  minRating?: number
  maxRating?: number
  fromSeason?: number
  toSeason?: number
  /** One row per real player (his best matching season), with his career span; otherwise one row per season. */
  onePerPlayer?: boolean
  sort?: FilterSort
  /** Ascending instead of the sort's natural direction (rating, value and season high first; age and name low first). */
  reverse?: boolean
  limit?: number
}

export interface FilterHit {
  /** The season shown: his best matching season with `onePerPlayer`. */
  p: PlayerSeason
  /** The fullest spelling of his name. */
  name: string
  /** Matching seasons (1 per row without `onePerPlayer`). */
  matching: number
  /** His whole database career: span, distinct seasons and clubs in the order he first played for them. */
  from: number
  to: number
  seasons: number
  clubs: string[]
}

export interface FilterResult {
  rows: FilterHit[]
  /** Every match before the limit. */
  total: number
}

export const FILTER_LIMIT = 200

interface PlayerEntry {
  playerId: string
  seasons: PlayerSeason[]
  name: string
  folded: string[]
  parts: string[][]
  from: number
  to: number
  seasonCount: number
  clubs: string[]
}

const indexCache = new WeakMap<LoadedUniverse, PlayerEntry[]>()

/** One entry per real player, his seasons oldest first; built once per universe. */
function playerIndex(u: LoadedUniverse): PlayerEntry[] {
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

/** Whether a filter narrows anything: a name of two letters or more, or any other field set. */
export function filterActive(f: PlayerFilter): boolean {
  return foldName(f.query ?? '').replace(/\s+/g, '').length >= 2 || [f.nation, f.leagueId, f.position, f.minAge, f.maxAge, f.minRating, f.maxRating, f.fromSeason, f.toSeason].some((x) => x !== undefined && x !== '')
}

function seasonMatches(u: LoadedUniverse, f: PlayerFilter, p: PlayerSeason): boolean {
  if (f.nation && p.nationality !== f.nation) return false
  if (f.leagueId && u.clubById[p.clubId]?.leagueId !== f.leagueId) return false
  if (f.position && (f.anyPosition ? !p.positions.includes(f.position) : p.positions[0] !== f.position)) return false
  if (f.minAge !== undefined && p.age < f.minAge) return false
  if (f.maxAge !== undefined && p.age > f.maxAge) return false
  if (f.minRating !== undefined && p.overall < f.minRating) return false
  if (f.maxRating !== undefined && p.overall > f.maxRating) return false
  if (f.fromSeason !== undefined && p.season < f.fromSeason) return false
  if (f.toSeason !== undefined && p.season > f.toSeason) return false
  return true
}

/** Every player (or player-season) the filter admits, sorted, the first `limit` of them. */
export function filterPlayers(u: LoadedUniverse, f: PlayerFilter): FilterResult {
  if (!filterActive(f)) return { rows: [], total: 0 }
  const words = foldName(f.query ?? '').trim().split(/\s+/).filter(Boolean)
  const hits: Array<FilterHit & { rank: number }> = []
  for (const e of playerIndex(u)) {
    if (words.length && !e.folded.some((n) => words.every((w) => n.includes(w)))) continue
    const matching = e.seasons.filter((p) => seasonMatches(u, f, p))
    if (!matching.length) continue
    // A word that starts a part of his name ranks first for relevance ("Kane" finds Harry Kane before Kanté)
    const rank = words.length && e.parts.some((parts) => words.every((w) => parts.some((part) => part.startsWith(w)))) ? 0 : 1
    const base = { name: e.name, from: e.from, to: e.to, seasons: e.seasonCount, clubs: e.clubs, rank }
    if (f.onePerPlayer ?? true) {
      const best = matching.reduce((m, p) => (p.overall > m.overall ? p : m), matching[0])
      hits.push({ ...base, p: best, matching: matching.length })
    } else for (const p of matching) hits.push({ ...base, p, matching: 1 })
  }
  const sort = f.sort ?? (words.length ? 'relevance' : 'rating')
  const dir = f.reverse ? -1 : 1
  const tie = (a: FilterHit, b: FilterHit) => b.p.overall - a.p.overall || a.p.season - b.p.season || a.p.id.localeCompare(b.p.id)
  const cmp: Record<FilterSort, (a: FilterHit & { rank: number }, b: FilterHit & { rank: number }) => number> = {
    relevance: (a, b) => a.rank - b.rank,
    rating: (a, b) => b.p.overall - a.p.overall,
    age: (a, b) => a.p.age - b.p.age,
    name: (a, b) => a.name.localeCompare(b.name),
    season: (a, b) => b.p.season - a.p.season,
    value: (a, b) => b.p.value - a.p.value,
  }
  hits.sort((a, b) => dir * cmp[sort](a, b) || tie(a, b))
  return { rows: hits.slice(0, f.limit ?? FILTER_LIMIT).map(({ rank: _rank, ...h }) => h), total: hits.length }
}

/** The nations of the loaded players, the most real players first (then by code): the nation picker's list. */
export function nationCounts(u: LoadedUniverse): Array<{ nation: string; players: number }> {
  const by = new Map<string, Set<string>>()
  for (const p of Object.values(u.index)) {
    const s = by.get(p.nationality)
    if (s) s.add(p.playerId)
    else by.set(p.nationality, new Set([p.playerId]))
  }
  return [...by].map(([nation, s]) => ({ nation, players: s.size })).sort((a, b) => b.players - a.players || a.nation.localeCompare(b.nation))
}

/** A number field's text as a filter bound: blank (or not a number) is no bound. */
export function boundOf(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** Explore's search form as typed: every field a string or a switch, blank meaning no filter. */
export interface SearchForm {
  query: string
  nation: string
  leagueId: string
  position: '' | Position
  anyPosition: boolean
  minAge: string
  maxAge: string
  minRating: string
  maxRating: string
  sort: FilterSort
  reverse: boolean
  every: boolean
}

export const BLANK_SEARCH: SearchForm = { query: '', nation: '', leagueId: '', position: '', anyPosition: false, minAge: '', maxAge: '', minRating: '', maxRating: '', sort: 'relevance', reverse: false, every: false }

/** The form as a filter: blank fields filter nothing; relevance needs a name, so without one it reads as rating. */
export function formFilter(f: SearchForm): PlayerFilter {
  const out: PlayerFilter = { query: f.query, anyPosition: f.anyPosition, onePerPlayer: !f.every, sort: f.sort === 'relevance' && f.query.trim().length < 2 ? 'rating' : f.sort, reverse: f.reverse }
  if (f.nation) out.nation = f.nation
  if (f.leagueId) out.leagueId = f.leagueId
  if (f.position) out.position = f.position
  const minAge = boundOf(f.minAge)
  const maxAge = boundOf(f.maxAge)
  const minRating = boundOf(f.minRating)
  const maxRating = boundOf(f.maxRating)
  if (minAge !== undefined) out.minAge = minAge
  if (maxAge !== undefined) out.maxAge = maxAge
  if (minRating !== undefined) out.minRating = minRating
  if (maxRating !== undefined) out.maxRating = maxRating
  return out
}
