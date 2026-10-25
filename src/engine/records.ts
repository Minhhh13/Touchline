/**
 * The record books: where one season's numbers sit against every complete real
 * season of the league in the data. Pure lookups over `u.tables`; nothing here
 * touches the RNG or the game state.
 */
import type { LeagueSeasonRow } from './types'
import { ordinal, type LoadedUniverse } from './universe'

/** The six numbers a league table row carries, as the user's season or a real one. */
export interface SeasonFigures {
  won: number
  drawn: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
}

export interface HistoricRow {
  season: number
  row: LeagueSeasonRow
  /** Matches every club played that season: 38 for twenty clubs, 34 for eighteen. */
  played: number
}

export type RecordMetricKey = 'points' | 'wins' | 'goalsFor' | 'goalsAgainst' | 'defeats'

export interface RecordMetric {
  key: RecordMetricKey
  label: string
  /** The season's own figure. */
  value: number
  /** True when a bigger number is the better one (points, wins, goals scored); false for goals conceded and defeats. */
  higherIsBetter: boolean
  /** 1 + the number of historic seasons with a strictly better figure. */
  rank: number
  /** Historic club-seasons compared: every row of every complete season with the same number of matches. */
  of: number
  /** Historic club-seasons with exactly this figure. */
  equal: number
  /** Up to three historic club-seasons that beat it, best first. */
  better: Array<{ clubId: string; season: number; value: number }>
}

export interface SeasonBenchmark {
  leagueId: string
  /** Matches the benchmarked season had; only historic seasons of the same length are compared. */
  played: number
  /** Distinct complete seasons compared. */
  seasons: number
  points: RecordMetric
  wins: RecordMetric
  goalsFor: RecordMetric
  goalsAgainst: RecordMetric
  defeats: RecordMetric
  /** Metrics where the season stands alone at the top of the list: outright league records. */
  records: RecordMetric[]
}

/** A league needs this many complete seasons in the data before it has a record book worth quoting. */
export const RECORD_BOOK_MIN_SEASONS = 10

/** `LeagueSeasonRow` carries no `played`; a complete season's rows add up to it. */
export function playedOf(row: Pick<SeasonFigures, 'won' | 'drawn' | 'lost'>): number {
  return row.won + row.drawn + row.lost
}

/** Matches each club plays in a league of `clubs` sides, home and away. */
function fullSeason(clubs: number): number {
  return 2 * (clubs - 1)
}

/** A table is a complete season when every row has played the full home-and-away programme. */
function isCompleteTable(rows: LeagueSeasonRow[]): boolean {
  if (!rows.length) return false
  const full = fullSeason(rows.length)
  return rows.every((r) => playedOf(r) === full)
}

/**
 * Every row of every complete real season of the league, oldest first. The
 * season in progress is skipped, as is any table whose rows do not add up to a
 * full home-and-away programme.
 */
export function historicRows(u: LoadedUniverse, leagueId: string): HistoricRow[] {
  const tables = u.tables[leagueId]
  if (!tables) return []
  const out: HistoricRow[] = []
  const seasons = Object.keys(tables)
    .map(Number)
    .sort((a, b) => a - b)
  for (const season of seasons) {
    if (season === u.currentSeason) continue
    const rows = tables[season]
    if (!isCompleteTable(rows)) continue
    const played = fullSeason(rows.length)
    for (const row of rows) out.push({ season, row, played })
  }
  return out
}

const METRICS: Array<{ key: RecordMetricKey; label: string; higherIsBetter: boolean; pick: (r: SeasonFigures) => number }> = [
  { key: 'points', label: 'Points', higherIsBetter: true, pick: (r) => r.points },
  { key: 'wins', label: 'Wins', higherIsBetter: true, pick: (r) => r.won },
  { key: 'goalsFor', label: 'Goals scored', higherIsBetter: true, pick: (r) => r.goalsFor },
  { key: 'goalsAgainst', label: 'Goals conceded', higherIsBetter: false, pick: (r) => r.goalsAgainst },
  { key: 'defeats', label: 'Defeats', higherIsBetter: false, pick: (r) => r.lost },
]

/**
 * Rank a season's points, wins, goals scored, goals conceded and defeats
 * against every complete real season of the league with the same number of
 * matches. A 34-game Bundesliga season is never measured against a 38-game
 * one. A league without tables (France, the Netherlands, Portugal) compares
 * against nothing: every metric is rank 1 of 0 and nothing is a record.
 */
export function benchmarkSeason(u: LoadedUniverse, leagueId: string, row: SeasonFigures): SeasonBenchmark {
  const played = playedOf(row)
  const peers = historicRows(u, leagueId).filter((h) => h.played === played)
  const seasons = new Set(peers.map((h) => h.season)).size
  const metric = (m: (typeof METRICS)[number]): RecordMetric => {
    const value = m.pick(row)
    const scored = peers.map((h) => ({ clubId: h.row.clubId, season: h.season, value: m.pick(h.row) }))
    const beats = (a: number, b: number) => (m.higherIsBetter ? a > b : a < b)
    const better = scored.filter((s) => beats(s.value, value)).sort((a, b) => (m.higherIsBetter ? b.value - a.value : a.value - b.value) || a.season - b.season || a.clubId.localeCompare(b.clubId))
    const equal = scored.filter((s) => s.value === value).length
    return { key: m.key, label: m.label, value, higherIsBetter: m.higherIsBetter, rank: better.length + 1, of: peers.length, equal, better: better.slice(0, 3) }
  }
  const [points, wins, goalsFor, goalsAgainst, defeats] = METRICS.map(metric)
  const all = [points, wins, goalsFor, goalsAgainst, defeats]
  return {
    leagueId,
    played,
    seasons,
    points,
    wins,
    goalsFor,
    goalsAgainst,
    defeats,
    records: all.filter((x) => x.of > 0 && x.rank === 1 && x.equal === 0),
  }
}

/** Whether the league has enough complete seasons for the benchmark to mean anything. */
export function hasRecordBook(b: SeasonBenchmark): boolean {
  return b.seasons >= RECORD_BOOK_MIN_SEASONS
}

/** An outright points record in a league with a record book. */
export function isPointsRecord(b: SeasonBenchmark): boolean {
  return hasRecordBook(b) && b.records.some((m) => m.key === 'points')
}

/**
 * The club that actually won the league that season, or null when the table
 * is missing or the season is still being played.
 */
export function realChampion(u: LoadedUniverse, leagueId: string, season: number): string | null {
  if (season === u.currentSeason) return null
  const rows = u.tables[leagueId]?.[season]
  if (!rows || !isCompleteTable(rows)) return null
  return rows.find((r) => r.position === 1)?.clubId ?? null
}

/**
 * The share-text line for the points total: only when the league has a record
 * book and the season sits in its top ten, so a mid-table campaign adds nothing.
 */
export function recordShareLine(b: SeasonBenchmark, leagueName: string): string | null {
  if (!hasRecordBook(b) || b.points.rank > 10) return null
  if (b.records.some((m) => m.key === 'points')) return `📜 New ${leagueName} points record: ${b.points.value}`
  if (b.points.rank === 1) return `📜 Joint-best points total in ${leagueName} history`
  return `📜 ${ordinal(b.points.rank)}-best points total in ${leagueName} history`
}
