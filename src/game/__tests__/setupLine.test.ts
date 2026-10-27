import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { QUICK_RULES } from '@engine/draft'
import { quickSetupLine } from '../logic/setup'
import { quickSetupLineFull } from '../logic/setupLine'
import type { GameSettings } from '../types'

const u = loadTestUniverse()
const quick: GameSettings = { mode: 'quick', seed: 'LINE-CAP1', formationId: '4-3-3', teamName: 'Touchline XI', shortName: 'TXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: true }

describe('the Quick Draft line above Spin, casual rules included', () => {
  it('is the plain line when neither Moneyball nor the chain is on', () => {
    expect(quickSetupLineFull(u, quick)).toBe(quickSetupLine(u, quick))
  })
  it('names the Moneyball cap and the Teammate chain', () => {
    const line = quickSetupLineFull(u, { ...quick, rules: { ...quick.rules, budget: 180, chain: true } })
    expect(line).toBe('Touchline XI · 4-3-3 · Normal · Moneyball £180M cap · Teammate chain')
    expect(quickSetupLineFull(u, { ...quick, rules: { ...quick.rules, budget: 92.5 } })).toMatch(/Moneyball £92\.5M cap$/)
  })
})
