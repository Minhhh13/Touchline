/**
 * The world leaderboard's reads: today's Daily, this week's challenge and the all-time Daily totals (points or best
 * streak), each optionally for one country. Everything here goes through the database's board readers, which
 * anyone can call signed out; the caller's own row (`is_me`, the summaries' positions) needs a session. Rows are
 * parsed into plain shapes so the screens never see the database's column names.
 */
import type { SeasonTier } from '@engine/types'
import type { OnlineTransport } from './transport'
import { weekStartOf } from './weekly'
import { normaliseCountry } from './core/country'

export type RankedKind = 'daily' | 'weekly'
export type AlltimeOrder = 'points' | 'streak'

export interface BoardRow {
  position: number
  name: string
  country: string | null
  team: string
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  leaguePosition: number
  tier: SeasonTier | string
  createdAt: string
  isMe: boolean
  revealed: boolean
  /** The ghost-draft payload, once nobody can post that day or week any more ("Race this run"). */
  payload: string | null
}

export interface BoardSummary {
  played: number
  top: number | null
  myPosition: number | null
  myPoints: number | null
  open: boolean
  revealed: boolean
}

export interface AlltimeRow {
  position: number
  name: string
  country: string | null
  totalPoints: number
  played: number
  average: number
  bestStreak: number
  currentStreak: number
  lastDate: string | null
  isMe: boolean
}

export interface AlltimeMine extends Omit<AlltimeRow, 'isMe' | 'average'> {
  players: number
}

export interface MyEntry {
  key: string
  position: number
  total: number
  points: number
  won: number
  drawn: number
  lost: number
  tier: string
  team: string
  claimMatched: boolean
}

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : 0)
const s = (v: unknown) => (typeof v === 'string' ? v : '')
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : v && typeof v === 'object' ? [v as Row] : [])

export const PAGE = 50

/** The date a board function takes: the Daily's date, or the Monday a week starts on. */
export function boardDate(kind: RankedKind, key: string): string | null {
  if (kind === 'daily') return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null
  const start = weekStartOf(key)
  return start ? start.toISOString().slice(0, 10) : null
}

export function boardRowFrom(r: Row): BoardRow {
  return {
    position: n(r.board_position),
    name: s(r.display_name),
    country: normaliseCountry(s(r.country)),
    team: s(r.team_name),
    points: n(r.points),
    won: n(r.won),
    drawn: n(r.drawn),
    lost: n(r.lost),
    goalsFor: n(r.goals_for),
    goalsAgainst: n(r.goals_against),
    goalDiff: n(r.goal_diff),
    leaguePosition: n(r.league_position),
    tier: s(r.tier),
    createdAt: s(r.created_at),
    isMe: r.is_me === true,
    revealed: r.revealed === true,
    payload: typeof r.payload === 'string' && r.payload ? r.payload : null,
  }
}

export function summaryFrom(v: unknown): BoardSummary {
  const r = rows(v)[0] ?? {}
  return { played: n(r.played), top: r.top_points == null ? null : n(r.top_points), myPosition: r.my_position == null ? null : n(r.my_position), myPoints: r.my_points == null ? null : n(r.my_points), open: r.posts_open === true, revealed: r.revealed === true }
}

export function alltimeRowFrom(r: Row): AlltimeRow {
  return { position: n(r.board_position), name: s(r.display_name), country: normaliseCountry(s(r.country)), totalPoints: n(r.total_points), played: n(r.played), average: n(r.average_points), bestStreak: n(r.best_streak), currentStreak: n(r.current_streak), lastDate: s(r.last_date) || null, isMe: r.is_me === true }
}

export async function fetchBoard(t: OnlineTransport, kind: RankedKind, key: string, country: string | null, offset = 0): Promise<BoardRow[]> {
  const date = boardDate(kind, key)
  if (!date) return []
  const fn = kind === 'daily' ? 'daily_board' : 'weekly_board'
  const arg = kind === 'daily' ? { p_date: date } : { p_week: date }
  return rows(await t.rpc(fn, { ...arg, p_limit: PAGE, p_offset: offset, p_country: normaliseCountry(country) })).map(boardRowFrom)
}

export async function fetchSummary(t: OnlineTransport, kind: RankedKind, key: string, country: string | null): Promise<BoardSummary> {
  const date = boardDate(kind, key)
  if (!date) return summaryFrom(null)
  const fn = kind === 'daily' ? 'daily_summary' : 'weekly_summary'
  const arg = kind === 'daily' ? { p_date: date } : { p_week: date }
  return summaryFrom(await t.rpc(fn, { ...arg, p_country: normaliseCountry(country) }))
}

/** Where a result that is not on the board would place (signed out, or unranked). */
export async function rankOf(t: OnlineTransport, kind: RankedKind, key: string, r: { points: number; lost: number; goalDiff: number; goalsFor: number }, country: string | null): Promise<number | null> {
  const date = boardDate(kind, key)
  if (!date) return null
  const fn = kind === 'daily' ? 'daily_rank' : 'weekly_rank'
  const arg = kind === 'daily' ? { p_date: date } : { p_week: date }
  const v = await t.rpc<unknown>(fn, { ...arg, p_points: r.points, p_lost: r.lost, p_goal_diff: r.goalDiff, p_goals_for: r.goalsFor, p_country: normaliseCountry(country) })
  return typeof v === 'number' ? v : null
}

export async function fetchAlltime(t: OnlineTransport, order: AlltimeOrder, country: string | null, offset = 0): Promise<AlltimeRow[]> {
  return rows(await t.rpc('daily_alltime_board', { p_order: order, p_country: normaliseCountry(country), p_limit: PAGE, p_offset: offset })).map(alltimeRowFrom)
}

export async function fetchAlltimeMine(t: OnlineTransport, order: AlltimeOrder, country: string | null): Promise<AlltimeMine | null> {
  const r = rows(await t.rpc('daily_alltime_mine', { p_order: order, p_country: normaliseCountry(country) }))[0]
  if (!r || r.board_position == null) return null
  return { position: n(r.board_position), players: n(r.players), name: s(r.display_name), country: normaliseCountry(s(r.country)), totalPoints: n(r.total_points), played: n(r.played), bestStreak: n(r.best_streak), currentStreak: n(r.current_streak), lastDate: s(r.last_date) || null }
}

/** The caller's own entries ("Your dailies", "Your weekly challenges"). */
export async function myEntries(t: OnlineTransport, kind: RankedKind): Promise<MyEntry[]> {
  const fn = kind === 'daily' ? 'daily_my_entries' : 'weekly_my_entries'
  return rows(await t.rpc(fn, { p_limit: 30 })).map((r) => ({
    key: s(r.puzzle_date) || s(r.week_key) || s(r.week_start),
    position: n(r.board_position),
    total: n(r.total),
    points: n(r.points),
    won: n(r.won),
    drawn: n(r.drawn),
    lost: n(r.lost),
    tier: s(r.tier),
    team: s(r.team_name),
    claimMatched: r.claim_matched !== false,
  }))
}

// ------------------------------------------------------------------ the 38-0 chase

/** Which chase board: this ISO week (the week an attempt was issued in) or all time. */
export type ChaseScope = 'week' | 'alltime'

export interface ChaseRow {
  position: number
  name: string
  country: string | null
  team: string
  leagueId: string
  games: number
  points: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  /** Points short of the league's maximum (3 a game): what the board orders by first. */
  dropped: number
  /** Every league game won: 38-0, or 34-0 in an 18-club league. */
  perfect: boolean
  leaguePosition: number
  tier: SeasonTier | string
  createdAt: string
  isMe: boolean
  /** The ghost-draft payload ("Race this run": a challenge, never ranked). */
  payload: string | null
  /** The attempt's player ratings and bench places. */
  ratings: 'season' | 'prime'
  benchPicks: number
}

/** The season closest to perfect ever posted (with the board's country filter). */
export interface ChaseRecord {
  name: string
  country: string | null
  team: string
  leagueId: string
  games: number
  points: number
  won: number
  drawn: number
  lost: number
  goalDiff: number
  createdAt: string
}

export interface ChaseSummary {
  players: number
  runs: number
  flawless: number
  myPosition: number | null
  my: { points: number; won: number; drawn: number; lost: number; games: number } | null
  record: ChaseRecord | null
  /** Flawless seasons ever posted (same country filter). */
  recordFlawless: number
}

export interface ChaseStatus {
  attemptsToday: number
  cap: number
  left: number
  resetsAt: string | null
  runs: number
  best: { points: number; won: number; drawn: number; lost: number; games: number } | null
}

export function chaseRowFrom(r: Row): ChaseRow {
  return {
    position: n(r.board_position),
    name: s(r.display_name),
    country: normaliseCountry(s(r.country)),
    team: s(r.team_name),
    leagueId: s(r.league_id),
    games: n(r.games),
    points: n(r.points),
    won: n(r.won),
    drawn: n(r.drawn),
    lost: n(r.lost),
    goalsFor: n(r.goals_for),
    goalsAgainst: n(r.goals_against),
    goalDiff: n(r.goal_diff),
    dropped: n(r.dropped),
    perfect: r.perfect === true,
    leaguePosition: n(r.league_position),
    tier: s(r.tier),
    createdAt: s(r.created_at),
    isMe: r.is_me === true,
    payload: typeof r.payload === 'string' && r.payload ? r.payload : null,
    ratings: r.ratings === 'prime' ? 'prime' : 'season',
    benchPicks: n(r.bench_picks),
  }
}

export function chaseSummaryFrom(v: unknown): ChaseSummary {
  const r = rows(v)[0] ?? {}
  return {
    players: n(r.players),
    runs: n(r.runs),
    flawless: n(r.flawless),
    myPosition: r.my_position == null ? null : n(r.my_position),
    my: r.my_points == null ? null : { points: n(r.my_points), won: n(r.my_won), drawn: n(r.my_drawn), lost: n(r.my_lost), games: n(r.my_games) },
    record:
      r.record_points == null
        ? null
        : { name: s(r.record_display_name), country: normaliseCountry(s(r.record_country)), team: s(r.record_team_name), leagueId: s(r.record_league_id), games: n(r.record_games), points: n(r.record_points), won: n(r.record_won), drawn: n(r.record_drawn), lost: n(r.record_lost), goalDiff: n(r.record_goal_diff), createdAt: s(r.record_created_at) },
    recordFlawless: n(r.record_flawless),
  }
}

export function chaseStatusFrom(v: unknown): ChaseStatus | null {
  const r = rows(v)[0]
  if (!r) return null
  return {
    attemptsToday: n(r.attempts_today),
    cap: n(r.cap),
    left: n(r.attempts_left),
    resetsAt: s(r.resets_at) || null,
    runs: n(r.runs),
    best: r.best_points == null ? null : { points: n(r.best_points), won: n(r.best_won), drawn: n(r.best_drawn), lost: n(r.best_lost), games: n(r.best_games) },
  }
}

/** A week key's Monday for the chase readers (null: the current week). */
const chaseWeek = (scope: ChaseScope, week: string | null) => (scope === 'week' && week ? boardDate('weekly', week) : null)

export async function fetchChaseBoard(t: OnlineTransport, scope: ChaseScope, week: string | null, country: string | null, offset = 0): Promise<ChaseRow[]> {
  return rows(await t.rpc('chase_board', { p_scope: scope, p_week: chaseWeek(scope, week), p_limit: PAGE, p_offset: offset, p_country: normaliseCountry(country) })).map(chaseRowFrom)
}

export async function fetchChaseSummary(t: OnlineTransport, scope: ChaseScope, week: string | null, country: string | null): Promise<ChaseSummary> {
  return chaseSummaryFrom(await t.rpc('chase_summary', { p_scope: scope, p_week: chaseWeek(scope, week), p_country: normaliseCountry(country) }))
}

export async function fetchChaseStatus(t: OnlineTransport): Promise<ChaseStatus | null> {
  return chaseStatusFrom(await t.rpc('chase_my_status', {}))
}

// ------------------------------------------------------------------ the casual boards

/** Which casual board: the Daily Arena, the Weekly Challenge (mode weekly), the Run-in of the week. */
export type CasualKind = 'arena' | 'themed' | 'runin'

export interface CasualRow {
  position: number
  name: string
  country: string | null
  team: string
  /** Arena steps won, or league points. */
  score: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDiff: number
  /** The final league place (the Weekly Challenge, the run-in); null for an arena run. */
  leaguePosition: number | null
  trophy: boolean
  /** The result in a few words: `9 rungs`, `Cup winners`, `CHAMPIONS`, `SURVIVED`. */
  detail: string
  createdAt: string
  isMe: boolean
  revealed: boolean
  /** The run's payload once posting has closed (an arena or quick link to race; a run-in's own payload). */
  payload: string | null
}

export interface CasualSummary {
  played: number
  top: number | null
  trophies: number
  myPosition: number | null
  myScore: number | null
  open: boolean
  revealed: boolean
}

export interface CasualMine {
  board: CasualKind
  key: string
  position: number
  total: number
  score: number
  detail: string
  team: string
  claimMatched: boolean
}

export function casualRowFrom(r: Row): CasualRow {
  return {
    position: n(r.board_position),
    name: s(r.display_name),
    country: normaliseCountry(s(r.country)),
    team: s(r.team_name),
    score: n(r.score),
    won: n(r.won),
    drawn: n(r.drawn),
    lost: n(r.lost),
    goalsFor: n(r.goals_for),
    goalsAgainst: n(r.goals_against),
    goalDiff: n(r.goal_diff),
    leaguePosition: r.league_position == null ? null : n(r.league_position),
    trophy: r.trophy === true,
    detail: s(r.detail),
    createdAt: s(r.created_at),
    isMe: r.is_me === true,
    revealed: r.revealed === true,
    payload: typeof r.payload === 'string' && r.payload ? r.payload : null,
  }
}

export function casualSummaryFrom(v: unknown): CasualSummary {
  const r = rows(v)[0] ?? {}
  return { played: n(r.played), top: r.top_score == null ? null : n(r.top_score), trophies: n(r.trophies), myPosition: r.my_position == null ? null : n(r.my_position), myScore: r.my_score == null ? null : n(r.my_score), open: r.posts_open === true, revealed: r.revealed === true }
}

/** A casual board key as its reader takes it: a `YYYY-MM-DD` day for the Daily Arena, a `YYYY-Www` week otherwise. */
export function casualKeyOk(board: CasualKind, key: string): boolean {
  return board === 'arena' ? /^\d{4}-\d{2}-\d{2}$/.test(key) : weekStartOf(key) !== null
}

export async function fetchCasualBoard(t: OnlineTransport, board: CasualKind, key: string, country: string | null, offset = 0): Promise<CasualRow[]> {
  if (!casualKeyOk(board, key)) return []
  return rows(await t.rpc('casual_board', { p_board: board, p_key: key, p_limit: PAGE, p_offset: offset, p_country: normaliseCountry(country) })).map(casualRowFrom)
}

export async function fetchCasualSummary(t: OnlineTransport, board: CasualKind, key: string, country: string | null): Promise<CasualSummary> {
  if (!casualKeyOk(board, key)) return casualSummaryFrom(null)
  return casualSummaryFrom(await t.rpc('casual_summary', { p_board: board, p_key: key, p_country: normaliseCountry(country) }))
}

/** The caller's own casual entries, newest first (one board, or all three). */
export async function myCasualEntries(t: OnlineTransport, board: CasualKind | null = null): Promise<CasualMine[]> {
  return rows(await t.rpc('casual_my_entries', { p_board: board, p_limit: 30 })).map((r) => ({
    board: (r.board === 'arena' || r.board === 'runin' ? r.board : 'themed') as CasualKind,
    key: s(r.period_key),
    position: n(r.board_position),
    total: n(r.total),
    score: n(r.score),
    detail: s(r.detail),
    team: s(r.team_name),
    claimMatched: r.claim_matched !== false,
  }))
}
