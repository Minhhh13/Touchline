/**
 * Football Manager depth in the player model: stamina, strength, aggression,
 * jumping and work rate beside the eight classic attributes.
 *
 * The data packs carry the five as columns (`sta`, `str`, `agg`, `jmp`, `wr`)
 * taken from the detailed EA and European Soccer Database stats. Where a pack
 * predates the columns, or a source lacked a value, the same fallbacks below
 * derive them from what every row has: `scripts/import/build.mjs` keeps a copy
 * of these formulas, so a derived value is identical whichever side computes it.
 */
import type { Attributes, Traits } from './types'

/** The five depth attributes. */
export type DepthKey = 'stamina' | 'strength' | 'aggression' | 'jumping' | 'workRate'

export const DEPTH_KEYS: readonly DepthKey[] = ['stamina', 'strength', 'aggression', 'jumping', 'workRate']

/** The eight attributes every pack has always carried. */
export type CoreAttributes = Omit<Attributes, DepthKey>

const clamp99 = (v: number): number => Math.min(99, Math.max(1, Math.round(v)))

/** Stamina from physical and age: legs go from 30 (a 33-year-old rated 70 physical reads 65; an unknown age reads as 26). */
export function deriveStamina(physical: number, age: number): number {
  return clamp99(physical + 3 - Math.max(0, (Number.isFinite(age) ? age : 26) - 29) * 2)
}

/** Strength from physical and height (unknown height, 0, reads as 180 cm). */
export function deriveStrength(physical: number, height: number): number {
  const h = height > 0 ? height : 180
  return clamp99(physical + (h - 180) * 0.35)
}

/** Aggression from defending and mentality: a committed defender with a strong head reads high. */
export function deriveAggression(defending: number, mentality: number): number {
  return clamp99(0.5 * defending + 0.5 * mentality + 1)
}

/** Jumping from height and physical. */
export function deriveJumping(height: number, physical: number): number {
  const h = height > 0 ? height : 180
  return clamp99(0.6 * physical + 26 + (h - 180) * 0.9)
}

/** Work rate from mentality, kept inside the High/Medium/Low band (35 to 80). */
export function deriveWorkRate(mentality: number): number {
  return Math.min(80, Math.max(35, Math.round(25 + mentality * 0.5)))
}

/** Work-rate text to a number: High 80, Medium 55, Low 35, averaged over the attacking and defensive sides. */
export const WORK_RATE_VALUE: Record<'high' | 'medium' | 'low', number> = { high: 80, medium: 55, low: 35 }

/**
 * Fill the five depth attributes from the eight core ones and the player's age
 * and height, keeping any that are already known (finite, 1 to 99).
 */
export function withDepth(core: CoreAttributes & Partial<Record<DepthKey, number | undefined>>, age: number, height: number): Attributes {
  const known = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 99
  return {
    pace: core.pace,
    shooting: core.shooting,
    passing: core.passing,
    dribbling: core.dribbling,
    defending: core.defending,
    physical: core.physical,
    mentality: core.mentality,
    goalkeeping: core.goalkeeping,
    stamina: known(core.stamina) ? Math.round(core.stamina) : deriveStamina(core.physical, age),
    strength: known(core.strength) ? Math.round(core.strength) : deriveStrength(core.physical, height),
    aggression: known(core.aggression) ? Math.round(core.aggression) : deriveAggression(core.defending, core.mentality),
    jumping: known(core.jumping) ? Math.round(core.jumping) : deriveJumping(height, core.physical),
    workRate: known(core.workRate) ? Math.round(core.workRate) : deriveWorkRate(core.mentality),
  }
}

// ---------------------------------------------------------------------------
// Engine helpers, all pure

/** Condition lost per match scales by this: 1.0 at stamina 50, 0.8 at 90, 1.1 at 30. */
export function staminaCostFactor(stamina: number): number {
  return 1.25 - 0.5 * (stamina / 100)
}

/** How much a player's legs go after the 70th minute: 0 at stamina 75 and above, 0.5 at 50, 1 at 25 and below. */
export function legs(stamina: number): number {
  return Math.min(1, Math.max(0, (75 - stamina) / 50))
}

/** The late fade applied to an effective rating: a 10 per cent cut at most, for the least durable. */
export const LATE_FADE = 0.1

/** Card probabilities scale by this: 0.7 at aggression 0, 1.0 at 50, 1.3 at 100. */
export function aggressionCardFactor(aggression: number): number {
  return 0.7 + 0.6 * (aggression / 100)
}

/**
 * Extra injury risk for a player whose stamina and condition are both low:
 * 0 while either is healthy, up to +30 per cent at stamina 30 or below with
 * condition 40 or below.
 */
export function fatigueInjuryFactor(stamina: number, condition: number): number {
  const legsRisk = Math.min(1, Math.max(0, (70 - stamina) / 40))
  const condRisk = Math.min(1, Math.max(0, (80 - condition) / 40))
  return 1 + 0.3 * legsRisk * condRisk
}

/** Strength and jumping together: the number that wins a duel in the air or a shoulder to shoulder. */
export function aerial(a: Pick<Attributes, 'strength' | 'jumping'>): number {
  return (a.strength + a.jumping) / 2
}

/** Up to ±4 per cent of expected goals for an aerial mismatch of 8 points or more between attack and defence. */
export const MISMATCH_XG = 0.04
export const MISMATCH_SPAN = 8

export function mismatchFactor(attackAerial: number, defenceAerial: number): number {
  const d = Math.min(1, Math.max(-1, (attackAerial - defenceAerial) / MISMATCH_SPAN))
  return 1 + MISMATCH_XG * d
}

/** Work-rate efficiency for pressing and counter instructions: −0.2 at 35, 0 at 55, +0.25 at 80. */
export function workRateEdge(avgWorkRate: number): number {
  return Math.min(0.25, Math.max(-0.2, (avgWorkRate - 55) / 100))
}

/** Familiarity gained from a match is cut for a player who does not work: 1.0 from work rate 55 up, 0.8 at 35. */
export function familiarityGainFactor(workRate: number): number {
  return Math.min(1, Math.max(0.8, 1 - (55 - workRate) / 100))
}

/** Injury proneness shown as a 1 to 5 risk (1 robust, 5 glass). */
export function injuryRiskLevel(traits: Pick<Traits, 'injuryProneness'>): 1 | 2 | 3 | 4 | 5 {
  const lvl = Math.ceil(Math.min(0.999, Math.max(0, traits.injuryProneness)) * 5)
  return Math.max(1, Math.min(5, lvl)) as 1 | 2 | 3 | 4 | 5
}

export const INJURY_RISK_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = { 1: 'Robust', 2: 'Sturdy', 3: 'Average', 4: 'Fragile', 5: 'Glass' }
