/**
 * The item reels of the manager spin and the end-of-draft case, dealt as plain data so they can be tested without a
 * DOM: a strip of `ITEM_REEL_CARDS` cards with the drawn item at `ITEM_REEL_LAND`, fillers from the item pool around it,
 * never the same card twice in a row (unless the pool has one item). The engine has already drawn the item; the reel
 * only presents it. The random source is injected: the UI passes `Math.random` (cosmetic only, never the game), tests
 * a seeded one.
 */
import { CASE_ITEMS, type CaseDrop, type CaseItem } from '@engine/endCase'
import type { Manager } from '@engine/managers'
import { POWER_UP_INFO } from '@engine/powerups'
import type { LoadedUniverse } from '@engine/universe'
import { CASE_TIER } from './endCase'
import { managerTier } from './managers'
import type { DisplayTier } from './rarity'

export const ITEM_REEL_CARDS = 44
export const ITEM_REEL_LAND = 36
/** The stop lands up to this fraction of a card either side of the card's centre (cosmetic). */
export const ITEM_REEL_JITTER = 0.4

export interface ItemCard {
  key: string
  tier: DisplayTier
  /** The big face of the card: a power-up's emoji, a manager's initials, the Icon star. */
  face: string
  /** The small line under the face. */
  label: string
}

export interface ItemDeal {
  cards: ItemCard[]
  land: number
  jitter: number
  target: ItemCard
}

/** A strip for a drawn item over a pool of fillers. */
export function dealItems(target: ItemCard, pool: readonly ItemCard[], random: () => number): ItemDeal {
  const fillers = pool.length ? pool : [target]
  const cards = new Array<ItemCard>(ITEM_REEL_CARDS)
  cards[ITEM_REEL_LAND] = target
  const draw = (beside: string): ItemCard => {
    for (let tries = 0; tries < 8; tries++) {
      const c = fillers[Math.min(fillers.length - 1, Math.floor(random() * fillers.length))]
      if (c.key !== beside || fillers.length === 1) return c
    }
    return fillers.find((c) => c.key !== beside) ?? fillers[0]
  }
  for (let i = ITEM_REEL_LAND - 1; i >= 0; i--) cards[i] = draw(cards[i + 1].key)
  for (let i = ITEM_REEL_LAND + 1; i < ITEM_REEL_CARDS; i++) cards[i] = draw(cards[i - 1].key)
  return { cards, land: ITEM_REEL_LAND, jitter: (random() * 2 - 1) * ITEM_REEL_JITTER, target }
}

/** "AW" for Arsène Wenger; the first two letters of a one-word name. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\s'-]/gu, '').split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** A manager's card on a reel: his initials in the tier of the club-season he ran. */
export function managerCard(u: LoadedUniverse, leagues: readonly string[], m: Manager): ItemCard {
  return { key: `${m.id}@${m.clubId ?? ''}@${m.season ?? ''}`, tier: managerTier(u, leagues, m), face: initials(m.name), label: m.name.split(/\s+/).slice(-1)[0] ?? m.name }
}

/** A case item's card: the power-up's emoji, or the Icon star. */
export function caseItemCard(item: CaseItem): ItemCard {
  const rarity = CASE_ITEMS.find((x) => x.item === item)?.rarity ?? 'common'
  if (item === 'icon') return { key: 'icon', tier: CASE_TIER.icon, face: '★', label: 'Icon' }
  return { key: item, tier: CASE_TIER[rarity], face: POWER_UP_INFO[item].icon, label: POWER_UP_INFO[item].title }
}

/** The card a case drop lands on. */
export function caseDropCard(drop: CaseDrop): ItemCard {
  return caseItemCard(drop.kind === 'icon' ? 'icon' : drop.powerUp)
}

/** The case's fillers: every item, each as often as its chance, so the strip looks like the odds. */
export function caseFillers(): ItemCard[] {
  return CASE_ITEMS.flatMap((x) => Array.from({ length: x.weight }, () => caseItemCard(x.item)))
}
