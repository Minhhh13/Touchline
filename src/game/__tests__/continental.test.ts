import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, finishLiveMatch, startSeasonProper, continentalRun, upcomingCupTie } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { buildContinentalClubs, continentalRounds, cupRounds, USER_TEAM } from '@engine/season'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'euro-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england', 'spain', 'germany'],
    hostClubId: 'everton',
    leagueSeason: 2024,
    rules: { ...SEASON_RULES, leagues: ['england', 'spain', 'germany'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    continental: true,
    ...partial,
  }
}

describe('Continental Cup', () => {
  const u = loadTestUniverse(['england', 'spain', 'germany'])

  it('builds a field of fifteen foreign clubs on free midweeks', () => {
    const clubs = buildContinentalClubs(u, 'england', 2024, 'everton', 15)
    const ids = Object.keys(clubs)
    expect(ids.length).toBe(15)
    for (const id of ids) expect(u.clubById[id]?.leagueId).not.toBe('england')
    const leagues = new Set(ids.map((id) => u.clubById[id]?.leagueId))
    expect(leagues.size).toBe(2)
    // No clash with the domestic cup in either league size
    for (const mws of [38, 34]) {
      const dom = new Set(cupRounds(mws).map((r) => r.afterMatchweek))
      for (const r of continentalRounds(mws)) expect(dom.has(r.afterMatchweek)).toBe(false)
    }
  })

  it('plays through a season with both knockouts, including a live European tie', () => {
    const g = createGame(settings())
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    expect(g.season!.continental).toBeTruthy()
    expect(g.season!.continental!.ties.length).toBe(8)
    expect(g.season!.news.some((n) => n.title === 'European Nights draw')).toBe(true)
    startSeasonProper(g)
    const r16 = continentalRounds(g.season!.matchweeks)[0].afterMatchweek
    while (g.season!.matchweek < r16 - 1) playMatchweek(g, u, true)
    // Header helper points at the European tie this week
    const up = upcomingCupTie(g)
    expect(up?.comp).toBe('continental')
    expect(up?.label).toBe('European Nights round of 16')
    // Play the league match live, then the tie live
    playMatchweek(g, u, false)
    expect(g.live?.kind).toBe('league')
    finishLiveMatch(g, u, { talk: 'encourage' })
    expect(g.live?.kind).toBe('cup')
    expect(g.live?.comp).toBe('continental')
    expect(g.live?.ctx.competition).toBe('continental')
    const oppId = g.live!.opponentId
    expect(g.season!.continental!.clubs[oppId]).toBeTruthy()
    finishLiveMatch(g, u, { talk: 'fire-up' })
    expect(g.live).toBeNull()
    const myTie = g.season!.continental!.ties.find((t) => t.round === 'R16' && (t.homeTeamId === USER_TEAM || t.awayTeamId === USER_TEAM))!
    expect(myTie.result).toBeTruthy()
    expect(g.lastCupContext?.competition).toBe('continental')
    // Every R16 tie resolved and the quarter-final drawn
    expect(g.season!.continental!.ties.filter((t) => t.round === 'R16' && t.winnerId).length).toBe(8)
    expect(g.season!.continental!.ties.filter((t) => t.round === 'QF').length).toBe(4)
    // Sim to the end: a final gets played
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const ties = g.season!.continental!.ties
    expect(ties.filter((t) => t.round === 'F' && t.result).length).toBe(1)
    const run = continentalRun(g.season!)
    expect(['R16', 'QF', 'SF', 'F', 'W']).toContain(run)
    expect(g.history[0].continentalRun).toBe(run)
    expect(g.history[0].continentalWon).toBe(run === 'W')
    // Domestic cup ran alongside untouched
    expect(g.season!.cup.filter((t) => t.round === 'F' && t.result).length).toBe(1)
    // Qualification follows the table (or the trophy)
    expect(g.qualifiedContinental).toBe(g.history[0].position <= 4 || run === 'W')
  })

  it('re-enters in the dynasty only when qualified', () => {
    const g = createGame(settings({ seed: 'euro-dyn' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const qualified = g.qualifiedContinental
    advanceToNextSeason(g, u)
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    expect(!!g.season!.continental).toBe(!!qualified)
    // Without the setting and without qualifying there is no European football
    const g2 = createGame(settings({ seed: 'euro-none', continental: false }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    expect(g2.season!.continental).toBeUndefined()
  })
})
