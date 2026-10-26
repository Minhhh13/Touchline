import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { kickOff, toKickoff } from '../logic/quick'
import { quickCupStatus, skipQuickCup } from '../logic/quickCups'
import { createGame } from '../logic/setup'
import { passQuickCup, summaryMainCall } from '../logic/summaryCall'
import type { Game } from '../types'

const u = loadTestUniverse(['england'])

function played(seed: string): Game {
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Call XI', shortName: 'CAL', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  return g
}

describe("the quick summary's main call", () => {
  it('is the first cup still open, then Copy result once none is', () => {
    let both = 0
    for (const seed of ['call-1', 'call-2', 'call-3', 'call-4']) {
      const g = played(seed)
      const before = JSON.stringify(g)
      expect(summaryMainCall(g, u)).toBe('cup')
      expect(JSON.stringify(g)).toBe(before)
      skipQuickCup(g, u, 'cup')
      const euro = quickCupStatus(g, u, 'continental').state === 'open'
      if (euro) both++
      expect(summaryMainCall(g, u)).toBe(euro ? 'continental' : 'copy')
      if (euro) {
        // Passed on (what skipping it stores)
        g.quickResult!.continentalCup = null
        expect(quickCupStatus(g, u, 'continental').state).toBe('skipped')
        expect(summaryMainCall(g, u)).toBe('copy')
      }
    }
    expect(both).toBeGreaterThan(0)
  }, 120_000)

  it('is Copy result with no quick season', () => {
    const g = played('call-1')
    expect(summaryMainCall({ ...g, quickResult: null }, u)).toBe('copy')
  }, 60_000)

  it('passes on a cup on offer, the Continental Cup too while its field is not loaded, and nothing else', () => {
    const g = played('call-pass')
    if (quickCupStatus(g, u, 'continental').state === 'open') {
      // Only the wheel's league is loaded: skipQuickCup refuses, passing does not need the field
      expect(() => skipQuickCup(JSON.parse(JSON.stringify(g)), u, 'continental')).toThrow()
      expect(passQuickCup(g, u, 'continental')).toBe(true)
      expect(quickCupStatus(g, u, 'continental').state).toBe('skipped')
      expect(passQuickCup(g, u, 'continental')).toBe(false)
    }
    expect(passQuickCup(g, u, 'cup')).toBe(true)
    expect(g.quickResult!.cup).toBeNull()
    expect(passQuickCup(g, u, 'cup')).toBe(false)
    expect(passQuickCup({ ...g, quickResult: null }, u, 'cup')).toBe(false)
  }, 60_000)
})
