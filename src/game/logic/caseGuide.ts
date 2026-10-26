/**
 * The end-of-draft case screen's guide: every item the case can drop with its odds, what it does and the locker's
 * count. Its own module so `endCase.ts`, which the ranked boards' verifier bundles, stays byte for byte as it was. Pure.
 */
import type { Profile } from '../types'
import { CASE_ITEMS, type CaseItem, type CaseRarity } from '@engine/endCase'
import { POWER_UP_INFO } from '@engine/powerups'
import { lockerCount } from './endCase'

/** One line of the case screen's guide: an item, its odds, what it does and how many the locker holds (null for the Icon). */
export interface CaseGuideRow {
  item: CaseItem
  rarity: CaseRarity
  /** Whole per cent, as the odds table shows it. */
  weight: number
  title: string
  line: string
  held: number | null
}

export const CASE_ICON_LINE = 'One of the best players of all time on this wheel, at his peak: he can come into this XI for the season in place of a starter.'

/** Every item the case can drop, rarest first, with what it does and the locker's count. Pure. */
export function caseGuide(p: Pick<Profile, 'inventory'>): CaseGuideRow[] {
  const order: CaseRarity[] = ['icon', 'epic', 'rare', 'common']
  return [...CASE_ITEMS]
    .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity))
    .map((x) => (x.item === 'icon' ? { item: x.item, rarity: x.rarity, weight: x.weight, title: 'Icon', line: CASE_ICON_LINE, held: null } : { item: x.item, rarity: x.rarity, weight: x.weight, title: POWER_UP_INFO[x.item].title, line: POWER_UP_INFO[x.item].line, held: lockerCount(p, x.item) }))
}
