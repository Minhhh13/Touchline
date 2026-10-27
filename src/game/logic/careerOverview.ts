import type { Cabinet, Mode, Profile } from '../types'
import { MODE_TITLE } from './modes'

/**
 * The Profile page's career overview (display only, pure): what the manager has played, mode by mode, and the
 * record of his best seasons. Counts come from the cabinet (every result credited); the record comes from the best
 * seasons kept on the leaderboard (at most 50), and says how many it covers.
 */

export interface CareerOverview {
  /** Results credited, every mode. */
  results: number
  /** Results per mode, most played first (modes never played left out). */
  byMode: Array<{ mode: Mode; label: string; count: number }>
  /** League seasons kept on the leaderboard: the base of the record below. */
  kept: number
  /** Their league matches. */
  record: { won: number; drawn: number; lost: number; games: number }
  /** Share of those matches won, in whole per cent; null with no games. */
  winRate: number | null
  /** Points per game across them, to one decimal; null with no games. */
  pointsPerGame: number | null
  /** Seasons finished first among them. */
  firstPlaces: number
  /** League titles in the cabinet against league seasons played (every one, not just those kept), in whole per cent. */
  titleRate: number | null
  /** The clubs whose place he took most often, most first (ties by the latest), at most three, each at least twice. */
  regulars: Array<{ clubId: string; seasons: number }>
}

const LEAGUE_MODES: Mode[] = ['quick', 'daily', 'weekly', 'season', 'dynasty']

export function careerOverview(profile: Pick<Profile, 'leaderboard'>, cabinet: Pick<Cabinet, 'byMode' | 'league'>): CareerOverview {
  const byMode = (Object.keys(MODE_TITLE) as Mode[])
    .map((mode) => ({ mode, label: MODE_TITLE[mode], count: cabinet.byMode[mode] ?? 0 }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const results = byMode.reduce((s, m) => s + m.count, 0)
  const board = profile.leaderboard.filter((e) => LEAGUE_MODES.includes(e.mode))
  const record = board.reduce((r, e) => ({ won: r.won + e.won, drawn: r.drawn + e.drawn, lost: r.lost + e.lost, games: r.games + e.won + e.drawn + e.lost }), { won: 0, drawn: 0, lost: 0, games: 0 })
  const points = board.reduce((s, e) => s + e.points, 0)
  const leagueSeasons = LEAGUE_MODES.reduce((s, m) => s + (cabinet.byMode[m] ?? 0), 0)
  const hosts = new Map<string, { seasons: number; last: string }>()
  for (const e of board) {
    if (e.superLeague || !e.hostClubId) continue
    const h = hosts.get(e.hostClubId) ?? { seasons: 0, last: '' }
    hosts.set(e.hostClubId, { seasons: h.seasons + 1, last: e.date > h.last ? e.date : h.last })
  }
  const regulars = [...hosts.entries()]
    .filter(([, h]) => h.seasons >= 2)
    .sort((a, b) => b[1].seasons - a[1].seasons || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([clubId, h]) => ({ clubId, seasons: h.seasons }))
  return {
    results,
    byMode,
    kept: board.length,
    record,
    winRate: record.games ? Math.round((record.won / record.games) * 100) : null,
    pointsPerGame: record.games ? Math.round((points / record.games) * 10) / 10 : null,
    firstPlaces: board.filter((e) => e.position === 1).length,
    titleRate: leagueSeasons ? Math.min(100, Math.round((cabinet.league / leagueSeasons) * 100)) : null,
    regulars,
  }
}

export type AchievementView = 'all' | 'unlocked' | 'locked'

/**
 * The achievements as the Profile lists them: unlocked first (the newest first, then catalogue order), then the
 * locked in catalogue order; `view` keeps one half.
 */
export function orderAchievements<A extends { id: string }>(all: readonly A[], unlocked: Record<string, string>, view: AchievementView = 'all'): A[] {
  const at = new Map(all.map((a, i) => [a.id, i]))
  const won = all.filter((a) => unlocked[a.id]).sort((a, b) => unlocked[b.id].localeCompare(unlocked[a.id]) || at.get(a.id)! - at.get(b.id)!)
  const locked = all.filter((a) => !unlocked[a.id])
  return view === 'unlocked' ? won : view === 'locked' ? locked : [...won, ...locked]
}
