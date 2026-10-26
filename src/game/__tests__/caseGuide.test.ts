import { describe, expect, it } from 'vitest'
import { CASE_ITEMS } from '@engine/endCase'
import { POWER_UP_INFO } from '@engine/powerups'
import { CASE_ICON_LINE, caseGuide } from '../logic/caseGuide'

describe("the case screen's guide", () => {
  it('lists every item once, rarest first, with its exact odds, what it does and the locker count', () => {
    const rows = caseGuide({ inventory: { upgrader: 2, peek: 1, swap: 0 } })
    expect(rows.map((r) => r.item).sort()).toEqual(CASE_ITEMS.map((x) => x.item).sort())
    expect(rows.reduce((s, r) => s + r.weight, 0)).toBe(100)
    expect(rows.map((r) => r.rarity)).toEqual(['icon', 'epic', 'rare', 'rare', 'common', 'common', 'common'])
    for (const r of rows) expect(r.weight).toBe(CASE_ITEMS.find((x) => x.item === r.item)!.weight)
    const icon = rows[0]
    expect(icon).toMatchObject({ item: 'icon', title: 'Icon', line: CASE_ICON_LINE, held: null })
    expect(rows.find((r) => r.item === 'upgrader')).toMatchObject({ title: POWER_UP_INFO.upgrader.title, line: POWER_UP_INFO.upgrader.line, held: 2 })
    expect(rows.find((r) => r.item === 'peek')!.held).toBe(1)
    expect(rows.find((r) => r.item === 'swap')!.held).toBe(0)
    expect(rows.find((r) => r.item === 'lock')!.held).toBe(0)
  })

  it('reads an empty or damaged locker as nothing held', () => {
    for (const r of caseGuide({})) if (r.item !== 'icon') expect(r.held).toBe(0)
    expect(caseGuide({ inventory: { peek: -3, swap: 1.5 } as never }).filter((r) => r.held).length).toBe(0)
  })
})
