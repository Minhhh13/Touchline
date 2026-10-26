/**
 * The end-of-draft case: one case a casual Quick Draft opens once the squad is drafted, before the season
 * (`DraftRules.endCase`). It drops one item:
 *
 *  - a power-up (one of the tray's six, `./powerups`), which goes into the player's locker (`Profile.inventory`) for a
 *    later Quick Draft; nothing about this season changes;
 *  - or, rarely, an Icon: a player from the Icons collection (`./icons`, the best of all time on the draft's leagues,
 *    each at his peak) who may come into this season's XI in place of a drafted starter.
 *
 * The draw is one roll of 0 to 99 against `CASE_ITEMS` (whole per cent, so the odds shown are exact), then for an Icon
 * one pick among the icons who are not in the squad already and can cover some slot of the XI. When no icon qualifies the
 * Icon roll drops the Upgrader instead (never in practice: the collection holds 60). The stream is the caller's: the game
 * forks a copy of its own (`END_CASE_FORK`), so the case never moves the season or anything after it. Pure otherwise.
 */
import type { Rng } from './rng'
import type { DraftState } from './draft'
import type { LoadedUniverse } from './universe'
import type { PlayerSeason } from './types'
import { canCover } from './positions'
import { iconsCollection } from './icons'
import type { PowerUp } from './powerups'

/** The label the case forks the game's stream with, on a copy. */
export const END_CASE_FORK = 'end-case'

/** The case's rarities, commonest first. */
export type CaseRarity = 'common' | 'rare' | 'epic' | 'icon'
export const CASE_RARITIES: readonly CaseRarity[] = ['common', 'rare', 'epic', 'icon']

export type CaseItem = PowerUp | 'icon'

/** Every item the case can drop, with its rarity and its chance in whole per cent (they sum to 100). */
export const CASE_ITEMS: ReadonlyArray<{ item: CaseItem; rarity: CaseRarity; weight: number }> = [
  { item: 'peek', rarity: 'common', weight: 18 },
  { item: 'swap', rarity: 'common', weight: 18 },
  { item: 'lock', rarity: 'common', weight: 18 },
  { item: 'reroll', rarity: 'rare', weight: 14 },
  { item: 'armband', rarity: 'rare', weight: 14 },
  { item: 'upgrader', rarity: 'epic', weight: 13 },
  { item: 'icon', rarity: 'icon', weight: 5 },
]

/** The chance of each rarity, in whole per cent. */
export function caseRarityOdds(): Record<CaseRarity, number> {
  const out: Record<CaseRarity, number> = { common: 0, rare: 0, epic: 0, icon: 0 }
  for (const x of CASE_ITEMS) out[x.rarity] += x.weight
  return out
}

export function rarityOfItem(item: CaseItem): CaseRarity {
  return CASE_ITEMS.find((x) => x.item === item)?.rarity ?? 'common'
}

/** What a case dropped: a power-up for the locker, or an Icon player-season (a universe id) for this season's XI. */
export type CaseDrop = { kind: 'powerup'; powerUp: PowerUp; rarity: CaseRarity } | { kind: 'icon'; id: string; rarity: 'icon' }

/** The XI slots an icon may take: those he can cover at the draft's minimum fit. */
export function iconSlots(d: Pick<DraftState, 'formation' | 'rules'>, p: PlayerSeason): string[] {
  return d.formation.slots.filter((s) => canCover(p, s.position, d.rules.minFit)).map((s) => s.id)
}

/** The icons a case may drop for this draft: not drafted already (by player), able to cover a slot of its shape, best first. */
export function caseIcons(u: LoadedUniverse, d: DraftState, leagues: readonly string[]): PlayerSeason[] {
  const taken = new Set(d.takenPlayers)
  return iconsCollection(u, leagues).squad.filter((p) => !taken.has(p.playerId) && iconSlots(d, p).length > 0)
}

/** Open the case: one roll for the item, then one pick for an Icon. */
export function rollCase(u: LoadedUniverse, d: DraftState, leagues: readonly string[], rng: Rng): CaseDrop {
  const roll = rng.int(0, 99)
  let at = 0
  let item: CaseItem = CASE_ITEMS[CASE_ITEMS.length - 1].item
  for (const x of CASE_ITEMS) {
    at += x.weight
    if (roll < at) {
      item = x.item
      break
    }
  }
  if (item === 'icon') {
    const icons = caseIcons(u, d, leagues)
    if (icons.length) return { kind: 'icon', id: rng.pick(icons).id, rarity: 'icon' }
    item = 'upgrader'
  }
  return { kind: 'powerup', powerUp: item, rarity: rarityOfItem(item) }
}
