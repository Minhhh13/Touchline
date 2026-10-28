/**
 * Display-only readings of the squad and the season for the Dugout (the FM-style quick wins): a player's form trend
 * and sparkline, the squad list's views, role fit and options, the XI's familiarity, the inbox filters, the window
 * countdown and the league position by matchweek. Pure: nothing here draws a number or changes the game.
 */
import { aiTeamInput, computeTable, humansOf, positionOf, USER_TEAM, type AiClub, type CarryRow, type CupTie, type NewsItem } from '@engine/season'
import { computeTeamStrength, roleRating } from '@engine/ratings'
import type { LoadedUniverse } from '@engine/universe'
import { teamStrength } from './squad'
import { rolesFor } from '@engine/roles'
import type { Attributes, Fixture, PlayerSeason, Position, SquadPlayer, TableRow } from '@engine/types'
import type { Window } from '@engine/market'
import type { Game } from '../types'
import type { MatchTeamInput } from '@engine/match'
import { playerLookup } from './players'
import { cupMatchScore, userCupMatches } from './cupMatches'

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

// ---------------------------------------------------------------- the hover card

export const PEEK_ATTRIBUTES: Array<{ key: keyof Attributes; label: string }> = [
  { key: 'pace', label: 'Pace' },
  { key: 'shooting', label: 'Shooting' },
  { key: 'passing', label: 'Passing' },
  { key: 'dribbling', label: 'Dribbling' },
  { key: 'defending', label: 'Defending' },
  { key: 'physical', label: 'Physical' },
  { key: 'mentality', label: 'Mentality' },
  { key: 'goalkeeping', label: 'Goalkeeping' },
]

/** His three best attributes for the hover card (goalkeeping only counts for a keeper, and always leads for one). */
export function topAttributes(p: Pick<PlayerSeason, 'attributes' | 'positions'>, n = 3): Array<{ key: keyof Attributes; label: string; value: number }> {
  const keeper = p.positions[0] === 'GK'
  return PEEK_ATTRIBUTES.filter((a) => keeper || a.key !== 'goalkeeping')
    .map((a) => ({ ...a, value: p.attributes[a.key] }))
    .sort((a, b) => (keeper ? Number(b.key === 'goalkeeping') - Number(a.key === 'goalkeeping') : 0) || b.value - a.value)
    .slice(0, n)
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

/** The window's completed deals: our signings (fee, or the loan fee) and the players we sold (the accepted offer). */
export function doneDeals(w: Pick<Window, 'listings' | 'offers'>): Array<{ dir: 'in' | 'out'; playerSeasonId: string; fee: number; loan: boolean; clubId?: string }> {
  const ins = w.listings.filter((l) => l.status === 'signed').map((l) => ({ dir: 'in' as const, playerSeasonId: l.playerSeasonId, fee: l.loan ? (l.loanFee ?? 0) : (l.bid ?? l.asking), loan: !!l.loan }))
  const outs = w.offers.filter((o) => o.status === 'accepted').map((o) => ({ dir: 'out' as const, playerSeasonId: o.playerSeasonId, fee: o.amount, loan: false, clubId: o.fromClubId }))
  return [...ins, ...outs]
}

/** The deadline-day ticker: the newest log lines, at most `n`. */
export function tickerLines(w: Pick<Window, 'log'>, n = 5): string[] {
  return w.log.slice(0, n)
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

// ---------------------------------------------------------------- the next match

export type Edge = 'ahead' | 'even' | 'behind'
/** Within this many rating points a unit match-up reads as even. */
export const EVEN_BAND = 1.5

export interface MatchUpRow {
  label: string
  ours: number
  theirs: number
  edge: Edge
}

/** An opponent's side as the match will field it: without any of the user's men (E6-2), so a preview shows the XI the match plays. Pure. */
export function opponentInput(game: Game, u: LoadedUniverse, club: AiClub, offset: number): MatchTeamInput {
  return aiTeamInput(u, club, offset, humansOf(Object.keys(game.squad), playerLookup(game, u)))
}

/** Our XI against the next opponent's, unit against unit: our attack on their defence, midfield on midfield, our defence on their attack, and the two sides overall. Null when the club is not in this season. */
export function matchUp(game: Game, u: LoadedUniverse, clubId: string): MatchUpRow[] | null {
  const club = game.season?.ai[clubId] ?? game.season?.continental?.clubs[clubId]
  if (!club) return null
  const input = opponentInput(game, u, club, game.season?.aiOffset ?? 0)
  const them = computeTeamStrength(club.tactics, input.lineup, input.getPlayer, input.getState)
  const us = teamStrength(game, u)
  const row = (label: string, ours: number, theirs: number): MatchUpRow => ({ label, ours: Math.round(ours * 10) / 10, theirs: Math.round(theirs * 10) / 10, edge: ours - theirs > EVEN_BAND ? 'ahead' : theirs - ours > EVEN_BAND ? 'behind' : 'even' })
  return [row('Our attack v their defence', us.attack, them.defence), row('Midfield v midfield', us.midfield, them.midfield), row('Our defence v their attack', us.defence, them.attack), row('Our keeper v their attack', us.goalkeeping, them.attack), row('Overall', us.overall, them.overall)]
}

// ---------------------------------------------------------------- the season calendar

export type Outcome = 'W' | 'D' | 'L'
export type TableBand = 'top' | 'mid' | 'bottom'

export interface StripTie {
  comp: 'cup' | 'continental'
  /** The knockout round, `G` for an engine 7 Continental Cup group match. */
  round: CupTie['round'] | 'G'
  opp: string
  home: boolean
  /** A tie's deciding match: through (W) or out (L), penalties deciding a draw; a group match or a first leg: its result. Absent before it is played. */
  outcome?: Outcome
  score?: string
  /** "Fourth round", "Continental Cup, Group B", "Continental quarter-final, first leg". */
  label?: string
}

export interface StripCell {
  matchweek: number
  /** Null on a free weekend. */
  opp: string | null
  home: boolean
  outcome?: Outcome
  score?: string
  /** The opponent's band in the table today: top four, bottom four or between (upcoming cells are tinted by it). */
  band: TableBand | null
  /** The user's cup or Continental Cup tie played after this matchweek. */
  ties: StripTie[]
}

/** A table band for a place: the top four, the bottom four, or between. */
export function tableBand(pos: number, teams: number): TableBand {
  return pos <= 4 ? 'top' : pos > teams - 4 ? 'bottom' : 'mid'
}

/**
 * Every matchweek of the user's season as a calendar cell: the opponent and venue, the result once played (W, D or L
 * from the score), the opponent's band in today's table, and any cup tie played after it. Reads scores only, so a
 * compacted save draws the same strip.
 */
export function seasonStrip(game: Pick<Game, 'season'>, table: TableRow[]): StripCell[] {
  const s = game.season
  if (!s) return []
  const teams = table.length
  const cells: StripCell[] = []
  const ties = userCupMatches(s)
  for (let mw = (s.takeoverAt ?? 0) + 1; mw <= s.matchweeks; mw++) {
    const f = s.fixtures.find((x) => x.matchweek === mw && (x.homeTeamId === USER_TEAM || x.awayTeamId === USER_TEAM))
    const home = !!f && f.homeTeamId === USER_TEAM
    const opp = f ? (home ? f.awayTeamId : f.homeTeamId) : null
    const r = f?.result
    const gf = r ? (home ? r.homeGoals : r.awayGoals) : 0
    const ga = r ? (home ? r.awayGoals : r.homeGoals) : 0
    const outcome: Outcome | undefined = r ? (gf > ga ? 'W' : gf < ga ? 'L' : 'D') : undefined
    const pos = opp ? positionOf(table, opp) : 0
    cells.push({
      matchweek: mw,
      opp,
      home,
      outcome,
      score: r ? `${r.homeGoals}-${r.awayGoals}` : undefined,
      band: opp && pos > 0 ? tableBand(pos, teams) : null,
      ties: ties.filter((m) => m.matchweek === mw).map((m) => ({ comp: m.comp, round: m.round, opp: m.opponentId, home: m.home, outcome: m.outcome, score: cupMatchScore(m), label: m.label })),
    })
  }
  return cells
}
