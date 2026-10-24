import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, finishLiveMatch, playFriendly, startSeasonProper } from '../logic/week'
import { autoDraft } from '@engine/draft'
import { Rng } from '@engine/rng'
import { runQuickSeason } from '../logic/quick'
import { advanceToNextSeason } from '../logic/dynasty'
import { bidFor, advanceDay } from '../logic/marketOps'
import type { GameSettings } from '../types'
import { SEASON_RULES, QUICK_RULES } from '@engine/draft'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'flow-test',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('game flow', () => {
  const u = loadTestUniverse()

  it('quick mode drafts and simulates a season', () => {
    const g = createGame(settings({ mode: 'quick', rules: { ...QUICK_RULES, leagues: ['england'] } }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    runQuickSeason(g, u)
    expect(g.phase).toBe('summary')
    expect(g.quickResult!.won + g.quickResult!.drawn + g.quickResult!.lost).toBe(38)
    expect(g.quickResult!.table.length).toBe(20)
  })

  it('season mode plays a full managed season with live halves, cup, window and summary', () => {
    const g = createGame(settings())
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    expect(g.phase).toBe('preseason')
    expect(g.season!.matchweeks).toBe(38)
    expect(Object.keys(g.lineup).length).toBe(11)
    // A live friendly, finished with a half-time change
    playFriendly(g, u)
    expect(g.live?.kind).toBe('friendly')
    finishLiveMatch(g, u, { talk: 'fire-up', tactics: { ...g.tactics, mentality: 'attacking' } })
    expect(g.live).toBeNull()
    expect(g.lastMatch?.halfTimeScore).toBeDefined()
    startSeasonProper(g)
    // Six live weeks (matchweek 6 is followed by a cup tie)
    for (let i = 0; i < 6; i++) {
      playMatchweek(g, u, false)
      expect(g.live?.kind).toBe('league')
      finishLiveMatch(g, u, { talk: 'encourage' })
      if (g.live?.kind === 'cup') finishLiveMatch(g, u, { talk: 'calm' })
      expect(g.live).toBeNull()
    }
    expect(g.season!.matchweek).toBe(6)
    expect(g.season!.cup.some((t) => t.result)).toBe(true)
    // Sim to the window and buy someone
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    const listing = g.window!.listings.find((l) => l.status === 'available')!
    const before = Object.keys(g.squad).length
    const out = bidFor(g, u, listing.playerSeasonId, Math.min(g.finances.budget, listing.asking))
    if (out.accepted) expect(Object.keys(g.squad).length).toBe(before + 1)
    advanceDay(g, u)
    // Sim to the end
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(g.history.length).toBe(1)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(38)
    expect(g.awards?.teamOfTheSeason.length).toBe(11)
    expect(Number.isFinite(g.finances.budget)).toBe(true)
  })

  it('dynasty moves to the next season with ageing and a summer draft', () => {
    const g = createGame(settings({ mode: 'dynasty', leagueSeason: 2015, hostClubId: 'leicester-city' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const before = Object.keys(g.squad).length
    const report = advanceToNextSeason(g, u)
    expect(g.year).toBe(2)
    expect(g.settings.leagueSeason).toBe(2016)
    expect(g.phase).toBe('draft')
    expect(g.draft!.rules.squadSize).toBeGreaterThanOrEqual(Object.keys(g.squad).length)
    expect(Object.keys(g.squad).length + report.retired.length + report.expired.length).toBe(before)
    for (const id of Object.keys(g.squad)) expect(g.customPlayers[id]).toBeTruthy()
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    expect(g.season!.leagueSeason).toBe(2016)
    expect(g.window?.kind).toBe('summer')
  })

  it('plays a 34-matchweek Bundesliga season drafting from all of Europe', () => {
    const e = loadTestUniverse(['england', 'germany', 'spain'])
    const g = createGame(settings({ leagueId: 'germany', wheelLeagues: ['england', 'germany', 'spain'], hostClubId: 'fc-augsburg', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england', 'germany', 'spain'] } }))
    autoDraft(e, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, e)
    expect(g.season!.matchweeks).toBe(34)
    expect(Object.keys(g.season!.ai).length).toBe(17)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, e, true)
    expect(g.history[0].won + g.history[0].drawn + g.history[0].lost).toBe(34)
  })
})
