import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { challengeFromGame } from '../logic/challenge'
import { decodeChallenge, encodeChallenge, rulesFromPayload } from '@engine/challenge'
import { classicFromFor, eraRules, eraSeasons, estimatedNote, isEstimated, leagueSeasonChoices, type EraChoice } from '../logic/era'
import { createGame, summariseSetup } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import type { GameSettings } from '../types'

const u = loadTestUniverse()
const choice = (partial: Partial<EraChoice>): EraChoice => ({ era: 'all', from: 2008, to: 2026, includeClassic: false, isDaily: false, leagues: ['england'], ...partial })

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'quick',
    seed: 'era-test',
    formationId: '4-3-3',
    teamName: 'Era XI',
    shortName: 'ERA',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'everton',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

describe('the era control', () => {
  it('maps every standard era exactly as before, with no classic key', () => {
    expect(eraRules(u, choice({ era: 'all' }))).toEqual({})
    expect('classic' in eraRules(u, choice({ era: 'all' }))).toBe(false)
    expect(eraRules(u, choice({ era: 'early' }))).toEqual({ fromSeason: 2008, toSeason: 2013 })
    expect(eraRules(u, choice({ era: 'mid' }))).toEqual({ fromSeason: 2014, toSeason: 2019 })
    expect(eraRules(u, choice({ era: 'modern' }))).toEqual({ fromSeason: 2020 })
    expect(eraRules(u, choice({ era: 'custom', from: 2016, to: 2010 }))).toEqual({ fromSeason: 2010, toSeason: 2016 })
    // The toggle only belongs to All eras
    expect(eraRules(u, choice({ era: 'mid', includeClassic: true }))).toEqual({ fromSeason: 2014, toSeason: 2019 })
  })

  it('opts in to classic seasons for Classic, a range below 2008-09, or All eras with the toggle', () => {
    expect(classicFromFor(u, ['england'])).toBe(1992)
    expect(eraRules(u, choice({ era: 'classic' }))).toEqual({ fromSeason: 1992, toSeason: 2007, classic: true })
    expect(eraRules(u, choice({ era: 'custom', from: 1995, to: 2011 }))).toEqual({ fromSeason: 1995, toSeason: 2011, classic: true })
    expect(eraRules(u, choice({ era: 'custom', from: 2007, to: 2007 }))).toEqual({ fromSeason: 2007, toSeason: 2007, classic: true })
    expect(eraRules(u, choice({ era: 'all', includeClassic: true }))).toEqual({ classic: true })
    expect(eraSeasons(u, ['england'])[0]).toBe(1992)
    expect(eraSeasons(u, ['england']).at(-1)).toBe(u.lastSeason)
  })

  it('never makes the Daily classic, nor a wheel whose leagues have no classic seasons', () => {
    for (const era of ['all', 'classic', 'early', 'custom'] as const) expect(eraRules(u, choice({ era, from: 1992, includeClassic: true, isDaily: true }))).toEqual({})
    // A league with no classic pack: the classic choices fall back to standard bounds
    const spain = choice({ leagues: ['spain'] })
    expect(classicFromFor(u, ['spain'])).toBeUndefined()
    expect(eraRules(u, { ...spain, era: 'classic' })).toEqual({})
    expect(eraRules(u, { ...spain, era: 'all', includeClassic: true })).toEqual({})
    expect(eraSeasons(u, ['spain'])[0]).toBe(u.firstSeason)
  })

  it('lists classic league seasons first, flagged, and the standard ones unflagged', () => {
    const list = leagueSeasonChoices(u, 'england')
    expect(list[0]).toEqual({ season: 1992, classic: true })
    expect(list.filter((s) => s.classic).map((s) => s.season)).toEqual(Array.from({ length: 16 }, (_, i) => 1992 + i))
    expect(list.filter((s) => !s.classic).every((s) => s.season >= 2008)).toBe(true)
  })

  it('a Classic-era draft only lands on 1992-93 to 2007-08 club-seasons, over many seeds', () => {
    const rules = { ...QUICK_RULES, leagues: ['england'], ...eraRules(u, choice({ era: 'classic' })) }
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) {
      const g = createGame(settings({ seed: `era-classic-${i}`, rules }))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      for (const h of g.draft!.history) {
        expect(h.season).toBeLessThanOrEqual(2007)
        seen.add(h.season)
      }
      expect(Object.values(g.draft!.lineup).every((id) => isEstimated(u, id))).toBe(true)
    }
    // The wheel spreads over the classic era rather than sticking to one season
    expect(seen.size).toBeGreaterThanOrEqual(12)
  })

  it('carries the classic opt-in through a challenge link and names it in the setup line', () => {
    const rules = { ...QUICK_RULES, leagues: ['england'], ...eraRules(u, choice({ era: 'classic' })) }
    const g = createGame(settings({ seed: 'era-challenge', rules }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const c = challengeFromGame(g, u, 'Classic')!
    expect(c.s.r.classic).toBe(true)
    expect(rulesFromPayload(decodeChallenge(encodeChallenge(c))).classic).toBe(true)
    expect(summariseSetup(u, settings({ seed: 's', rules }))).toContain('classic seasons (estimated ratings)')
    expect(summariseSetup(u, settings({ seed: 's' }))).not.toContain('classic')
  })
})

describe('estimated ratings', () => {
  it('marks every classic player-season estimated and no standard one', () => {
    const classic = Object.values(u.index).filter((p) => p.season < 2008)
    const standard = Object.values(u.index).filter((p) => p.season >= 2008)
    expect(classic.length).toBeGreaterThan(8000)
    expect(classic.every((p) => isEstimated(u, p.id))).toBe(true)
    expect(standard.some((p) => isEstimated(u, p.id))).toBe(false)
    // A developed copy keeps the id shape, so it reads from the id alone
    const any = classic[0]
    expect(isEstimated(u, `${any.playerId}x@${any.season}@${any.clubId}`)).toBe(true)
    expect(isEstimated(u, 'youth-1')).toBe(false)
  })

  it('writes the share note only when the XI or the league season is estimated', () => {
    const standardXi = u.clubSeasonByKey['arsenal@2015']!.squad.slice(0, 11).map((p) => p.id)
    const classicXi = u.clubSeasonByKey['arsenal@2003']!.squad.slice(0, 11).map((p) => p.id)
    expect(estimatedNote(u, standardXi, 'england', 2015)).toBeNull()
    expect(estimatedNote(u, [...standardXi.slice(0, 10), classicXi[0]], 'england', 2015)).toBe('Estimated ratings: 1 classic pick')
    expect(estimatedNote(u, classicXi, 'england', 2015)).toBe('Estimated ratings: 11 classic picks')
    expect(estimatedNote(u, standardXi, 'england', 1999)).toBe('Estimated ratings: a classic league season')
    expect(estimatedNote(u, classicXi.slice(0, 2), 'england', 1999)).toBe('Estimated ratings: 2 classic picks, a classic league season')
  })

  it('plays a quick season in a classic league season (22 clubs in 1992-93)', () => {
    const host = u.clubSeasons.find((cs) => cs.season === 1992 && cs.position === 11)!.clubId
    const g = createGame(settings({ seed: 'era-1992', leagueSeason: 1992, hostClubId: host }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const q = g.quickResult!
    expect(q.table.length).toBe(22)
    expect(q.won + q.drawn + q.lost).toBe(42)
    // The standard wheel: no classic pick without the opt-in, but the league itself is classic
    expect(Object.values(g.draft!.lineup).some((id) => isEstimated(u, id))).toBe(false)
    expect(estimatedNote(u, Object.values(g.lineup), 'england', 1992)).toBe('Estimated ratings: a classic league season')
  })
})
