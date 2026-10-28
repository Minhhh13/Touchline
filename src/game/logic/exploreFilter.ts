import type { PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { foldName, playerIndex } from './exploreIndex'
import { classicFromFor } from './era'

/**
 * Explore's filtered search (display only, pure, no RNG): any mix of a name, a nation, a league, a position, an age
 * range, a rating range and a season range over every loaded player-season, one row per player (at his best matching
 * season) or one per season, sorted. The index behind it (`playerIndex`, shared with the search) is built once per universe.
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

const nationCache = new WeakMap<LoadedUniverse, Array<{ nation: string; players: number }>>()

/** The nations of the loaded players, the most real players first (then by code): the nation picker's list; cached per universe. */
export function nationCounts(u: LoadedUniverse): Array<{ nation: string; players: number }> {
  const hit = nationCache.get(u)
  if (hit) return hit
  const by = new Map<string, number>()
  for (const e of playerIndex(u)) {
    // A player counts once per nation he is listed under in any of his seasons
    for (const nation of new Set(e.seasons.map((p) => p.nationality))) by.set(nation, (by.get(nation) ?? 0) + 1)
  }
  const out = [...by].map(([nation, players]) => ({ nation, players })).sort((a, b) => b.players - a.players || a.nation.localeCompare(b.nation))
  nationCache.set(u, out)
  return out
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

/**
 * The Top view's season filter after a move to another league: kept when that league shows it, otherwise every season
 * (a classic season picked in England is not on Spain's list, and the view would say "No players match").
 */
export function seasonFilterIn(u: LoadedUniverse, leagueId: string, season: 'all' | number): 'all' | number {
  if (season === 'all') return 'all'
  return season < (classicFromFor(u, [leagueId]) ?? u.firstSeason) || season > u.lastSeason ? 'all' : season
}
