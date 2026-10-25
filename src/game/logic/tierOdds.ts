/**
 * The odds panel by the reel: the exact chance the next spin (or a re-spin, while a spin is showing) lands in each
 * rarity tier, from the engine's own distribution (`spinOdds`: the real wheel pool, twist, filters, the season-first
 * draw and the club weights) and the tier table the reel colours cards with. Gamble mode's Icons chance is its own
 * row above gold. Pure: no RNG, nothing here feeds the engine.
 */
import { spinOdds, type DraftState } from '@engine/draft'
import { h2hSpinOdds, type H2HDraft } from '@engine/h2h'
import type { ClubSeason } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { DISPLAY_TIERS, tierTable, type DisplayTier } from './rarity'

export interface TierOdds {
  tier: DisplayTier
  /** 0 to 1. */
  p: number
}

/** The chance of each tier on the next spin, rarest first, every tier listed (Icons only in a Gamble draft). Sums to 1 when the wheel can spin. */
export function tierOdds(u: LoadedUniverse, d: DraftState, leagues: readonly string[]): TierOdds[] {
  const odds = spinOdds(u, d)
  return byTier(u, leagues, odds.outcomes, odds.icons, !!d.gambleRng)
}

/** The same for the next head-to-head spin (no Icons there). */
export function h2hTierOdds(u: LoadedUniverse, h: H2HDraft, leagues: readonly string[]): TierOdds[] {
  return byTier(u, leagues, h2hSpinOdds(u, h), 0, false)
}

function byTier(u: LoadedUniverse, leagues: readonly string[], outcomes: ReadonlyArray<{ cs: ClubSeason; p: number }>, icons: number, withIcons: boolean): TierOdds[] {
  const tiers = tierTable(u, leagues)
  const by: Record<DisplayTier, number> = { icons, gold: 0, red: 0, pink: 0, purple: 0, blue: 0 }
  for (const o of outcomes) by[tiers[`${o.cs.clubId}@${o.cs.season}`] ?? 'blue'] += o.p
  return DISPLAY_TIERS.filter((t) => t !== 'icons' || withIcons).map((tier) => ({ tier, p: by[tier] }))
}

/**
 * A chance as the panel prints it: one decimal under 10% (0.4%, 7.5%), whole above (23%); "<0.1%" for a chance too
 * small to print but not zero, so a tier that can come up never reads as 0%.
 */
export function formatOdds(p: number): string {
  if (p <= 0) return '0%'
  const pct = p * 100
  if (pct < 0.05) return '<0.1%'
  if (pct < 9.95) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}
