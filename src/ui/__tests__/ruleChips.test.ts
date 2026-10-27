import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES } from '@engine/draft'
import { MODE_CARDS } from '@engine/modes'
import { describeRuleChips } from '@game/logic/setup'
import { MODE_ICON, RULE_ICON } from '../components/icons'

describe('the fixed-rules chips draw Lucide icons', () => {
  it('maps every picture id a chip can carry, the mode cards to their own icons', () => {
    const u = loadTestUniverse(['england'])
    const chips = describeRuleChips(u, { ...QUICK_RULES, leagues: ['england'], modes: ['crazy', 'underdog', 'legends', 'speedrun', 'gamble'], upgrader: true, powerUps: true, managerSpin: true, endCase: true })
    const ids = chips.flatMap((c) => (c.icon ? [c.icon] : []))
    expect(ids).toEqual(['crazy', 'underdog', 'legends', 'speedrun', 'gamble', 'upgrader', 'power-ups', 'manager-spin', 'end-case'])
    for (const id of ids) expect(RULE_ICON[id]).toBeTruthy()
    for (const c of MODE_CARDS) expect(RULE_ICON[c]).toBe(MODE_ICON[c])
  })

  it('Setup renders the chips with RULE_ICON, never an emoji beside the words', () => {
    const setup = readFileSync(join(__dirname, '..', 'screens/Setup.tsx'), 'utf8')
    expect(setup).toContain('describeRuleChips(u, fixed.rules)')
    expect(setup).toContain('RULE_ICON[c.icon]')
    expect(setup).not.toMatch(/describeRules\(u, fixed\.rules\)/)
  })
})
