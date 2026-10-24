import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { buildYouthIntake, signYouth, INTAKE_SIZE } from '../logic/youth'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'youth-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2023,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('youth intake', () => {
  const u = loadTestUniverse()

  it('offers young real prospects, homegrown first, and signs one for nothing', () => {
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    expect(g.youthIntake?.candidates.length).toBe(INTAKE_SIZE)
    const owned = new Set(Object.keys(g.squad).map((id) => u.index[id]?.playerId))
    for (const id of g.youthIntake!.candidates) {
      const p = u.index[id]
      expect(p.age).toBeLessThanOrEqual(20)
      expect(p.overall).toBeGreaterThanOrEqual(58)
      expect(p.overall).toBeLessThanOrEqual(76)
      expect(owned.has(p.playerId)).toBe(false)
    }
    const homegrown = g.youthIntake!.candidates.filter((id) => u.index[id].clubId === 'everton')
    expect(homegrown.length).toBeGreaterThanOrEqual(2)
    expect(signYouth(g, u, 'nobody@2000@x').ok).toBe(false)
    const before = Object.keys(g.squad).length
    const budget = g.finances.budget
    const pick = g.youthIntake!.candidates[0]
    const out = signYouth(g, u, pick)
    expect(out.ok).toBe(true)
    expect(Object.keys(g.squad).length).toBe(before + 1)
    expect(g.contracts[pick]).toEqual({ years: 3 })
    expect(g.finances.budget).toBe(budget)
    expect(g.youthIntake!.chosen).toBe(pick)
    expect(signYouth(g, u, g.youthIntake!.candidates[1]).ok).toBe(false)
    // Passing records the decision too
    const g2 = createGame(settings({ seed: 'youth-pass' }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    expect(signYouth(g2, u, null).ok).toBe(true)
    expect(g2.youthIntake!.chosen).toBeNull()
    // Season mode has no academy
    const g3 = createGame(settings({ seed: 'youth-season', mode: 'season' }))
    autoDraft(u, g3.draft!, Rng.fromState(g3.rngState))
    beginSeason(g3, u)
    expect(g3.youthIntake).toBeUndefined()
    // Candidates respect the era filter
    const g4 = createGame(settings({ seed: 'youth-era', rules: { ...SEASON_RULES, leagues: ['england'], fromSeason: 2020, toSeason: 2022 } }))
    autoDraft(u, g4.draft!, Rng.fromState(g4.rngState))
    beginSeason(g4, u)
    for (const id of buildYouthIntake(g4, u, new Rng('era'))) expect(u.index[id].season).toBeGreaterThanOrEqual(2020)
  })
})
