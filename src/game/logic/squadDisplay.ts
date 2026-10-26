/**
 * Display-only readings of the squad and the season for the Dugout (the FM-style quick wins): a player's form trend
 * and sparkline, the squad list's views, role fit and options, the XI's familiarity, the inbox filters, the window
 * countdown and the league position by matchweek. Pure: nothing here draws a number or changes the game.
 */
import { computeTable, positionOf, USER_TEAM, type CarryRow, type NewsItem } from '@engine/season'
import { roleRating } from '@engine/ratings'
import { rolesFor } from '@engine/roles'
import type { Fixture, PlayerSeason, Position, SquadPlayer } from '@engine/types'
import type { Window } from '@engine/market'
import type { Game } from '../types'

// ---------------------------------------------------------------- form

export type FormDir = 'up' | 'flat' | 'down'

/** How far the last three ratings must sit from the season average to count as rising or falling. */
export const FORM_BAND = 0.3

export interface FormTrend {
  dir: FormDir
  /** Mean of the last three match ratings. */
  recent: number
  /** Season average (rating sum over appearances). */
  season: number
}

/** The form arrow: the mean of the last three ratings against the season average, with a ±0.3 band. Null until he has three ratings. */
export function formTrend(s: Pick<SquadPlayer, 'recentRatings' | 'seasonStats'>): FormTrend | null {
  const last = s.recentRatings.slice(-3)
  if (last.length < 3 || s.seasonStats.apps < 3) return null
  const recent = last.reduce((a, b) => a + b, 0) / last.length
  const season = s.seasonStats.ratingSum / s.seasonStats.apps
  const gap = recent - season
  const dir: FormDir = gap > FORM_BAND ? 'up' : gap < -FORM_BAND ? 'down' : 'flat'
  return { dir, recent, season }
}

/** The arrow's title: "Form rising: 7.4 over the last 3, 6.8 this season". */
export function formTitle(t: FormTrend): string {
  const word = t.dir === 'up' ? 'rising' : t.dir === 'down' ? 'falling' : 'steady'
  return `Form ${word}: ${t.recent.toFixed(1)} over the last 3, ${t.season.toFixed(1)} this season`
}

export type RatingBand = 'good' | 'mid' | 'bad'

/** A match rating's colour band: 7.5 and up is good, under 6 is bad. */
export function ratingBand(r: number): RatingBand {
  return r >= 7.5 ? 'good' : r < 6 ? 'bad' : 'mid'
}

/** Sparkline scale: match ratings are drawn between these, clamped. */
export const SPARK_MIN = 5
export const SPARK_MAX = 9

/** The last five ratings as points of a `w` × `h` sparkline (1 px inset), on a fixed 5 to 9 scale so rows compare. */
export function sparkPoints(ratings: number[], w = 40, h = 14): Array<{ x: number; y: number; r: number; band: RatingBand }> {
  const last = ratings.slice(-5)
  const n = last.length
  return last.map((r, i) => {
    const v = Math.max(SPARK_MIN, Math.min(SPARK_MAX, r))
    const x = n === 1 ? w / 2 : 2 + ((w - 4) * i) / (n - 1)
    const y = 2 + (h - 4) * (1 - (v - SPARK_MIN) / (SPARK_MAX - SPARK_MIN))
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r, band: ratingBand(r) }
  })
}

// ---------------------------------------------------------------- squad list views

export type SquadView = 'overview' | 'form' | 'fitness' | 'contract'
export const SQUAD_VIEWS: Array<{ id: SquadView; label: string; hint: string }> = [
  { id: 'overview', label: 'Overview', hint: 'Apps, goals, assists and average rating' },
  { id: 'form', label: 'Form', hint: 'Last rating, average and player-of-the-match awards' },
  { id: 'fitness', label: 'Fitness', hint: 'Condition, stamina and minutes over the last three matchweeks' },
  { id: 'contract', label: 'Contract', hint: 'Years left, wage, squad status and value' },
]

/** Minutes over the last three matchweeks (league and cup), or null on an older save that does not keep them. */
export function minutesLast3(s: Pick<SquadPlayer, 'recentMinutes'>): number | null {
  if (!s.recentMinutes) return null
  return s.recentMinutes.slice(-3).reduce((a, b) => a + b, 0)
}

/** Average match rating this season, or null before his first appearance. */
export function seasonAverage(s: Pick<SquadPlayer, 'seasonStats'>): number | null {
  return s.seasonStats.apps ? s.seasonStats.ratingSum / s.seasonStats.apps : null
}

// ---------------------------------------------------------------- roles

export type RoleFit = 'suits' | 'fair' | 'poor'

/** How well the role suits him: his effective rating in it against his overall (within 1 suits, up to 4 below is fair, more is poor). */
export function roleFit(effective: number, overall: number): RoleFit {
  const gap = overall - effective
  return gap <= 1 ? 'suits' : gap <= 4 ? 'fair' : 'poor'
}

export const ROLE_FIT_LABEL: Record<RoleFit, string> = { suits: 'Suits', fair: 'Fair', poor: 'Poor' }

/** Every role open to a slot's position, each with his rating in it (before condition and form), for the role select. */
export function roleOptions(p: PlayerSeason | undefined, position: Position): Array<{ id: string; name: string; rating: number | null }> {
  return rolesFor(position).map((r) => ({ id: r.id, name: r.name, rating: p ? Math.round(roleRating(p, r, position)) : null }))
}

/** The XI's mean tactical familiarity, or null with nobody picked. */
export function teamFamiliarity(game: Pick<Game, 'lineup' | 'squad'>): number | null {
  const vals = Object.values(game.lineup)
    .map((id) => game.squad[id]?.familiarity)
    .filter((v): v is number => typeof v === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

// ---------------------------------------------------------------- inbox

export type InboxFilter = 'all' | 'matches' | 'squad' | 'market' | 'board'
export const INBOX_FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'matches', label: 'Matches' },
  { id: 'squad', label: 'Squad' },
  { id: 'market', label: 'Market' },
  { id: 'board', label: 'Board' },
]

/** Which filter an item belongs to, by its kind. */
export function inboxGroup(kind: NewsItem['kind']): Exclude<InboxFilter, 'all'> {
  switch (kind) {
    case 'result':
    case 'cup':
      return 'matches'
    case 'transfer':
      return 'market'
    case 'board':
    case 'info':
      return 'board'
    default:
      return 'squad'
  }
}

/** The feed narrowed to one filter, each item with its index in the full feed (the unread divider counts from the top of it). */
export function filterNews(news: NewsItem[], f: InboxFilter): Array<{ n: NewsItem; i: number }> {
  return news.map((n, i) => ({ n, i })).filter(({ n }) => f === 'all' || inboxGroup(n.kind) === f)
}

// ---------------------------------------------------------------- the transfer window

/** Market days left after today, and the chip's words: "Window shuts today" on the last day. */
export function windowCountdown(w: Pick<Window, 'day' | 'days'>): { daysLeft: number; label: string; last: boolean } {
  const daysLeft = Math.max(0, w.days - 1 - w.day)
  const label = daysLeft === 0 ? 'Window shuts today' : `Window shuts in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
  return { daysLeft, label, last: daysLeft === 0 }
}

// ---------------------------------------------------------------- the table

/**
 * League position after each matchweek with a result in it, for every club: the table recomputed from scores only,
 * so it is safe on a compacted save. `matchweeks[k]` is the matchweek of the k-th point.
 */
export function positionHistory(fixtures: Fixture[], teamIds: string[], carryIn?: Record<string, CarryRow>): { matchweeks: number[]; byTeam: Record<string, number[]> } {
  const played = [...new Set(fixtures.filter((f) => f.result).map((f) => f.matchweek))].sort((a, b) => a - b)
  const byTeam: Record<string, number[]> = Object.fromEntries(teamIds.map((id) => [id, [] as number[]]))
  for (const mw of played) {
    const table = computeTable(
      fixtures.filter((f) => f.matchweek <= mw),
      teamIds,
      carryIn,
    )
    for (const id of teamIds) byTeam[id].push(positionOf(table, id))
  }
  return { matchweeks: played, byTeam }
}

/** The user's line and the clubs placed just around him now (up to `n`), for the Table tab's chart. */
export function positionStory(fixtures: Fixture[], teamIds: string[], carryIn?: Record<string, CarryRow>, n = 2): { matchweeks: number[]; series: number[]; rivals: Array<{ teamId: string; series: number[] }> } {
  const h = positionHistory(fixtures, teamIds, carryIn)
  const series = h.byTeam[USER_TEAM] ?? []
  const now = series[series.length - 1]
  const rivals =
    now === undefined
      ? []
      : teamIds
          .filter((id) => id !== USER_TEAM)
          .map((id) => ({ teamId: id, series: h.byTeam[id], at: h.byTeam[id][h.byTeam[id].length - 1] }))
          .sort((a, b) => Math.abs(a.at - now) - Math.abs(b.at - now) || a.at - b.at)
          .slice(0, n)
          .sort((a, b) => a.at - b.at)
          .map(({ teamId, series: s }) => ({ teamId, series: s }))
  return { matchweeks: h.matchweeks, series, rivals }
}
