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
