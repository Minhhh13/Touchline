/**
 * Trophy Room badges: twelve tiered counters read off the profile's cabinet.
 * Pure. The cabinet itself is a save type (`Cabinet` in `src/game/types.ts`);
 * the engine reads it through `BadgeCabinet`, the fields a badge counts, so
 * nothing here imports the game layer.
 */

/** The cabinet fields a badge reads. `Cabinet` satisfies it. */
export interface BadgeCabinet {
  league: number
  cup: number
  perfect: number
  centurions: number
  hostsTitled: string[]
  nationsTitled: string[]
  dailies: number
  weeklies: number
  gauntlet: { best: number }
  cups: { won: number }
  giantKills: number
  runIns: { met: number }
}

/** Counts worked out at render rather than stored: leagues won in comes from the hosts' leagues. */
export interface BadgeDerived {
  leaguesWon: number
}

export type BadgeTier = 'bronze' | 'silver' | 'gold'

export const TIER_NAMES: readonly BadgeTier[] = ['bronze', 'silver', 'gold']

export interface Badge {
  id: string
  title: string
  icon: string
  /** What the number counts, for the Trophy Room ("league titles"). */
  counts: string
  /** Thresholds for bronze, silver and gold, ascending. */
  tiers: readonly [number, number, number]
  value: (cabinet: BadgeCabinet, derived: BadgeDerived) => number
}

export const BADGES: readonly Badge[] = [
  { id: 'serial-winner', title: 'Serial Winner', icon: '🏆', counts: 'league titles', tiers: [1, 5, 20], value: (c) => c.league },
  { id: 'centurion', title: 'Centurion', icon: '💯', counts: '100-point seasons', tiers: [1, 5, 15], value: (c) => c.centurions },
  { id: 'perfectionist', title: 'Perfectionist', icon: '💎', counts: 'perfect seasons', tiers: [1, 3, 10], value: (c) => c.perfect },
  { id: 'cup-collector', title: 'Cup Collector', icon: '🥇', counts: 'cups, season and arena', tiers: [1, 5, 20], value: (c) => c.cup + c.cups.won },
  { id: 'globetrotter', title: 'Globetrotter', icon: '🧭', counts: 'leagues won in', tiers: [2, 4, 7], value: (_c, d) => d.leaguesWon },
  { id: 'international', title: 'International', icon: '🏳️', counts: 'nations titled in one-nation drafts', tiers: [1, 3, 8], value: (c) => c.nationsTitled.length },
  { id: 'grounds-tour', title: 'Grounds Tour', icon: '🏟️', counts: 'different clubs titled', tiers: [5, 15, 40], value: (c) => c.hostsTitled.length },
  { id: 'regular', title: 'Regular', icon: '📅', counts: 'daily challenges', tiers: [7, 30, 100], value: (c) => c.dailies },
  { id: 'sunday-league', title: 'Sunday League', icon: '🗓️', counts: 'weekly challenges', tiers: [4, 12, 52], value: (c) => c.weeklies },
  { id: 'ironman', title: 'Ironman', icon: '🪜', counts: 'rungs in your best Gauntlet', tiers: [5, 10, 15], value: (c) => c.gauntlet.best },
  { id: 'giant-killer', title: 'Giant Killer', icon: '🪓', counts: 'arena wins on Realistic over 85+ sides', tiers: [1, 10, 50], value: (c) => c.giantKills },
  { id: 'survival-artist', title: 'Survival Artist', icon: '🛟', counts: 'run-in briefs met', tiers: [1, 5, 20], value: (c) => c.runIns.met },
]

/** The highest tier `value` has reached, or null below bronze. */
export function badgeTier(badge: Pick<Badge, 'tiers'>, value: number): BadgeTier | null {
  for (let i = badge.tiers.length - 1; i >= 0; i--) if (value >= badge.tiers[i]) return TIER_NAMES[i]
  return null
}

/** "3 of 5 for silver", or "Gold" once there is nothing left to reach. */
export function badgeProgress(badge: Pick<Badge, 'tiers'>, value: number): string {
  const next = badge.tiers.findIndex((t) => value < t)
  if (next === -1) return 'Gold'
  return `${value} of ${badge.tiers[next]} for ${TIER_NAMES[next]}`
}

export interface BadgeState {
  badge: Badge
  value: number
  tier: BadgeTier | null
  progress: string
}

/** Every badge with its value, tier and progress line, in `BADGES` order. */
export function badgeStates(cabinet: BadgeCabinet, derived: BadgeDerived): BadgeState[] {
  return BADGES.map((badge) => {
    const value = badge.value(cabinet, derived)
    return { badge, value, tier: badgeTier(badge, value), progress: badgeProgress(badge, value) }
  })
}

/**
 * The `n` badges a manager card shows: highest tier first, then the furthest
 * along towards the next tier, then `BADGES` order. Badges at zero come last.
 */
export function topBadges(states: BadgeState[], n = 6): BadgeState[] {
  const rank = (s: BadgeState) => (s.tier ? TIER_NAMES.indexOf(s.tier) + 1 : 0)
  const towards = (s: BadgeState) => {
    const next = s.badge.tiers.find((t) => s.value < t)
    return next === undefined ? 1 : s.value / next
  }
  return states
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(b.s) - rank(a.s) || towards(b.s) - towards(a.s) || a.i - b.i)
    .slice(0, n)
    .map((x) => x.s)
}
