import { describe, expect, it } from 'vitest'
import { previousWeeklySeed } from '@engine/rng'
import { weeklyRecord } from '../logic/weeklyRecord'
import type { LeaderboardEntry, Profile } from '../types'

const run = (seed: string, points: number, lost = 3, mode: LeaderboardEntry['mode'] = 'weekly'): LeaderboardEntry => ({ id: `${seed}-${points}`, date: '2026-10-26', mode, teamName: 'T', points, won: Math.floor(points / 3), drawn: points % 3, lost, position: 1, tier: 'CHAMPIONS', seed, leagueSeason: 2020, leagueId: 'england', hostClubId: 'wolves', xi: [] })

describe('the weekly record', () => {
  it('is empty before the first weekly', () => {
    const r = weeklyRecord({ leaderboard: [] }, 'weekly-2026-W44', previousWeeklySeed)
    expect(r).toEqual({ counted: null, best: null, plays: 0, streak: 0, streakAtRisk: false, lastWeek: null, recent: [{ week: '2026-W40', points: null }, { week: '2026-W41', points: null }, { week: '2026-W42', points: null }, { week: '2026-W43', points: null }] })
  })

  it('keeps the counted result apart from a better replay, and the streak alive from last week', () => {
    const profile: Pick<Profile, 'weekly' | 'leaderboard'> = {
      weekly: { streak: 3, last: 'weekly-2026-W43', results: { 'weekly-2026-W41': { points: 70, tier: 'EUROPEAN' }, 'weekly-2026-W42': { points: 80, tier: 'CHAMPIONS' }, 'weekly-2026-W43': { points: 88, tier: 'CHAMPIONS' } } },
      leaderboard: [run('weekly-2026-W43', 88), run('weekly-2026-W43', 91, 1), run('weekly-2026-W43', 99, 0, 'quick')],
    }
    const before = weeklyRecord(profile, 'weekly-2026-W44', previousWeeklySeed)
    expect(before.counted).toBeNull()
    expect(before.streak).toBe(3)
    expect(before.streakAtRisk).toBe(true)
    expect(before.lastWeek).toEqual({ points: 88, tier: 'CHAMPIONS' })
    expect(before.recent.map((x) => x.points)).toEqual([null, 70, 80, 88])
    const last = weeklyRecord(profile, 'weekly-2026-W43', previousWeeklySeed)
    expect(last.counted).toEqual({ points: 88, tier: 'CHAMPIONS', record: '29-1-3' })
    // A Quick Draft on the same seed is not a weekly run
    expect(last.best).toEqual({ points: 91, tier: 'CHAMPIONS', record: '30-1-1' })
    expect(last.plays).toBe(2)
    expect(last.streakAtRisk).toBe(false)
  })

  it("names the counted run's own record when a later run tied its points with fewer losses (r8 audit)", () => {
    const first: LeaderboardEntry = { ...run('weekly-2026-W43', 80), won: 26, drawn: 2, lost: 10, date: '2026-10-20' }
    const later: LeaderboardEntry = { ...run('weekly-2026-W43', 80), id: 'later', won: 25, drawn: 5, lost: 8, date: '2026-10-22' }
    // The board sorts the later run first (fewer losses)
    const profile: Pick<Profile, 'weekly' | 'leaderboard'> = { weekly: { streak: 1, last: 'weekly-2026-W43', results: { 'weekly-2026-W43': { points: 80, tier: 'CHAMPIONS' } } }, leaderboard: [later, first] }
    expect(weeklyRecord(profile, 'weekly-2026-W43', previousWeeklySeed).counted).toEqual({ points: 80, tier: 'CHAMPIONS', record: '26-2-10' })
    // Two the same day with different records: which counted cannot be told, so no record is named
    const sameDay = { ...profile, leaderboard: [{ ...later, date: first.date }, first] }
    expect(weeklyRecord(sameDay, 'weekly-2026-W43', previousWeeklySeed).counted).toEqual({ points: 80, tier: 'CHAMPIONS' })
  })

  it('reads a streak as ended once a week was missed', () => {
    const profile: Pick<Profile, 'weekly' | 'leaderboard'> = { weekly: { streak: 5, last: 'weekly-2026-W41', results: { 'weekly-2026-W41': { points: 60, tier: 'MID_TABLE' } } }, leaderboard: [] }
    const r = weeklyRecord(profile, 'weekly-2026-W44', previousWeeklySeed)
    expect(r.streak).toBe(0)
    expect(r.streakAtRisk).toBe(false)
    expect(r.lastWeek).toBeNull()
  })
})
