import { describe, expect, it } from 'vitest'
import { Rng } from '@engine/rng'
import type { PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { freshTestUniverse } from '../../engine/__tests__/helpers'
import { filterPlayers, type FilterHit, type FilterResult, type FilterSort, type PlayerFilter } from '../logic/exploreFilter'
import { foldName, playerIndex } from '../logic/exploreIndex'
import { searchPlayers, SEARCH_LIMIT, type PlayerHit } from '../logic/exploreSearch'

// The search and the filter as they were on `main` at 869c434, before the narrowed name index: every query below
// must give the same rows in the same order, from a fresh cache and from one warmed by the queries typed before it.

function oldSearch(u: LoadedUniverse, query: string, opts: { position?: Position; limit?: number } = {}): PlayerHit[] {
  const words = foldName(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length || words.join('').length < 2) return []
  const hits: Array<PlayerHit & { rank: number }> = []
  for (const e of playerIndex(u)) {
    if (!e.folded.some((n) => words.every((w) => n.includes(w)))) continue
    const best = e.seasons.reduce((m, p) => (p.overall > m.overall ? p : m), e.seasons[0])
    if (opts.position && best.positions[0] !== opts.position) continue
    const starts = e.parts.some((parts) => words.every((w) => parts.some((part) => part.startsWith(w))))
    hits.push({ playerId: e.playerId, name: e.name, best, latest: e.seasons[e.seasons.length - 1], seasons: e.seasonCount, from: e.from, to: e.to, clubs: [...e.clubs], rank: starts ? 0 : 1 })
  }
  hits.sort((a, b) => a.rank - b.rank || b.best.overall - a.best.overall || a.name.localeCompare(b.name) || a.playerId.localeCompare(b.playerId))
  return hits.slice(0, opts.limit ?? SEARCH_LIMIT).map(({ rank: _rank, ...hit }) => hit)
}

function oldActive(f: PlayerFilter): boolean {
  return foldName(f.query ?? '').replace(/\s+/g, '').length >= 2 || [f.nation, f.leagueId, f.position, f.minAge, f.maxAge, f.minRating, f.maxRating, f.fromSeason, f.toSeason].some((x) => x !== undefined && x !== '')
}

function oldSeasonMatches(u: LoadedUniverse, f: PlayerFilter, p: PlayerSeason): boolean {
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

function oldFilter(u: LoadedUniverse, f: PlayerFilter): FilterResult {
  if (!oldActive(f)) return { rows: [], total: 0 }
  const words = foldName(f.query ?? '').trim().split(/\s+/).filter(Boolean)
  const hits: Array<FilterHit & { rank: number }> = []
  for (const e of playerIndex(u)) {
    if (words.length && !e.folded.some((n) => words.every((w) => n.includes(w)))) continue
    const matching = e.seasons.filter((p) => oldSeasonMatches(u, f, p))
    if (!matching.length) continue
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
  return { rows: hits.slice(0, f.limit ?? FILTER_LIMIT_OLD).map(({ rank: _rank, ...h }) => h), total: hits.length }
}

const FILTER_LIMIT_OLD = 200

/** What a hit is compared by: ids and every number shown, so a row in another order or with another season fails. */
const searchKey = (hits: PlayerHit[]) => hits.map((h) => [h.playerId, h.name, h.best.id, h.latest.id, h.seasons, h.from, h.to, h.clubs.join(',')].join('|'))
const filterKey = (r: FilterResult) => [String(r.total), ...r.rows.map((h) => [h.p.id, h.name, h.matching, h.from, h.to, h.seasons, h.clubs.join(',')].join('|'))]

/** Queries as a person types them: a real name, letter by letter, with a slip and a backspace now and then. */
function typedQueries(u: LoadedUniverse, seed: string, names: number): string[] {
  const rng = new Rng(seed)
  const list = playerIndex(u)
  const out: string[] = []
  for (let i = 0; i < names; i++) {
    const e = list[rng.int(0, list.length - 1)]
    const name = rng.next() < 0.3 ? e.name : e.name.split(' ').pop()!
    let typed = ''
    for (const ch of name) {
      typed += ch
      out.push(typed)
      if (rng.next() < 0.08) {
        out.push(typed + 'x')
        out.push(typed)
      }
    }
    // Back to empty, one letter at a time
    while (typed.length) {
      typed = typed.slice(0, -1)
      if (rng.next() < 0.3) out.push(typed)
    }
  }
  return out
}

const FIXED = ['ha', 'haa', 'haaland', 'an', 'de bruyne', 'bruyne de', 'kane', 'guéhi', 'GUEHI', 'ødegaard', 'odegaard', 'van dijk', 'van', 'van d', "o'", 'jr', 'mart', 'martín', 'martin', 'ma rt', ' ma ', 'zz', 'k', 'a', '', '   ', 'son', 'so n', 'müller', 'muller', 'é', 'ee', 'silva', 'da silva', 'dos santos', '-', 'jean-', 'ab', 'ba', 'ab ba']

const POSITIONS: Position[] = ['GK', 'CB', 'ST', 'CM', 'LW']
const SORTS: FilterSort[] = ['relevance', 'rating', 'age', 'name', 'season', 'value']

describe("Explore's narrowed search gives the old search's answer", () => {
  const u = freshTestUniverse(['england', 'spain', 'germany', 'italy', 'france', 'netherlands', 'portugal'])
  const typed = [...typedQueries(u, 'explore-same-a', 60), ...typedQueries(u, 'explore-same-b', 60)]

  it('the search, typed in order and from a cold cache', () => {
    const queries = [...FIXED, ...typed]
    expect(queries.length).toBeGreaterThan(1000)
    for (const q of queries) expect(searchKey(searchPlayers(u, q)), q).toEqual(searchKey(oldSearch(u, q)))
    for (const q of queries.slice(0, 200)) expect(searchKey(searchPlayers(u, q, { limit: 6 })), q).toEqual(searchKey(oldSearch(u, q, { limit: 6 })))
    // A fresh universe has no earlier queries: the same answer without the narrowing
    const cold = freshTestUniverse(['england', 'spain', 'germany', 'italy', 'france', 'netherlands', 'portugal'])
    for (const q of [...queries].reverse().slice(0, 150)) expect(searchKey(searchPlayers(cold, q)), q).toEqual(searchKey(oldSearch(cold, q)))
  }, 120_000)

  it('the filter, with every sort and filters beside the name', () => {
    const rng = new Rng('explore-same-filter')
    let n = 0
    for (const q of [...FIXED, ...typed.slice(0, 600)]) {
      const f: PlayerFilter = { query: q, sort: SORTS[rng.int(0, SORTS.length - 1)], reverse: rng.next() < 0.3, onePerPlayer: rng.next() < 0.8 }
      if (rng.next() < 0.2) f.position = POSITIONS[rng.int(0, POSITIONS.length - 1)]
      if (rng.next() < 0.15) f.anyPosition = true
      if (rng.next() < 0.15) f.leagueId = ['england', 'spain', 'italy'][rng.int(0, 2)]
      if (rng.next() < 0.15) f.minRating = rng.int(60, 85)
      if (rng.next() < 0.1) f.maxAge = rng.int(19, 30)
      if (rng.next() < 0.1) f.nation = ['BR', 'ES', 'FR', 'GB-ENG'][rng.int(0, 3)]
      expect(filterKey(filterPlayers(u, f)), JSON.stringify(f)).toEqual(filterKey(oldFilter(u, f)))
      n++
    }
    expect(n).toBeGreaterThan(600)
  }, 120_000)
})
