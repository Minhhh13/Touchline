import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '@engine/awards'
import { BADGES } from '@engine/badges'
import { emptyCabinet, normaliseCabinet } from '../logic/cabinet'
import { FIRST_STANDARD_SEASON, MILESTONE_BADGES, milestoneProgress, milestonesEarned, milestoneStates, milestoneTier, type MilestoneInput } from '../logic/milestoneBadges'
import type { LeaderboardEntry, Profile } from '../types'

const entry = (o: Partial<LeaderboardEntry>): LeaderboardEntry => ({ id: 'x', date: '2026-10-26', mode: 'quick', teamName: 'T', points: 80, won: 25, drawn: 5, lost: 8, position: 1, tier: 'CHAMPIONS', seed: 's', leagueSeason: 2020, hostClubId: 'arsenal', xi: [], ...o })
const profile = (o: Partial<Profile> = {}): MilestoneInput['profile'] => ({ achievements: {}, leaderboard: [], seasonsSimulated: 0, dailyResults: {}, ...o })
const valueOf = (states: ReturnType<typeof milestoneStates>, id: string) => states.find((s) => s.badge.id === id)!

describe('Trophy Room milestones', () => {
  it('has unique ids, none shared with the engine’s badges, ascending thresholds and achievable golds', () => {
    const ids = MILESTONE_BADGES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const b of BADGES) expect(ids).not.toContain(b.id)
    for (const b of MILESTONE_BADGES) {
      expect([1, 3]).toContain(b.tiers.length)
      for (let i = 1; i < b.tiers.length; i++) expect(b.tiers[i]).toBeGreaterThan(b.tiers[i - 1])
      expect(b.title).toMatch(/^[A-Z]/)
    }
    expect(MILESTONE_BADGES.find((b) => b.id === 'completist')!.tiers[2]).toBe(ACHIEVEMENTS.length)
    expect(MILESTONE_BADGES.find((b) => b.id === 'winning-machine')!.tiers[2]).toBe(38)
  })

  it('starts every milestone locked on an empty cabinet and an empty profile', () => {
    const states = milestoneStates({ cabinet: emptyCabinet(), profile: profile() })
    expect(states).toHaveLength(MILESTONE_BADGES.length)
    for (const s of states) {
      expect(s.value).toBe(0)
      expect(s.tier).toBeNull()
      expect(s.toward).toBe(0)
    }
    expect(milestonesEarned(states)).toBe(0)
    // An older save's cabinet without the optional shelves reads the same
    expect(milestoneStates({ cabinet: normaliseCabinet({}), profile: { achievements: {}, leaderboard: [] } as never }).every((s) => s.value === 0)).toBe(true)
  })

  it('counts the cabinet, the leaderboard, the chase, the dailies and the achievements', () => {
    const cabinet = { ...emptyCabinet(), invincible: 3, trebles: 1, doubles: 5, continental: 2, byMode: { dynasty: 10 }, arenaDailies: 8, gauntlet: { runs: 4, best: 15, complete: 2 }, cups: { runs: 5, won: 3, bySize: { '32': 1 } }, h2h: { played: 7 }, h2hOnline: { played: 3, won: 1 } }
    const leaderboard = [
      entry({ leagueSeason: 1995 }),
      entry({ leagueSeason: 2003, mode: 'dynasty' }),
      entry({ leagueSeason: 1999, position: 2, tier: 'TITLE_RACE' }),
      entry({ leagueSeason: 1999, superLeague: true }),
      entry({ leagueSeason: 2015, budget: 150, spent: 140 }),
      entry({ leagueSeason: FIRST_STANDARD_SEASON, budget: 200, spent: 190, position: 1, tier: 'RELEGATED' }),
      entry({ leagueSeason: 2001, mode: 'arena' }),
    ]
    const achievements = Object.fromEntries(ACHIEVEMENTS.slice(0, 12).map((a) => [a.id, '2026-10-01']))
    achievements['boot30'] = '2026-10-02'
    const states = milestoneStates({ cabinet, profile: profile({ leaderboard, achievements, seasonsSimulated: 51, quickBests: { longestPerfectRun: 22 }, dailyResults: { 'daily-2026-10-01': { points: 114, tier: 'PERFECT' }, 'daily-2026-10-02': { points: 80, tier: 'CHAMPIONS' } } }) })
    expect(valueOf(states, 'invincibles')).toMatchObject({ value: 3, tier: 'silver' })
    expect(valueOf(states, 'treble-winners')).toMatchObject({ value: 1, tier: 'bronze', progress: '1 of 3 for silver' })
    expect(valueOf(states, 'double-act')).toMatchObject({ value: 5, tier: 'silver' })
    expect(valueOf(states, 'continental-kings').value).toBe(2)
    expect(valueOf(states, 'winning-machine')).toMatchObject({ value: 22, tier: 'silver' })
    expect(valueOf(states, 'decade')).toMatchObject({ value: 10, tier: 'gold', progress: 'Gold', toward: 1 })
    // Classic titles: league seasons before 2008-09, never a runner-up, a Super League side or an arena run
    expect(valueOf(states, 'old-school').value).toBe(2)
    // A relegated season is no title, even in first place
    expect(valueOf(states, 'moneyball').value).toBe(1)
    expect(valueOf(states, 'perfect-day').value).toBe(1)
    expect(valueOf(states, 'summit').value).toBe(2)
    expect(valueOf(states, 'long-road').value).toBe(1)
    expect(valueOf(states, 'under-the-lights')).toMatchObject({ value: 8, tier: 'bronze' })
    expect(valueOf(states, 'hot-seat')).toMatchObject({ value: 10, tier: 'silver' })
    expect(valueOf(states, 'old-hand')).toMatchObject({ value: 51, tier: 'silver' })
    expect(valueOf(states, 'completist').value).toBe(ACHIEVEMENTS.slice(0, 12).some((a) => a.id === 'boot30') ? 12 : 13)
    expect(valueOf(states, 'golden-boot')).toMatchObject({ value: 1, tier: 'gold', stamp: true, progress: 'Gold' })
    expect(valueOf(states, 'the-wall')).toMatchObject({ value: ACHIEVEMENTS.slice(0, 12).some((a) => a.id === 'glove20') ? 1 : 0, stamp: true })
    expect(valueOf(states, 'chain-gang')).toMatchObject({ value: 0, tier: null, progress: 'Not yet' })
    expect(milestonesEarned(states)).toBeGreaterThanOrEqual(14)
  })

  it('shows the way to the next tier', () => {
    expect(milestoneTier([1, 5, 20], 0)).toBeNull()
    expect(milestoneTier([1, 5, 20], 5)).toBe('silver')
    expect(milestoneTier([1], 1)).toBe('gold')
    expect(milestoneProgress([1, 5, 20], 3)).toBe('3 of 5 for silver')
    expect(milestoneProgress([1, 5, 20], 25)).toBe('Gold')
    expect(milestoneProgress([1], 0)).toBe('Not yet')
    const s = valueOf(milestoneStates({ cabinet: { ...emptyCabinet(), doubles: 3 }, profile: profile() }), 'double-act')
    // From bronze (1) to silver (5): two of four steps
    expect(s.toward).toBe(0.5)
  })
})
