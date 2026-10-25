/**
 * Squad status and playing-time expectations. Every contract carries a status
 * that says how much football the player expects; the minutes he actually gets
 * over the last six matchweeks move his morale against that expectation, and a
 * signing's status sets his wage demand and whether he signs at all.
 */
import type { PlayerSeason, SquadPlayer } from './types'

export type SquadStatus = 'key' | 'first-team' | 'rotation' | 'backup' | 'prospect'

/** Statuses from the most to the least football expected. */
export const STATUSES: SquadStatus[] = ['key', 'first-team', 'rotation', 'backup', 'prospect']

export const STATUS_LABEL: Record<SquadStatus, string> = {
  key: 'Key player',
  'first-team': 'First team',
  rotation: 'Rotation',
  backup: 'Backup',
  prospect: 'Prospect',
}

/** Share of the available minutes a player on each status expects to play. */
export const EXPECTED_SHARE: Record<SquadStatus, number> = {
  key: 0.85,
  'first-team': 0.65,
  rotation: 0.35,
  backup: 0.15,
  prospect: 0.1,
}

/** Wage demanded on signing, as a multiple of the player-season's listed wage. */
export const WAGE_MULT: Record<SquadStatus, number> = {
  key: 1.25,
  'first-team': 1.1,
  rotation: 1,
  backup: 0.9,
  prospect: 0.8,
}

/** Matchweeks of minutes kept per player. */
export const RECENT_WEEKS = 6
/** Minutes one matchweek offers; a cup week offers more, so the share is capped at 1. */
export const MINUTES_PER_WEEK = 90
/** Gap between expected and actual share that is tolerated without any morale drift. */
export const SHARE_TOLERANCE = 0.15
/** Weekly morale drift is clamped to this many points either way. */
export const MAX_WEEKLY_DRIFT = 5

/** Rank of a status for upgrade/downgrade comparisons (higher expects more). */
export const STATUS_RANK: Record<SquadStatus, number> = { key: 4, 'first-team': 3, rotation: 2, backup: 1, prospect: 0 }

export interface StatusCandidate {
  id: string
  overall: number
  age: number
}

/**
 * Status by rank in the squad: the top four by overall are key players, the
 * next seven first team, the next six rotation, the rest backup. Anyone aged 21
 * or under who rates below the squad median is a prospect instead. A player
 * outside the strongest eleven starts one step lower than his rank says (a
 * second striker rated fourth in the squad is first team, not a key player),
 * because the shape, not his rating, decides how much he can play.
 */
export function defaultStatuses(squad: StatusCandidate[], startingXI?: Set<string>): Record<string, SquadStatus> {
  const sorted = [...squad].sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id))
  const median = medianOf(sorted.map((x) => x.overall))
  const out: Record<string, SquadStatus> = {}
  sorted.forEach((x, i) => {
    if (x.age <= 21 && x.overall < median) out[x.id] = 'prospect'
    else {
      const byRank = statusForRank(i)
      out[x.id] = startingXI && !startingXI.has(x.id) ? stepDown(byRank) : byRank
    }
  })
  return out
}

function stepDown(status: SquadStatus): SquadStatus {
  return status === 'key' ? 'first-team' : status === 'first-team' ? 'rotation' : status === 'rotation' ? 'backup' : status
}

/** The status a player of this standing would hold if he joined a squad with these overalls (sorted descending). */
export function naturalStatus(p: Pick<PlayerSeason, 'overall' | 'age'>, squadOveralls: number[]): SquadStatus {
  const sorted = [...squadOveralls].sort((a, b) => b - a)
  const rank = sorted.findIndex((o) => p.overall > o)
  const i = rank < 0 ? sorted.length : rank
  const median = medianOf(sorted)
  return p.age <= 21 && p.overall < median ? 'prospect' : statusForRank(i)
}

function statusForRank(i: number): SquadStatus {
  if (i < 4) return 'key'
  if (i < 11) return 'first-team'
  if (i < 17) return 'rotation'
  return 'backup'
}

function medianOf(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Share of the available minutes played over the recorded matchweeks (0..1),
 * or null before any matchweek has been recorded. Cup minutes count, so a week
 * with two matches can exceed 90 and the share is capped at 1.
 */
export function minutesShare(recentMinutes: number[]): number | null {
  if (!recentMinutes.length) return null
  const total = recentMinutes.reduce((s, m) => s + m, 0)
  return Math.min(1, total / (MINUTES_PER_WEEK * recentMinutes.length))
}

/**
 * Weekly morale drift from playing time against the status: a player short of
 * his expected share by more than the tolerance loses morale, faster the bigger
 * the gap and the less professional he is; one given more than he expects
 * gains a little. Clamped to ±5 a week.
 */
export function statusMoraleDrift(state: SquadPlayer, player: PlayerSeason, status: SquadStatus, share: number): number {
  const gap = share - EXPECTED_SHARE[status]
  let delta = 0
  if (gap < -SHARE_TOLERANCE) {
    const prof = 1.3 - player.traits.professionalism * 0.6
    delta = (gap + SHARE_TOLERANCE) * 12 * prof
  } else if (gap > SHARE_TOLERANCE) {
    delta = (gap - SHARE_TOLERANCE) * 4
  }
  delta = Math.max(-MAX_WEEKLY_DRIFT, Math.min(MAX_WEEKLY_DRIFT, delta))
  state.morale = clamp(state.morale + delta, 10, 100)
  return delta
}

export interface StatusAnswer {
  ok: boolean
  /** Why he refused, when he did. */
  reason?: string
  /** The lowest status he would accept, when he refused. */
  counter?: SquadStatus
}

/**
 * Would this player sign on the offered status? Anyone who would be among the
 * buyer's four best refuses rotation or lower; anyone at or above the median
 * refuses backup; prospect is for players aged 21 or under only.
 */
export function acceptsStatus(p: Pick<PlayerSeason, 'name' | 'overall' | 'age'>, squadOveralls: number[], status: SquadStatus): StatusAnswer {
  const sorted = [...squadOveralls].sort((a, b) => b - a)
  const fourth = sorted[3]
  const median = medianOf(sorted)
  if (status === 'prospect' && p.age > 21) return { ok: false, reason: `${p.name} is ${p.age}. He is nobody's prospect.`, counter: naturalStatus(p, squadOveralls) }
  if (fourth !== undefined && p.overall >= fourth && STATUS_RANK[status] <= STATUS_RANK.rotation) {
    return { ok: false, reason: `${p.name} would be one of your best players. He will not sign as ${STATUS_LABEL[status].toLowerCase()}; first team at least.`, counter: 'first-team' }
  }
  if (sorted.length && p.overall >= median && STATUS_RANK[status] <= STATUS_RANK.backup) {
    return { ok: false, reason: `${p.name} is better than half your squad. He will not sign as ${STATUS_LABEL[status].toLowerCase()}; rotation at least.`, counter: 'rotation' }
  }
  return { ok: true }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Status after a rank-based promotion or demotion, for the UI and the morale swing. */
export function statusChange(from: SquadStatus, to: SquadStatus): 'up' | 'down' | 'same' {
  const d = STATUS_RANK[to] - STATUS_RANK[from]
  return d > 0 ? 'up' : d < 0 ? 'down' : 'same'
}
