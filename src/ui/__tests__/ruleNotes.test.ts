import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { DAILY_RULES } from '@game/logic/daily'
import { describeRuleChips } from '@game/logic/setup'
import { QUICK_RULES } from '@engine/draft'
import { ruleChipNote } from '../ruleNotes'

describe('ruleChipNote: every fixed rules chip says what it means', () => {
  it('gives each of the Daily’s chips a note', () => {
    const u = loadTestUniverse(['england'])
    const chips = describeRuleChips(u, DAILY_RULES)
    expect(chips.length).toBeGreaterThan(4)
    for (const c of chips) expect(ruleChipNote(c), c.text).toBeTruthy()
  })

  it('covers the other values a chip can take', () => {
    const u = loadTestUniverse(['england'])
    const chips = describeRuleChips(u, { ...QUICK_RULES, leagues: ['england'], respins: 0, showRatings: false, draftMode: 'position', ratings: 'prime', twists: false, fromSeason: 2016, benchPicks: 3, modes: ['legends'], upgrader: true })
    for (const c of chips) expect(ruleChipNote(c), c.text).toBeTruthy()
    expect(ruleChipNote({ text: 'Squad First' })).toMatch(/Spin first/)
    expect(ruleChipNote({ text: 'Something new' })).toBeUndefined()
  })
})
