import type { ClubSeason, PlayerSeason, Position } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { canCover, ratingAt } from '@engine/positions'
import { getFormation } from '@engine/formations'
import { historicRows, type HistoricRow } from '@engine/records'
import { newDraft, QUICK_RULES, spinOdds } from '@engine/draft'
import { attributeColumns } from './playerCard'

/**
 * Explore's club pages, league pages, the wheel's chances and the compare view (display only, pure, no RNG: nothing
 * here draws or writes, and no simulation path imports it). Every list is ordered by data alone, so it reads the same
 * whatever order the packs loaded in.
 */

/** The mean of a club-season's eleven best ratings (the Seasons table's XI avg). */
export function xiAverage(cs: Pick<ClubSeason, 'squad'>): number {
  const best = cs.squad.map((p) => p.overall).sort((a, b) => b - a).slice(0, 11)
  return best.length ? best.reduce((s, x) => s + x, 0) / best.length : 0
}

/** The best-rated player of a club-season (the earliest id of equals). */
export function topPlayer(cs: Pick<ClubSeason, 'squad'>): PlayerSeason | undefined {
  return cs.squad.reduce<PlayerSeason | undefined>((m, p) => (!m || p.overall > m.overall || (p.overall === m.overall && p.id < m.id) ? p : m), undefined)
}

/** Whether the data holds a final table for the club-season's league and season. */
export function hasTable(u: LoadedUniverse, cs: Pick<ClubSeason, 'leagueId' | 'season'>): boolean {
  return !!u.tables[cs.leagueId]?.[cs.season]?.length
}

/** One club in a league's club list. */
export interface ClubEntry {
  clubId: string
  name: string
  seasons: number
  titles: number
  first: number
  last: number
  /** Best final position in the data, 0 when no season has a table. */
  bestFinish: number
}

/** Every club with a club-season in the league, the most titles first, then the most seasons, then by name. */
export function leagueClubs(u: LoadedUniverse, leagueId: string): ClubEntry[] {
  const by = new Map<string, ClubSeason[]>()
  for (const cs of u.clubSeasons) {
    if (cs.leagueId !== leagueId) continue
    const list = by.get(cs.clubId)
    if (list) list.push(cs)
    else by.set(cs.clubId, [cs])
  }
  const out: ClubEntry[] = []
  for (const [clubId, list] of by) {
    const seasons = list.map((cs) => cs.season)
    const finishes = list.filter((cs) => cs.position > 0 && hasTable(u, cs)).map((cs) => cs.position)
    out.push({ clubId, name: u.clubById[clubId]?.name ?? clubId, seasons: new Set(seasons).size, titles: list.filter((cs) => cs.champions).length, first: Math.min(...seasons), last: Math.max(...seasons), bestFinish: finishes.length ? Math.min(...finishes) : 0 })
  }
  return out.sort((a, b) => b.titles - a.titles || b.seasons - a.seasons || a.name.localeCompare(b.name) || a.clubId.localeCompare(b.clubId))
}

/** One season of a club's history. */
export interface ClubSeasonLine {
  cs: ClubSeason
  /** A real final table exists for it (France, the Netherlands and Portugal have none). */
  table: boolean
  xiAvg: number
  top: PlayerSeason | undefined
}

/** Every season of a club in the data, newest first. */
export function clubHistory(u: LoadedUniverse, clubId: string): ClubSeasonLine[] {
  return u.clubSeasons
    .filter((cs) => cs.clubId === clubId)
    .sort((a, b) => b.season - a.season || a.leagueId.localeCompare(b.leagueId))
    .map((cs) => ({ cs, table: hasTable(u, cs), xiAvg: xiAverage(cs), top: topPlayer(cs) }))
}

/** A club's record over its seasons with a final table: titles, top-four finishes, average finish. */
export interface ClubSummary {
  seasons: number
  titles: number
  topFour: number
  withTable: number
  avgFinish: number | null
  bestXiAvg: { season: number; value: number } | null
}

export function clubSummary(lines: ClubSeasonLine[]): ClubSummary {
  const ranked = lines.filter((l) => l.table && l.cs.complete && l.cs.position > 0)
  const best = lines.reduce<ClubSeasonLine | null>((m, l) => (!m || l.xiAvg > m.xiAvg || (l.xiAvg === m.xiAvg && l.cs.season < m.cs.season) ? l : m), null)
  return {
    seasons: lines.length,
    titles: lines.filter((l) => l.cs.champions).length,
    topFour: ranked.filter((l) => l.cs.position <= 4).length,
    withTable: ranked.length,
    avgFinish: ranked.length ? ranked.reduce((s, l) => s + l.cs.position, 0) / ranked.length : null,
    bestXiAvg: best ? { season: best.cs.season, value: best.xiAvg } : null,
  }
}

/** One slot of a club's best XI ever. */
export interface EverPick {
  slotId: string
  position: Position
  /** The season he was picked at (his best for this slot at the club). */
  p: PlayerSeason
  /** His rating in the slot (rounded `ratingAt`). */
  rating: number
}

export const BEST_XI_FORMATION = '4-3-3'

/**
 * A club's best XI ever in a 4-3-3: every real player at most once, each at his best season at the club for the slot.
 * Greedy over (player-season, slot) pairs, best slot rating first, among men who can cover the slot (natural or
 * accomplished); a slot nobody can cover takes the best rating left there. Equal ratings go to the earlier season,
 * then the id, so the XI never depends on the data's order.
 */
export function bestXIEver(u: LoadedUniverse, clubId: string, formationId = BEST_XI_FORMATION): EverPick[] {
  const formation = getFormation(formationId)
  const players = u.clubSeasons.filter((cs) => cs.clubId === clubId).flatMap((cs) => cs.squad)
  const order = (a: { p: PlayerSeason; r: number }, b: { p: PlayerSeason; r: number }) => b.r - a.r || a.p.season - b.p.season || a.p.id.localeCompare(b.p.id)
  const pairs: Array<{ p: PlayerSeason; slot: (typeof formation.slots)[number]; r: number }> = []
  for (const p of players) for (const slot of formation.slots) if (canCover(p, slot.position)) pairs.push({ p, slot, r: ratingAt(p, slot.position) })
  pairs.sort(order)
  const usedPlayers = new Set<string>()
  const picks = new Map<string, EverPick>()
  const take = (p: PlayerSeason, slot: (typeof formation.slots)[number], r: number) => {
    usedPlayers.add(p.playerId)
    picks.set(slot.id, { slotId: slot.id, position: slot.position, p, rating: Math.round(r) })
  }
  for (const x of pairs) if (!picks.has(x.slot.id) && !usedPlayers.has(x.p.playerId)) take(x.p, x.slot, x.r)
  for (const slot of formation.slots) {
    if (picks.has(slot.id)) continue
    const left = players.filter((p) => !usedPlayers.has(p.playerId)).map((p) => ({ p, r: ratingAt(p, slot.position) })).sort(order)
    if (left[0]) take(left[0].p, slot, left[0].r)
  }
  return formation.slots.flatMap((s) => picks.get(s.id) ?? [])
}

/** One season of a league: its champion and runner-up, or the leader of a season still being played. */
export interface ChampionLine {
  season: number
  /** The club placed first: the champion of a complete season, the leader of one in progress. */
  first: ClubSeason | undefined
  second: ClubSeason | undefined
  complete: boolean
  table: boolean
  /** Points between first and second, when the table has both. */
  gap: number | null
  estimated: boolean
}

/** The league's seasons in the data, newest first (classic seasons included when they are loaded). */
export function leagueSeasons(u: LoadedUniverse, leagueId: string): number[] {
  return [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId).map((cs) => cs.season))].sort((a, b) => b - a)
}

/** Champions by season, newest first. A season without a table has no first or second. */
export function leagueChampions(u: LoadedUniverse, leagueId: string): ChampionLine[] {
  // One pass over the club-seasons, not one per season
  const bySeason = new Map<number, ClubSeason[]>()
  for (const cs of u.clubSeasons) if (cs.leagueId === leagueId) bySeason.set(cs.season, [...(bySeason.get(cs.season) ?? []), cs])
  return leagueSeasons(u, leagueId).map((season) => {
    const clubs = bySeason.get(season) ?? []
    const table = hasTable(u, { leagueId, season })
    const first = table ? clubs.find((cs) => cs.position === 1) : undefined
    const second = table ? clubs.find((cs) => cs.position === 2) : undefined
    return { season, first, second, complete: clubs.every((cs) => cs.complete), table, gap: first && second ? first.points - second.points : null, estimated: clubs.some((cs) => cs.estimated) }
  })
}

/** A club's title count in the data, most first (the "most titles" record). */
export function titleCounts(u: LoadedUniverse, leagueId: string): Array<{ clubId: string; titles: number; seasons: number[] }> {
  const by = new Map<string, number[]>()
  for (const cs of u.clubSeasons) {
    if (cs.leagueId !== leagueId || !cs.champions) continue
    const list = by.get(cs.clubId)
    if (list) list.push(cs.season)
    else by.set(cs.clubId, [cs.season])
  }
  return [...by].map(([clubId, seasons]) => ({ clubId, titles: seasons.length, seasons: seasons.sort((a, b) => a - b) })).sort((a, b) => b.titles - a.titles || a.seasons[0] - b.seasons[0] || a.clubId.localeCompare(b.clubId))
}

/** The best-rated player-seasons of each season of a league, newest season first. */
export function topRatedBySeason(u: LoadedUniverse, leagueId: string, perSeason = 3): Array<{ season: number; players: PlayerSeason[] }> {
  const by = new Map<number, PlayerSeason[]>()
  for (const cs of u.clubSeasons) {
    if (cs.leagueId !== leagueId) continue
    const list = by.get(cs.season)
    if (list) list.push(...cs.squad)
    else by.set(cs.season, [...cs.squad])
  }
  return [...by]
    .sort((a, b) => b[0] - a[0])
    .map(([season, list]) => ({ season, players: list.sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id)).slice(0, perSeason) }))
}

export type LeagueRecordKey = 'mostPoints' | 'mostWins' | 'mostGoals' | 'fewestConceded' | 'fewestDefeats' | 'bestGoalDiff' | 'fewestPoints' | 'mostConceded'

/** One record of a league's book: the figure and every club-season that holds it. */
export interface LeagueRecord {
  key: LeagueRecordKey
  label: string
  value: number
  holders: Array<{ clubId: string; season: number }>
}

/** A league's record book, over its complete real tables of the usual length (other lengths are not comparable). */
export interface LeagueRecordBook {
  /** Matches a season of the compared length. */
  played: number
  /** Complete seasons of that length in the data. */
  seasons: number
  /** Complete seasons of another length, left out. */
  otherSeasons: number
  records: LeagueRecord[]
}

const RECORDS: Array<{ key: LeagueRecordKey; label: string; higher: boolean; pick: (h: HistoricRow) => number }> = [
  { key: 'mostPoints', label: 'Most points', higher: true, pick: (h) => h.row.points },
  { key: 'mostWins', label: 'Most wins', higher: true, pick: (h) => h.row.won },
  { key: 'mostGoals', label: 'Most goals scored', higher: true, pick: (h) => h.row.goalsFor },
  { key: 'fewestConceded', label: 'Fewest goals conceded', higher: false, pick: (h) => h.row.goalsAgainst },
  { key: 'fewestDefeats', label: 'Fewest defeats', higher: false, pick: (h) => h.row.lost },
  { key: 'bestGoalDiff', label: 'Best goal difference', higher: true, pick: (h) => h.row.goalsFor - h.row.goalsAgainst },
  { key: 'fewestPoints', label: 'Fewest points', higher: false, pick: (h) => h.row.points },
  { key: 'mostConceded', label: 'Most goals conceded', higher: true, pick: (h) => h.row.goalsAgainst },
]

/** The record holders (`records.ts`'s complete tables), or null for a league with no tables in the data. */
export function leagueRecordBook(u: LoadedUniverse, leagueId: string): LeagueRecordBook | null {
  const rows = historicRows(u, leagueId)
  if (!rows.length) return null
  const lengths = new Map<number, Set<number>>()
  for (const h of rows) {
    const s = lengths.get(h.played)
    if (s) s.add(h.season)
    else lengths.set(h.played, new Set([h.season]))
  }
  // The length most seasons had (the later one of equals): 38 games in England, 34 in Germany
  const [played, seasons] = [...lengths].sort((a, b) => b[1].size - a[1].size || b[0] - a[0])[0]
  const peers = rows.filter((h) => h.played === played)
  const records = RECORDS.map((m) => {
    const value = peers.reduce((best, h) => (m.higher ? Math.max(best, m.pick(h)) : Math.min(best, m.pick(h))), m.higher ? -Infinity : Infinity)
    const holders = peers.filter((h) => m.pick(h) === value).map((h) => ({ clubId: h.row.clubId, season: h.season })).sort((a, b) => a.season - b.season || a.clubId.localeCompare(b.clubId))
    return { key: m.key, label: m.label, value, holders }
  })
  const otherSeasons = [...lengths].filter(([n]) => n !== played).reduce((s, [, set]) => s + set.size, 0)
  return { played, seasons: seasons.size, otherSeasons, records }
}

/** How likely a club-season is on the wheel: the first spin of a Quick Draft of its league, and its share of its season. */
export interface WheelChance {
  /** Chance the first spin lands on it, 0 to 1. */
  p: number
  /** Its share of the spins that land on its season (the wheel picks a season, then a club by `spinWeight`). */
  seasonShare: number
  /** Seasons on that wheel. */
  seasons: number
}

const wheelCache = new WeakMap<LoadedUniverse, Map<string, Map<string, WheelChance>>>()
/**
 * The wheels already worked out, by the club-seasons they were worked out over. Every league load is a new universe
 * that holds the same club-season objects, so a league's wheel worked out on the last universe is still this one's
 * (the first spin's odds read nothing but those club-seasons and their squads). Kept for the last few wheels.
 */
const wheelsByPool: Array<{ key: string; pool: ClubSeason[]; out: Map<string, WheelChance> }> = []
const WHEELS_KEPT = 12

/** The club-seasons a league's first-spin wheel draws from: the league's own, classic ones only on the classic wheel. */
function wheelPool(u: LoadedUniverse, leagueId: string, classic: boolean): ClubSeason[] {
  const out: ClubSeason[] = []
  for (const cs of u.clubSeasons) if (cs.leagueId === leagueId && (classic || !cs.classic)) out.push(cs)
  return out
}

const samePool = (a: ClubSeason[], b: ClubSeason[]) => a.length === b.length && a.every((cs, i) => cs === b[i])

function keptWheel(u: LoadedUniverse, leagueId: string, classic: boolean): Map<string, WheelChance> | null {
  const key = `${leagueId}${classic ? '#classic' : ''}`
  if (!wheelsByPool.some((w) => w.key === key)) return null
  const pool = wheelPool(u, leagueId, classic)
  return wheelsByPool.find((w) => w.key === key && samePool(w.pool, pool))?.out ?? null
}

/** A league's wheel if it is already worked out for this universe's club-seasons, else null: never works it out. */
export function knownWheelChances(u: LoadedUniverse, leagueId: string, classic = false): Map<string, WheelChance> | null {
  const hit = wheelCache.get(u)?.get(`${leagueId}${classic ? '#classic' : ''}`)
  if (hit) return hit
  const kept = keptWheel(u, leagueId, classic)
  if (kept) wheelChances(u, leagueId, classic)
  return kept
}

/**
 * The first spin of an untouched Quick Draft on one league's wheel (`QUICK_RULES`, the default 4-3-3, every season;
 * the Classic toggle's wheel for a classic club-season), read from the engine's exact `spinOdds`. The first spin has
 * no twist, no re-spin and nothing drafted, so this is the plain wheel. No RNG; cached per universe, and across
 * universes by the very club-seasons the wheel holds (`spinOdds` is about 300 ms on a 4x-throttled phone, r13).
 */
export function wheelChances(u: LoadedUniverse, leagueId: string, classic = false): Map<string, WheelChance> {
  let byWheel = wheelCache.get(u)
  if (!byWheel) {
    byWheel = new Map()
    wheelCache.set(u, byWheel)
  }
  const key = `${leagueId}${classic ? '#classic' : ''}`
  const hit = byWheel.get(key)
  if (hit) return hit
  const kept = keptWheel(u, leagueId, classic)
  if (kept) {
    byWheel.set(key, kept)
    return kept
  }
  const pool = wheelPool(u, leagueId, classic)
  const d = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, leagues: [leagueId], ...(classic ? { classic: true } : {}) })
  const odds = spinOdds(u, d)
  const seasons = new Set(odds.outcomes.map((o) => o.cs.season)).size
  const out = new Map<string, WheelChance>()
  for (const o of odds.outcomes) out.set(`${o.cs.clubId}@${o.cs.season}`, { p: o.p, seasonShare: o.p * seasons, seasons })
  byWheel.set(key, out)
  wheelsByPool.unshift({ key, pool, out })
  if (wheelsByPool.length > WHEELS_KEPT) wheelsByPool.pop()
  return out
}

/** A club-season's chance on its league's wheel, or null when the wheel never lands on it (no usable player). */
export function wheelChanceOf(u: LoadedUniverse, cs: Pick<ClubSeason, 'clubId' | 'season' | 'leagueId' | 'classic'>): WheelChance | null {
  return wheelChances(u, cs.leagueId, !!cs.classic).get(`${cs.clubId}@${cs.season}`) ?? null
}

/** "1 in 412": a chance as the nearest whole "1 in N" (at least 1). */
export function oneIn(p: number): string {
  return p > 0 ? `1 in ${Math.max(1, Math.round(1 / p)).toLocaleString('en-GB')}` : 'never'
}

/** A share as a percentage to one decimal ("6.3%"), or "<0.1%" when it rounds to nothing. */
export function shareLabel(p: number): string {
  const v = Math.round(p * 1000) / 10
  return v === 0 && p > 0 ? '<0.1%' : `${v.toFixed(1)}%`
}

/** One row of the compare table: a figure per player, and which of them lead it. */
export interface CompareRow {
  key: string
  label: string
  group: 'Overview' | 'Technical' | 'Physical' | 'Mental'
  values: number[]
  /** Indexes of the players with the best figure; empty when all are equal or the row has no better side (age). */
  leaders: number[]
}

/** The compare view's table: overall, age and value, then every attribute in the player card's order and groups. */
export function compareRows(players: PlayerSeason[]): CompareRow[] {
  if (!players.length) return []
  const lead = (values: number[], higher: boolean | null): number[] => {
    if (higher === null || values.every((v) => v === values[0])) return []
    const best = higher ? Math.max(...values) : Math.min(...values)
    return values.flatMap((v, i) => (v === best ? [i] : []))
  }
  const rows: CompareRow[] = [
    { key: 'overall', label: 'Overall', group: 'Overview', values: players.map((p) => p.overall), leaders: [] },
    { key: 'age', label: 'Age', group: 'Overview', values: players.map((p) => p.age), leaders: [] },
    { key: 'value', label: 'Value', group: 'Overview', values: players.map((p) => p.value), leaders: [] },
  ]
  rows[0].leaders = lead(rows[0].values, true)
  rows[2].leaders = lead(rows[2].values, true)
  // The attribute rows of the first player's card fix the order; every player has the same keys
  for (const col of attributeColumns(players[0])) {
    for (const r of col.rows) {
      if (r.kind !== 'attr') continue
      const values = players.map((p) => p.attributes[r.key as keyof PlayerSeason['attributes']])
      rows.push({ key: r.key, label: r.label, group: col.title, values, leaders: lead(values, true) })
    }
  }
  return rows
}

/** A player's database career in a few numbers, for the compare columns. */
export interface CareerLine {
  seasons: number
  clubs: number
  titles: number
  peak: number
  from: number
  to: number
}

export function careerLine(seasons: PlayerSeason[]): CareerLine | null {
  if (!seasons.length) return null
  const years = seasons.map((s) => s.season)
  return {
    seasons: new Set(years).size,
    clubs: new Set(seasons.map((s) => s.clubId)).size,
    titles: seasons.filter((s) => s.accolades.includes('Champion')).length,
    peak: Math.max(...seasons.map((s) => s.overall)),
    from: Math.min(...years),
    to: Math.max(...years),
  }
}

/** Compare holds at most this many players. */
export const COMPARE_MAX = 3

/** Add a player to the compare list (last in), or take him off; a full list drops its oldest entry. */
export function toggleCompare(list: string[], playerId: string): string[] {
  if (list.includes(playerId)) return list.filter((x) => x !== playerId)
  return [...list, playerId].slice(-COMPARE_MAX)
}
