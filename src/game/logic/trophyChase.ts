/**
 * The Trophy Room's unlock moment, pure: every badge and milestone as one list, what has been earned since this viewer
 * last saw it (a badge, or a new tier of one), the next ones worth chasing, and the share text. Display only: it reads
 * the states `badgeStates` and `milestoneStates` already work out and stores nothing (the screens keep what was revealed
 * in a per-viewer key). No React, no store, no RNG.
 */
import { TIER_NAMES, type BadgeState, type BadgeTier } from '@engine/badges'
import type { MilestoneState } from './milestoneBadges'

export interface TrophyItem {
  kind: 'badge' | 'milestone'
  id: string
  title: string
  /** What the number counts, in the logic's English (the screens word it through `trophyText`). */
  counts: string
  tiers: readonly number[]
  value: number
  tier: BadgeTier | null
  /** Share of the way to the next threshold, 0..1 (1 at gold). */
  toward: number
  stamp: boolean
  /** Earned key, `id:tier` (the Trophy Room's sound keeps the same), null below the first threshold. */
  key: string | null
}

function towardOf(tiers: readonly number[], value: number): number {
  const next = tiers.find((t) => value < t)
  if (next === undefined) return 1
  const prev = [...tiers].reverse().find((t) => value >= t) ?? 0
  return Math.max(0, Math.min(1, (value - prev) / Math.max(1, next - prev)))
}

/** The badges, then the milestones, as one list in Trophy Room order. */
export function trophyItems(badges: readonly BadgeState[], milestones: readonly MilestoneState[]): TrophyItem[] {
  return [
    ...badges.map((s): TrophyItem => ({ kind: 'badge', id: s.badge.id, title: s.badge.title, counts: s.badge.counts, tiers: s.badge.tiers, value: s.value, tier: s.tier, toward: towardOf(s.badge.tiers, s.value), stamp: false, key: s.tier ? `${s.badge.id}:${s.tier}` : null })),
    ...milestones.map((s): TrophyItem => ({ kind: 'milestone', id: s.badge.id, title: s.badge.title, counts: s.badge.counts, tiers: s.badge.tiers, value: s.value, tier: s.tier, toward: s.toward, stamp: s.stamp, key: s.tier ? `${s.badge.id}:${s.tier}` : null })),
  ]
}

/** Every earned tier as a key: a silver badge holds its bronze key too, so a jump from none to silver reveals once. */
export function earnedKeys(items: readonly TrophyItem[]): string[] {
  return items.flatMap((i) => {
    if (!i.tier) return []
    if (i.stamp) return [`${i.id}:${i.tier}`]
    return TIER_NAMES.slice(0, TIER_NAMES.indexOf(i.tier) + 1).map((t) => `${i.id}:${t}`)
  })
}

/**
 * The first look of a viewer who has seen nothing yet: a profile that already holds more than this many earned keys
 * takes them as its baseline, silently (an older career is not one big reveal); a new one sees its first unlocks.
 */
export const REVEAL_BASELINE = 3

/** What to reveal: items with an earned key the viewer has not seen, best tier first. `baseline` says to store `now` silently. */
export function freshUnlocks(revealed: readonly string[] | null, items: readonly TrophyItem[]): { fresh: TrophyItem[]; baseline: boolean } {
  const now = earnedKeys(items)
  if (revealed === null && now.length > REVEAL_BASELINE) return { fresh: [], baseline: true }
  const seen = new Set(revealed ?? [])
  const rank = (i: TrophyItem) => (i.tier ? TIER_NAMES.indexOf(i.tier) : -1)
  const fresh = items.filter((i) => i.key !== null && !seen.has(i.key))
  return { fresh: fresh.map((i, n) => ({ i, n })).sort((a, b) => rank(b.i) - rank(a.i) || a.n - b.n).map((x) => x.i), baseline: false }
}

/**
 * The next ones to chase: tiered badges short of gold that have started (any value), nearest their next threshold
 * first, then Trophy Room order; when fewer than `n` have started, the untouched ones fill in. Stamps are left out
 * (there is no way along to show).
 */
export function nextToChase(items: readonly TrophyItem[], n = 3): TrophyItem[] {
  const open = items.map((i, at) => ({ i, at })).filter(({ i }) => !i.stamp && i.tier !== 'gold')
  const started = open.filter(({ i }) => i.value > 0).sort((a, b) => b.i.toward - a.i.toward || a.at - b.at)
  const fresh = open.filter(({ i }) => i.value <= 0)
  return [...started, ...fresh].slice(0, n).map((x) => x.i)
}

/** "1 league title", "3 league titles": the first plural word made singular for one (as `countPhrase` on screen). */
export function countLine(n: number, plural: string): string {
  if (n !== 1) return `${n} ${plural}`
  const words = plural.split(' ')
  const at = words.findIndex((w) => /[a-z]s[,.]?$/.test(w))
  if (at >= 0) words[at] = words[at].replace(/s([,.]?)$/, '$1')
  return `${n} ${words.join(' ')}`
}

/** What a share says about an unlock (the share text stays English, as every share text does). */
export function unlockShareText(item: Pick<TrophyItem, 'title' | 'tier' | 'stamp' | 'value' | 'counts'>, managerName: string): string {
  const who = managerName.trim() || 'The Gaffer'
  const tier = item.tier && !item.stamp ? ` (${item.tier.charAt(0).toUpperCase()}${item.tier.slice(1)})` : ''
  const what = item.stamp ? item.counts : countLine(item.value, item.counts)
  return `🏅 ${who} unlocked ${item.title}${tier} in the TouchLine Trophy Room: ${what}.`
}
