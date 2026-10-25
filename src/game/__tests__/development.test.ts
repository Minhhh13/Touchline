import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { developSquad, growthRate, DEVELOPMENT_INTERVAL } from '../logic/development'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { playerLookup } from '../logic/players'
import type { GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'dev-test',
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

describe('development and legends', () => {
  const u = loadTestUniverse()

  it('young regulars grow, veterans fade, ids stay stable', () => {
    const g = createGame(settings())
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    expect(growthRate(19)).toBeGreaterThan(growthRate(25))
    expect(growthRate(34)).toBeLessThan(0)
    const get = playerLookup(g, u)
    // Simulate a block of full minutes for everyone, then develop with a coach
    for (const s of Object.values(g.squad)) s.seasonStats.minutes = DEVELOPMENT_INTERVAL * 90
    g.staff = { coach: 2 }
    const before = Object.fromEntries(Object.keys(g.squad).map((id) => [id, get(id)!.overall]))
    const rng = new Rng('dev')
    // Run several blocks worth of growth to see the direction clearly
    let changes = 0
    for (let i = 0; i < 6; i++) {
      for (const s of Object.values(g.squad)) s.seasonStats.minutes += DEVELOPMENT_INTERVAL * 90
      changes += developSquad(g, u, rng).length
    }
    expect(changes).toBeGreaterThan(0)
    for (const id of Object.keys(g.squad)) {
      const p = get(id)!
      expect(p.id).toBe(id)
      const age = p.age
      if (age <= 21 && p.overall < 85) expect(p.overall).toBeGreaterThanOrEqual(before[id])
      if (age >= 33) expect(p.overall).toBeLessThanOrEqual(before[id])
      expect(g.development![id].base).toBe(before[id])
    }
    // A player who never played does not grow
    const g2 = createGame(settings({ seed: 'dev-idle' }))
    autoDraft(u, g2.draft!, Rng.fromState(g2.rngState))
    beginSeason(g2, u)
    const get2 = playerLookup(g2, u)
    const young = Object.keys(g2.squad).find((id) => get2(id)!.age <= 21)
    const out = developSquad(g2, u, new Rng('idle'))
    if (young) expect(out.find((c) => c.id === young)).toBeUndefined()
  })

  it('a season produces development reports and all-time records', () => {
    const g = createGame(settings({ seed: 'dev-season' }))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(g.season!.news.some((n) => n.title === 'Development report')).toBe(true)
    const career = g.careerStats!
    expect(Object.keys(career).length).toBeGreaterThan(10)
    const totalApps = Object.values(career).reduce((s, r) => s + r.apps, 0)
    expect(totalApps).toBeGreaterThanOrEqual(38 * 11)
    for (const r of Object.values(career)) {
      expect(r.seasons).toBe(1)
      expect(r.lastYear).toBe(1)
    }
  })
})
