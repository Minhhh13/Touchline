import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper, nextOpponent } from '../logic/week'
import { runQuickSeason } from '../logic/quick'
import { autoDraft, SEASON_RULES, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { matchweeksFor, USER_TEAM } from '@engine/season'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'odd-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'netherlands',
    wheelLeagues: ['netherlands'],
    hostClubId: 'ajax',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['netherlands'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('leagues with an odd number of clubs', () => {
  const u = loadTestUniverse(['netherlands'])

  it('schedules bye weeks and plays the season through', () => {
    expect(matchweeksFor(17)).toBe(34)
    expect(matchweeksFor(18)).toBe(34)
    expect(matchweeksFor(16)).toBe(30)
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'netherlands' && cs.season === 2025).length
    expect(clubs % 2).toBe(1)
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    const season = g.season!
    expect(season.matchweeks).toBe((clubs + 1 - 1) * 2)
    const mine = season.fixtures.filter((f) => f.homeTeamId === USER_TEAM || f.awayTeamId === USER_TEAM)
    expect(mine.length).toBe(season.matchweeks - 2)
    let byes = 0
    while (g.phase !== 'summary') {
      if (!nextOpponent(g)) byes++
      playMatchweek(g, u, true)
    }
    expect(byes).toBe(2)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(season.matchweeks - 2)
    expect(season.news.some((n) => n.title.includes('free weekend'))).toBe(true)
    // Interactive path: a bye week returns to the dugout instead of a match screen
    const g2 = createGame(settings({ seed: 'odd-live' }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    startSeasonProper(g2)
    while (nextOpponent(g2)) playMatchweek(g2, u, true)
    const before = g2.season!.matchweek
    playMatchweek(g2, u, false)
    expect(g2.season!.matchweek).toBe(before + 1)
    expect(['week', 'match']).toContain(g2.phase)
    if (g2.phase === 'match') expect(g2.live?.kind).toBe('cup')
  })

  it('quick mode copes with the same league', () => {
    const g = createGame(settings({ mode: 'quick', rules: { ...QUICK_RULES, leagues: ['netherlands'] } }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    runQuickSeason(g, u)
    expect(g.phase).toBe('summary')
    expect(g.quickResult!.won + g.quickResult!.drawn + g.quickResult!.lost).toBe(32)
  })
})
