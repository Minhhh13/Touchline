/**
 * The Trophy Room's milestones: badges beyond the engine's twelve
 * (`src/engine/badges.ts`, left as it is), counted from what the cabinet and
 * the profile already keep. Nothing new is stored: every value is read at
 * render from the cabinet's counts, the 50-entry leaderboard, the 38-0 chase,
 * the daily results and the achievements. Most are tiered (bronze, silver,
 * gold); a stamp has one threshold and is gold once earned. Pure: no React, no
 * store, no RNG.
 */
import { ACHIEVEMENTS } from '@engine/awards'
import { TIER_NAMES, type BadgeTier } from '@engine/badges'
import type { Cabinet, LeaderboardEntry, Profile } from '../types'
import { countsAsLeagueSeason, isTitle } from './cabinet'

/** What a milestone reads: the normalised cabinet and the profile's own records. */
export interface MilestoneInput {
  cabinet: Cabinet
  profile: Pick<Profile, 'achievements' | 'leaderboard' | 'quickBests' | 'seasonsSimulated' | 'dailyResults'>
}

export interface MilestoneBadge {
  id: string
  title: string
  /** What the number counts ("Trebles"), or for a stamp what earns it. */
  counts: string
  /** Bronze, silver and gold thresholds, ascending; or one threshold for a stamp (gold once reached). */
  tiers: readonly [number, number, number] | readonly [number]
  /** Counted from the 50 best seasons on the leaderboard (an older or longer career may hold more). */
  fromBoard?: true
  value: (i: MilestoneInput) => number
}

/** The first season start year of the standard (EA-rated) packs: anything earlier is a classic season. */
export const FIRST_STANDARD_SEASON = 2008

const titles = (board: LeaderboardEntry[], also: (e: LeaderboardEntry) => boolean) => board.filter((e) => countsAsLeagueSeason(e.mode) && isTitle(e.position, e.tier) && also(e)).length
const has = (i: MilestoneInput, id: string) => (i.profile.achievements?.[id] ? 1 : 0)

export const MILESTONE_BADGES: readonly MilestoneBadge[] = [
  { id: 'invincibles', title: 'Invincibles', counts: 'unbeaten title seasons', tiers: [1, 3, 10], value: (i) => i.cabinet.invincible },
  { id: 'treble-winners', title: 'Treble Winners', counts: 'Trebles', tiers: [1, 3, 10], value: (i) => i.cabinet.trebles },
  { id: 'double-act', title: 'Double Act', counts: 'Doubles', tiers: [1, 5, 15], value: (i) => i.cabinet.doubles },
  { id: 'continental-kings', title: 'Continental Kings', counts: 'Continental Cups', tiers: [1, 5, 15], value: (i) => i.cabinet.continental },
  { id: 'winning-machine', title: 'Winning Machine', counts: 'straight wins from the first game, best run', tiers: [10, 20, 38], value: (i) => i.profile.quickBests?.longestPerfectRun ?? 0 },
  { id: 'decade', title: 'A Decade in the Dugout', counts: 'Dynasty seasons', tiers: [3, 6, 10], value: (i) => i.cabinet.byMode.dynasty ?? 0 },
  { id: 'old-school', title: 'Old School', counts: 'classic-season titles', tiers: [1, 5, 15], fromBoard: true, value: (i) => titles(i.profile.leaderboard ?? [], (e) => !e.superLeague && e.leagueSeason < FIRST_STANDARD_SEASON) },
  { id: 'moneyball', title: 'Moneyball', counts: 'titles under a salary cap', tiers: [1, 3, 10], fromBoard: true, value: (i) => titles(i.profile.leaderboard ?? [], (e) => e.budget !== undefined) },
  { id: 'perfect-day', title: 'Perfect Day', counts: 'perfect Daily seasons', tiers: [1, 3, 10], value: (i) => Object.values(i.profile.dailyResults ?? {}).filter((r) => r.tier === 'PERFECT').length },
  { id: 'summit', title: 'Summit', counts: 'Gauntlets completed', tiers: [1, 3, 10], value: (i) => i.cabinet.gauntlet.complete },
  { id: 'long-road', title: 'The Long Road', counts: '32-club Cups won', tiers: [1, 3, 10], value: (i) => i.cabinet.cups.bySize['32'] ?? 0 },
  { id: 'under-the-lights', title: 'Under the Lights', counts: 'Daily Arena days', tiers: [7, 30, 100], value: (i) => i.cabinet.arenaDailies },
  { id: 'hot-seat', title: 'Hot Seat', counts: 'head-to-head seasons', tiers: [1, 10, 30], value: (i) => i.cabinet.h2h.played + (i.cabinet.h2hOnline?.played ?? 0) },
  { id: 'old-hand', title: 'Old Hand', counts: 'seasons played', tiers: [10, 50, 200], value: (i) => i.profile.seasonsSimulated ?? 0 },
  { id: 'completist', title: 'Completist', counts: 'achievements unlocked', tiers: [10, 20, ACHIEVEMENTS.length], value: (i) => ACHIEVEMENTS.filter((a) => i.profile.achievements?.[a.id]).length },
  // Stamps: earned once, from the achievement that marks them
  { id: 'golden-boot', title: 'Golden Boot', counts: 'a 30-goal top scorer in your squad', tiers: [1], value: (i) => has(i, 'boot30') },
  { id: 'the-wall', title: 'The Wall', counts: '20 clean sheets for one of your keepers', tiers: [1], value: (i) => has(i, 'glove20') },
  { id: 'chain-gang', title: 'Chain Gang', counts: 'a title with an unbroken teammate chain', tiers: [1], value: (i) => has(i, 'chain-champions') },
  { id: 'loyalty', title: 'One-Club Wonder', counts: 'a title from a one-club draft', tiers: [1], value: (i) => has(i, 'one-club-champions') },
]

export interface MilestoneState {
  badge: MilestoneBadge
  value: number
  tier: BadgeTier | null
  /** "3 of 5 for silver", "0 of 1", or "Gold". */
  progress: string
  /** Share of the way to the next threshold, 0..1 (1 at gold). */
  toward: number
  stamp: boolean
}

/** The tier a value has reached: a stamp is gold once earned. */
export function milestoneTier(tiers: readonly number[], value: number): BadgeTier | null {
  if (tiers.length === 1) return value >= tiers[0] ? 'gold' : null
  for (let i = tiers.length - 1; i >= 0; i--) if (value >= tiers[i]) return TIER_NAMES[i]
  return null
}

/** "3 of 5 for silver"; a stamp reads "Not yet" until it is earned; "Gold" once there is nothing left to reach. */
export function milestoneProgress(tiers: readonly number[], value: number): string {
  const next = tiers.findIndex((t) => value < t)
  if (next === -1) return 'Gold'
  if (tiers.length === 1) return 'Not yet'
  return `${value} of ${tiers[next]} for ${TIER_NAMES[next]}`
}

/** Every milestone with its value, tier, progress line and share towards the next threshold, in `MILESTONE_BADGES` order. */
export function milestoneStates(i: MilestoneInput): MilestoneState[] {
  return MILESTONE_BADGES.map((badge) => {
    const value = Math.max(0, badge.value(i))
    const next = badge.tiers.find((t) => value < t)
    const prev = [...badge.tiers].reverse().find((t) => value >= t) ?? 0
    const toward = next === undefined ? 1 : Math.max(0, Math.min(1, (value - prev) / Math.max(1, next - prev)))
    return { badge, value, tier: milestoneTier(badge.tiers, value), progress: milestoneProgress(badge.tiers, value), toward, stamp: badge.tiers.length === 1 }
  })
}

/** Milestones earned (any tier), for the Trophy Room's heading. */
export function milestonesEarned(states: MilestoneState[]): number {
  return states.filter((s) => s.tier).length
}
