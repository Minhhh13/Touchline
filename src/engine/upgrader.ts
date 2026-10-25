/**
 * The Player Upgrader: Gamble mode's power-up (also a power-up on its own, `DraftRules.upgrader`).
 *
 * Once per draft the manager picks a drafted player and a boost of +2, +5 or +10 overall. The chance is shown first, as
 * a whole per cent, and is exactly the chance the gamble wins: `roll < chance` for a roll of 0 to 99. It shrinks with
 * the boost and with how high the player already is, so a star near the top has worse odds than a squad player. A win
 * raises his rating by the boost (never above 99); a loss drops it by half the boost, rounded up. Either way he stays
 * in the side. The result lives on the draft (`DraftState.upgrade`) and is applied by the game's player lookup as an
 * override, so the universe is never touched.
 *
 * The roll comes from the draft's own stream (`upgradeRng`, seeded from the game seed), forked by the player and the
 * boost chosen, which nothing else draws from: it is the same whenever in the draft it is made and never moves a spin,
 * a pick or a match, and a replay of the seed that saw one choice's roll learns nothing about another choice's.
 */
import { Rng } from './rng'
import type { PlayerSeason } from './types'
import type { LoadedUniverse } from './universe'
import { draftRating, upgraderOn, type DraftState, type DraftUpgrade } from './draft'

export const UPGRADE_BOOSTS = [2, 5, 10] as const
export type UpgradeBoost = (typeof UPGRADE_BOOSTS)[number]
/** The chance of each boost for a player rated `UPGRADE_FLOOR` or less. */
export const UPGRADE_BASE: Record<UpgradeBoost, number> = { 2: 0.8, 5: 0.55, 10: 0.3 }
/** At or below this rating a player gets the base chance; above it the chance falls, by three quarters at 100. */
export const UPGRADE_FLOOR = 60
export const RATING_MAX = 99

export function isUpgradeBoost(x: unknown): x is UpgradeBoost {
  return (UPGRADE_BOOSTS as readonly unknown[]).includes(x)
}

/** The chance, in whole per cent (1 to 95), that a boost wins for a player of this rating. */
export function upgradeChance(rating: number, boost: UpgradeBoost): number {
  const height = Math.min(1, Math.max(0, rating - UPGRADE_FLOOR) / (100 - UPGRADE_FLOOR))
  const pct = Math.round(100 * UPGRADE_BASE[boost] * (1 - 0.75 * height))
  return Math.min(95, Math.max(1, pct))
}

/** What a loss costs: half the boost, rounded up. */
export function upgradeLoss(boost: UpgradeBoost): number {
  return Math.ceil(boost / 2)
}

/** The change a win brings to a player of this rating: the boost, capped so he never goes above 99. */
export function upgradeGain(rating: number, boost: UpgradeBoost): number {
  return Math.max(0, Math.min(boost, RATING_MAX - rating))
}

/** The drafted players the upgrader may choose from: the XI, then the bench. */
export function upgradeCandidates(d: DraftState): string[] {
  return [...Object.values(d.lineup), ...d.bench]
}

/** Whether the draft can still use its upgrader: it has one, it is unused, and someone has been drafted. */
export function canUpgrade(d: DraftState): boolean {
  return upgraderOn(d.rules) && !!d.upgradeRng && !d.upgrade && upgradeCandidates(d).length > 0
}

/** The rating the upgrader works from: the draft's (Prime when the rules say so). */
export function upgradeBaseRating(u: LoadedUniverse, d: DraftState, id: string): number | null {
  const p = u.index[id]
  return p ? draftRating(u, d, p) : null
}

/** Make the one gamble: throws when the draft has no upgrader left, the player is not drafted, or the boost is unknown. */
export function upgradePlayer(u: LoadedUniverse, d: DraftState, id: string, boost: number): DraftUpgrade {
  if (!upgraderOn(d.rules) || !d.upgradeRng) throw new Error('This draft has no Player Upgrader')
  if (d.upgrade) throw new Error('The Player Upgrader has been used')
  if (!isUpgradeBoost(boost)) throw new Error('Choose a boost of +2, +5 or +10')
  if (!upgradeCandidates(d).includes(id)) throw new Error('Choose one of your drafted players')
  const rating = upgradeBaseRating(u, d, id)
  if (rating === null) throw new Error('Unknown player')
  const chance = upgradeChance(rating, boost)
  // The roll belongs to this player and boost: a replay of the seed ("Run it back", a link) that saw one gamble's needle
  // learns nothing about another choice. Still one stream and one fork, so it is the same whenever in the draft it is made
  const rng = Rng.fromState(d.upgradeRng)
  const roll = rng.fork(`${id}:${boost}`).int(0, 99)
  d.upgradeRng = rng.getState()
  const won = roll < chance
  const delta = won ? upgradeGain(rating, boost) : -upgradeLoss(boost)
  const out: DraftUpgrade = { id, boost, chance, roll, won, delta }
  d.upgrade = out
  return out
}

const boostedMemo = new WeakMap<PlayerSeason, Map<number, PlayerSeason>>()

const clampRating = (x: number) => Math.min(RATING_MAX, Math.max(1, Math.round(x)))

/**
 * A player-season with the upgrader's change: the overall and every attribute moved by `delta` (within 1 to 99), the
 * rest as it was. A fresh object, cached per player-season and delta; the player-season itself is never changed.
 */
export function boostedPlayer(p: PlayerSeason, delta: number): PlayerSeason {
  if (!delta) return p
  let byDelta = boostedMemo.get(p)
  if (!byDelta) boostedMemo.set(p, (byDelta = new Map()))
  const hit = byDelta.get(delta)
  if (hit) return hit
  const attributes = { ...p.attributes }
  for (const k of Object.keys(attributes) as Array<keyof typeof attributes>) attributes[k] = clampRating(attributes[k] + delta)
  const out: PlayerSeason = { ...p, overall: clampRating(p.overall + delta), attributes }
  byDelta.set(delta, out)
  return out
}
