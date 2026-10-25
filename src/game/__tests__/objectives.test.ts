import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { evaluateObjective, pickObjectives, OBJECTIVE_REWARD } from '@engine/objectives'
import { squadPlayers } from '../logic/players'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed: 'obj-test',
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

describe('board objectives', () => {
  const u = loadTestUniverse()

  it('sets two objectives, tracks them and pays out at the end', () => {
    const picked = pickObjectives(new Rng('o'), 3, 38, true, true)
    expect(picked.length).toBe(2)
    expect(new Set(picked.map((o) => o.id)).size).toBe(2)
    expect(pickObjectives(new Rng('o2'), 12, 34, false, false).every((o) => o.id !== 'continental-qf' && o.id !== 'rivals' && o.id !== 'cup-sf')).toBe(true)
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    const season = g.season!
    expect(season.objectives?.length).toBe(2)
    expect(season.news.some((n) => n.title === 'Board objectives')).toBe(true)
    startSeasonProper(g)
    const ctx = () => ({ season: g.season!, squad: squadPlayers(g, u), rivals: u.clubById['everton']?.rivals ?? [] })
    for (const o of season.objectives!) expect(typeof evaluateObjective(o, ctx()).progress).toBe('string')
    const budgetBefore = () => g.finances.budget
    void budgetBefore
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const done = g.season!.objectives!
    for (const o of done) expect(typeof o.met).toBe('boolean')
    const metCount = done.filter((o) => o.met).length
    const report = g.season!.news.find((n) => n.title.startsWith('Board objectives:'))
    expect(report?.title).toBe(`Board objectives: ${metCount} of 2 met`)
    if (metCount) expect(report?.body).toContain(`£${metCount * OBJECTIVE_REWARD.budget}M`)
    // The verdict matches a fresh evaluation of the finished season
    for (const o of done) expect(evaluateObjective(o, ctx()).met).toBe(o.met)
  })
})
