import { describe, expect, it } from 'vitest'
import type { OnlineTransport } from '../transport'
import { fetchAlltimeMine, fetchChaseBoard, fetchChaseStatus, fetchChaseSummary, myEntries, PAGE, rankOf } from '../boards'

/**
 * The board readers the Daily, weekly, all-time and chase screens call (r10): the database reader each one asks, with
 * which arguments, and how its rows are read. A transport that answers each reader from a table and records the calls.
 */
function transport(answers: Record<string, unknown>) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const t = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args])
      return answers[fn] ?? null
    },
  }
  return { t: t as unknown as OnlineTransport, calls }
}

describe('the board readers', () => {
  it('places a result not on the board: the Daily by its date, the weekly by its Monday, nothing for a bad key', async () => {
    const { t, calls } = transport({ daily_rank: 7, weekly_rank: 'seven' })
    const r = { points: 61, lost: 9, goalDiff: 12, goalsFor: 58 }
    expect(await rankOf(t, 'daily', '2026-10-29', r, ' gb ')).toBe(7)
    expect(calls[0]).toEqual(['daily_rank', { p_date: '2026-10-29', p_points: 61, p_lost: 9, p_goal_diff: 12, p_goals_for: 58, p_country: 'GB' }])
    // Anything but a number is no place
    expect(await rankOf(t, 'weekly', '2026-W44', r, null)).toBeNull()
    expect(calls[1]).toEqual(['weekly_rank', { p_week: '2026-10-26', p_points: 61, p_lost: 9, p_goal_diff: 12, p_goals_for: 58, p_country: null }])
    expect(await rankOf(t, 'daily', 'yesterday', r, null)).toBeNull()
    expect(await rankOf(t, 'weekly', '2026-W99', r, null)).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it("reads the caller's all-time line, or nothing while they are not on the board", async () => {
    const row = { board_position: '3', players: 120, display_name: 'Minh', country: 'vn', total_points: 1234, played: 20, best_streak: 9, current_streak: 4, last_date: '2026-10-28' }
    const on = transport({ daily_alltime_mine: [row] })
    expect(await fetchAlltimeMine(on.t, 'streak', 'VN')).toEqual({ position: 3, players: 120, name: 'Minh', country: 'VN', totalPoints: 1234, played: 20, bestStreak: 9, currentStreak: 4, lastDate: '2026-10-28' })
    expect(on.calls[0]).toEqual(['daily_alltime_mine', { p_order: 'streak', p_country: 'VN' }])
    for (const answer of [[], null, [{ ...row, board_position: null }]]) expect(await fetchAlltimeMine(transport({ daily_alltime_mine: answer }).t, 'points', null)).toBeNull()
  })

  it("lists the caller's own entries, keyed by date or week, a missing claim flag read as matched", async () => {
    const { t, calls } = transport({
      daily_my_entries: [{ puzzle_date: '2026-10-28', board_position: 4, total: 90, points: 70, won: 21, drawn: 7, lost: 10, tier: 'TOP_FOUR', team_name: 'Minh FC' }],
      weekly_my_entries: [{ week_key: '2026-W43', board_position: 1, total: 12, points: 80, won: 25, drawn: 5, lost: 8, tier: 'CHAMPIONS', team_name: 'Minh FC', claim_matched: false }, { week_start: '2026-10-12' }],
    })
    expect(await myEntries(t, 'daily')).toEqual([{ key: '2026-10-28', position: 4, total: 90, points: 70, won: 21, drawn: 7, lost: 10, tier: 'TOP_FOUR', team: 'Minh FC', claimMatched: true }])
    const weekly = await myEntries(t, 'weekly')
    expect(weekly.map((e) => [e.key, e.claimMatched])).toEqual([['2026-W43', false], ['2026-10-12', true]])
    expect(weekly[1]).toMatchObject({ position: 0, points: 0, team: '' })
    expect(calls.map((c) => c[1])).toEqual([{ p_limit: 30 }, { p_limit: 30 }])
  })

  it('asks the chase readers for a week by its Monday, and for all time with no week', async () => {
    const { t, calls } = transport({
      chase_board: [{ board_position: 1, display_name: 'Carol', league_id: 'england', games: 38, points: 114, won: 38, perfect: true, ratings: 'prime', bench_picks: 1 }],
      chase_summary: [{ players: 3, runs: 5, flawless: 1, my_position: 2, my_points: 100, my_won: 32, my_drawn: 4, my_lost: 2, my_games: 38 }],
      chase_my_status: [{ attempts_today: 1, cap: 5, attempts_left: 4, resets_at: '', runs: 0, best_points: null }],
    })
    const rows = await fetchChaseBoard(t, 'week', '2026-W44', 'fr', 50)
    expect(rows[0]).toMatchObject({ position: 1, name: 'Carol', perfect: true, ratings: 'prime', benchPicks: 1, payload: null, isMe: false })
    expect(calls[0]).toEqual(['chase_board', { p_scope: 'week', p_week: '2026-10-26', p_limit: PAGE, p_offset: 50, p_country: 'FR' }])
    await fetchChaseBoard(t, 'alltime', '2026-W44', null)
    expect(calls[1][1]).toMatchObject({ p_scope: 'alltime', p_week: null, p_offset: 0 })
    // The current week when none is named
    await fetchChaseSummary(t, 'week', null, null)
    expect(calls[2]).toEqual(['chase_summary', { p_scope: 'week', p_week: null, p_country: null }])
    expect(await fetchChaseSummary(t, 'alltime', null, null)).toMatchObject({ players: 3, myPosition: 2, my: { points: 100, won: 32, games: 38 }, record: null })
    expect(await fetchChaseStatus(t)).toEqual({ attemptsToday: 1, cap: 5, left: 4, resetsAt: null, runs: 0, best: null })
    expect(calls.at(-1)).toEqual(['chase_my_status', {}])
    expect(await fetchChaseStatus(transport({}).t)).toBeNull()
  })
})
