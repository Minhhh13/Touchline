import { describe, expect, it } from 'vitest'
import { POWER_UPS } from '@engine/powerups'
import { CASE_ITEMS } from '@engine/endCase'
import { POWER_UP_ICON, isCaseItemKey } from '../components/icons'
import { caseItemCard } from '@game/logic/itemReel'

describe('power-up pictures', () => {
  it('draws every power-up with its own Lucide icon', () => {
    const icons = POWER_UPS.map((k) => POWER_UP_ICON[k])
    for (const icon of icons) expect(icon).toBeTruthy()
    expect(new Set(icons).size).toBe(POWER_UPS.length)
  })

  it("knows a case item's reel card by its key, and never takes a manager's card for one", () => {
    for (const x of CASE_ITEMS) expect(isCaseItemKey(caseItemCard(x.item).key)).toBe(true)
    // A manager's card is keyed `${id}@${clubId}@${season}`, so even a manager id of "peek" is not a case item
    expect(isCaseItemKey('peek@lock@2020')).toBe(false)
    expect(isCaseItemKey('')).toBe(false)
  })
})
