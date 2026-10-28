import type { AttributeKey, PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { rolesFor } from '@engine/roles'
import { roleRating } from '@engine/ratings'
import { isEstimated } from './era'
import { byRating } from './exploreIndex'
import { positionMap, type AttrColumn, type MapFit } from './playerCard'

/**
 * The player card's profile, Football Manager style (display only, pure, no RNG; no simulation path imports it):
 * attribute tones and group averages, the season-by-season career table with each club's finish, his best seasons,
 * how well he suits every role he can play, and the most similar player-seasons in the loaded data.
 */

/** An attribute's tone, FM style: the bar and the figure share it. */
export type AttrTone = 'elite' | 'good' | 'fair' | 'poor' | 'weak'

/** 85 and up elite, 75 good, 65 fair, 50 poor, under 50 weak. */
export function attrTone(v: number): AttrTone {
  return v >= 85 ? 'elite' : v >= 75 ? 'good' : v >= 65 ? 'fair' : v >= 50 ? 'poor' : 'weak'
}

/** The mean of a column's numbered attributes, rounded (the hidden traits and the injury risk are words, not counted). */
export function groupAverage(col: Pick<AttrColumn, 'rows'>): number | null {
  const vals = col.rows.flatMap((r) => (r.kind === 'attr' ? [r.value] : []))
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
}

/** One season of the career table. */
export interface CareerRow {
  p: PlayerSeason
  leagueId: string
  /** The club's final league position that season, 0 when the data has no final table. */
  finish: number
  champions: boolean
  /** His rating against his best rating of the season before, null for his first season or after a gap. */
  delta: number | null
  /** A classic season: TouchLine's estimate, not an EA rating. */
  estimated: boolean
}

/** Every season of the career, oldest first, with the club's finish and the change in rating since the season before. */
export function careerRows(u: LoadedUniverse, seasons: PlayerSeason[]): CareerRow[] {
  const bestOf = new Map<number, number>()
  for (const p of seasons) bestOf.set(p.season, Math.max(bestOf.get(p.season) ?? 0, p.overall))
  return seasons.map((p) => {
    const cs = u.clubSeasonByKey[`${p.clubId}@${p.season}`]
    const before = bestOf.get(p.season - 1)
    return {
      p,
      leagueId: cs?.leagueId ?? u.clubById[p.clubId]?.leagueId ?? '',
      finish: cs?.complete && cs.position > 0 ? cs.position : 0,
      champions: p.accolades.includes('Champion') || !!(cs?.complete && cs.champions),
      delta: before === undefined ? null : p.overall - before,
      estimated: isEstimated(u, p),
    }
  })
}

/** His best seasons, the highest rated first: one per season (the better club entry), equals by the earlier season. */
export function bestSeasons(seasons: PlayerSeason[], n = 5): PlayerSeason[] {
  const bySeason = new Map<number, PlayerSeason>()
  for (const p of seasons) {
    const cur = bySeason.get(p.season)
    if (!cur || p.overall > cur.overall) bySeason.set(p.season, p)
  }
  return [...bySeason.values()].sort((a, b) => b.overall - a.overall || a.season - b.season).slice(0, n)
}

/** A career in a few numbers for the card's head. */
export interface CareerSummary {
  seasons: number
  clubs: number
  titles: number
  peak: number
  /** His age in his first peak season. */
  peakAge: number
  from: number
  to: number
  /** His highest market value in the data, in GBP millions. */
  topValue: number
}

export function careerSummary(seasons: PlayerSeason[]): CareerSummary | null {
  if (!seasons.length) return null
  const best = bestSeasons(seasons, 1)[0]
  const titleSeasons = new Set(seasons.filter((p) => p.accolades.includes('Champion')).map((p) => p.season))
  return {
    seasons: new Set(seasons.map((p) => p.season)).size,
    clubs: new Set(seasons.map((p) => p.clubId)).size,
    titles: titleSeasons.size,
    peak: best.overall,
    peakAge: best.age,
    from: Math.min(...seasons.map((p) => p.season)),
    to: Math.max(...seasons.map((p) => p.season)),
    topValue: seasons.reduce((m, p) => Math.max(m, p.value), 0),
  }
}

/** How well he suits one role. */
export interface RoleFit {
  roleId: string
  /** The role's name as the engine writes it ("Deep-Lying Playmaker"). */
  name: string
  position: Position
  /** `roleRating`: the role's attribute weights blended with his overall, times his fit at the position. */
  rating: number
  fit: MapFit
}

/**
 * Every role at the positions he plays naturally or can cover, best first (equals by the role's order in the engine).
 * The figure is the engine's own `roleRating`, so it is the number a slot would use before condition and morale.
 */
export function roleSuitability(p: PlayerSeason, limit = 8): RoleFit[] {
  const out: Array<RoleFit & { order: number }> = []
  let order = 0
  for (const spot of positionMap(p)) {
    if (spot.fit !== 'natural' && spot.fit !== 'cover') continue
    for (const role of rolesFor(spot.pos)) out.push({ roleId: role.id, name: role.name, position: spot.pos, rating: Math.round(roleRating(p, role, spot.pos)), fit: spot.fit, order: order++ })
  }
  out.sort((a, b) => b.rating - a.rating || a.order - b.order)
  return out.slice(0, limit).map(({ order: _order, ...r }) => r)
}

/** The attributes compared for similarity: every numbered one the card shows. */
export const SIMILAR_KEYS: AttributeKey[] = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'mentality', 'goalkeeping', 'stamina', 'strength', 'aggression', 'jumping', 'workRate']

/** A similar player-season: the closer his attributes, the higher the match. */
export interface SimilarHit {
  p: PlayerSeason
  /** 0 to 100: 100 less twice the root-mean-square gap across `SIMILAR_KEYS`. */
  match: number
}

/** Candidates are within this many overall points of him. */
export const SIMILAR_RANGE = 6

/**
 * The player-seasons most like this one in the loaded data: the same first position, an overall within
 * `SIMILAR_RANGE`, the closest attributes first, one season per other player (his closest). Classic seasons count
 * only when `classic` is set, as every all-season list does. Equals by the higher overall, then the id.
 */
export function similarPlayers(u: LoadedUniverse, p: PlayerSeason, opts: { limit?: number; classic?: boolean } = {}): SimilarHit[] {
  const best = new Map<string, { p: PlayerSeason; d: number }>()
  for (const q of byRating(u)) {
    if (q.overall > p.overall + SIMILAR_RANGE) continue
    if (q.overall < p.overall - SIMILAR_RANGE) break
    if (q.playerId === p.playerId || q.positions[0] !== p.positions[0]) continue
    if (!opts.classic && u.clubSeasonByKey[`${q.clubId}@${q.season}`]?.classic) continue
    let sum = 0
    for (const k of SIMILAR_KEYS) {
      const gap = (q.attributes[k] ?? 0) - (p.attributes[k] ?? 0)
      sum += gap * gap
    }
    const d = Math.sqrt(sum / SIMILAR_KEYS.length)
    const cur = best.get(q.playerId)
    if (!cur || d < cur.d || (d === cur.d && q.id < cur.p.id)) best.set(q.playerId, { p: q, d })
  }
  return [...best.values()]
    .sort((a, b) => a.d - b.d || b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))
    .slice(0, opts.limit ?? 6)
    .map(({ p: q, d }) => ({ p: q, match: Math.max(0, Math.round(100 - 2 * d)) }))
}
