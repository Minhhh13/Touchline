import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { inLeague, leagueArticle } from '../logic/leagueNames'

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
})
