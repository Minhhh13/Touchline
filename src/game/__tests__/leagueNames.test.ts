import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { inLeague, leagueArticle, tidyLeagueArticles } from '../logic/leagueNames'
import { summariseSetup } from '../logic/setup'
import { QUICK_RULES } from '@engine/draft'

describe('league names in a sentence', () => {
  it('gives the article only to the leagues that take one in English', () => {
    expect(inLeague('Premier League')).toBe('in the Premier League')
    expect(inLeague('La Liga')).toBe('in La Liga')
    expect(inLeague('Serie A')).toBe('in Serie A')
    expect(inLeague('Ligue 1')).toBe('in Ligue 1')
    expect(inLeague('Bundesliga')).toBe('in the Bundesliga')
    expect(inLeague('Eredivisie')).toBe('in the Eredivisie')
    expect(inLeague('Primeira Liga')).toBe('in the Primeira Liga')
  })

  it('covers every league the packs ship', () => {
    const u = loadTestUniverse(['england'])
    const named = Object.fromEntries(u.available.map((l) => [l.name, leagueArticle(l.name)]))
    expect(named).toEqual({ 'Premier League': 'the ', 'La Liga': '', 'Serie A': '', Bundesliga: 'the ', 'Ligue 1': '', Eredivisie: 'the ', 'Primeira Liga': 'the ' })
  })

  it("tidies the setup line's article and leaves the rest of it as it was", () => {
    expect(tidyLeagueArticles('Touchline XI, 4-3-3, in the La Liga 2008-09, calibrated, seed X')).toBe('Touchline XI, 4-3-3, in La Liga 2008-09, calibrated, seed X')
    expect(tidyLeagueArticles('in the Serie A 2010-11 · in the Ligue 1 2012-13')).toBe('in Serie A 2010-11 · in Ligue 1 2012-13')
    const u = loadTestUniverse(['england'])
    const line = summariseSetup(u, { mode: 'quick', seed: 'S', formationId: '4-3-3', teamName: 'Touchline XI', shortName: 'TXI', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
    expect(line).toContain('in the Premier League')
    expect(tidyLeagueArticles(line)).toBe(line)
  })
})
