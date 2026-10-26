import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame } from '../logic/setup'
import { capOfGame, capTotal } from '../logic/cap'
import { chainRecord } from '../logic/chain'
import { casualChips } from '../logic/casualChips'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function drafted(seed: string, rules: Partial<GameSettings['rules']>): Game {
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Chips XI', shortName: 'CXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated' })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

describe("the summary's Moneyball and Teammate chain chips", () => {
  it('are absent without either rule', () => {
    expect(casualChips(drafted('chips-plain', {}))).toEqual([])
  })
  it('show what the cap bought and how the chain held, over many seeds', () => {
    let broken = 0
    for (let i = 0; i < 12; i++) {
      const g = drafted(`chips-${i}`, { budget: 180, chain: true })
      const chips = casualChips(g)
      expect(chips.map((c) => c.key)).toEqual(['cap', 'chain'])
      const cap = capOfGame(g)!
      expect(cap.spent).toBeGreaterThan(0)
      expect(cap.spent).toBeLessThanOrEqual(180)
      expect(chips[0].text).toBe(`${capTotal(cap.spent)} of £180M`)
      const c = chainRecord(g.draft!)
      if (c.broken.length) broken++
      expect(chips[1].text).toBe(c.broken.length ? `Chain broken ${c.broken.length === 1 ? 'once' : c.broken.length === 2 ? 'twice' : `${c.broken.length} times`}` : `Chain: ${c.clubs.length} links`)
    }
    expect(broken).toBeLessThan(12)
  })
})
