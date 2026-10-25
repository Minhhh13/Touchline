import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { challengeFromGame } from '../logic/challenge'
import { decodeChallenge, encodeChallenge, rulesFromPayload } from '@engine/challenge'
import { classicFromFor, estimatedNote, isEstimated, leagueSeasonChoices } from '../logic/era'
import { eraCount, wheelSeasons } from '@engine/era'
import { beginSeason, createGame, setupRules, summariseSetup, type SetupChoices } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason, ageOneYear } from '../logic/dynasty'
import { playerLookup } from '../logic/players'
import { SEASON_RULES } from '@engine/draft'
import { runQuickSeason } from '../logic/quick'
import type { GameSettings } from '../types'

const u = loadTestUniverse()
// The setup screen's choices with the slider over England; `classic` is the Classic toggle, which moves the slider's first stop to 1992-93
const choices = (partial: Partial<SetupChoices>): SetupChoices => ({ difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: 2008, eraTo: u.lastSeason, first: partial.classic ? 1992 : 2008, last: u.lastSeason, twists: true, leagues: ['england'], ...partial })
/** What the Classic toggle sets on: the slider's handles on 1992-93 and 2007-08. */
const classicEra = () => setupRules(QUICK_RULES, choices({ classic: true, eraFrom: 1992, eraTo: 2007 }))

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
  it('a standard setup writes no classic key and its slider stops at the standard seasons', () => {
    expect(wheelSeasons(u, ['england'])[0]).toBe(2008)
    expect(wheelSeasons(u, ['england'])).toHaveLength(u.lastSeason - 2008 + 1)
    const full = setupRules(QUICK_RULES, choices({ eraFrom: 2008, eraTo: u.lastSeason, first: 2008 }))
    expect('classic' in full).toBe(false)
    expect(full.fromSeason).toBeUndefined()
    expect(full.toSeason).toBeUndefined()
    expect(eraCount(u, ['england'], {}).m).toBe(u.lastSeason - 2008 + 1)
  })

  it('the Classic toggle opts in: the slider reaches 1992-93 and the rules carry classic', () => {
    expect(classicFromFor(u, ['england'])).toBe(1992)
    const stops = wheelSeasons(u, ['england'], true)
    expect(stops[0]).toBe(1992)
    expect(stops).toHaveLength(u.lastSeason - 1992 + 1)
    expect(setupRules(QUICK_RULES, choices({ classic: true, eraFrom: 1992, eraTo: 2007 }))).toMatchObject({ fromSeason: undefined, toSeason: 2007, classic: true })
    expect(setupRules(QUICK_RULES, choices({ classic: true, eraFrom: 1995, eraTo: 2011 }))).toMatchObject({ fromSeason: 1995, toSeason: 2011, classic: true })
    // A full slider with the toggle on is every season, classic ones included
    expect(setupRules(QUICK_RULES, choices({ classic: true, eraFrom: 1992, eraTo: u.lastSeason }))).toMatchObject({ fromSeason: undefined, toSeason: undefined, classic: true })
    expect(eraCount(u, ['england'], { classic: true }).m).toBe(u.lastSeason - 1992 + 1)
  })

  it('a wheel whose leagues have no classic seasons never reaches them', () => {
    const two = loadTestUniverse(['england', 'spain'])
    expect(classicFromFor(two, ['spain'])).toBeUndefined()
    expect(wheelSeasons(two, ['spain'], true)).toEqual(wheelSeasons(two, ['spain']))
    expect(wheelSeasons(two, ['spain'], true)[0]).toBe(two.firstSeason)
  })

  it('lists classic league seasons first, flagged, and the standard ones unflagged', () => {
    const list = leagueSeasonChoices(u, 'england')
    expect(list[0]).toEqual({ season: 1992, classic: true })
    expect(list.filter((s) => s.classic).map((s) => s.season)).toEqual(Array.from({ length: 16 }, (_, i) => 1992 + i))
    expect(list.filter((s) => !s.classic).every((s) => s.season >= 2008)).toBe(true)
  })

  it('a Classic-era draft only lands on 1992-93 to 2007-08 club-seasons, over many seeds', () => {
    const rules = classicEra()
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
    const rules = classicEra()
    const g = createGame(settings({ seed: 'era-challenge', rules }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const c = challengeFromGame(g, u, 'Classic')!
    expect(c.s.r.classic).toBe(true)
    expect(rulesFromPayload(decodeChallenge(encodeChallenge(c))).classic).toBe(true)
    expect(summariseSetup(u, settings({ seed: 's', rules }))).toContain('classic seasons (estimated ratings)')
    // The range reads from the first classic season, not from 2008-09
    expect(summariseSetup(u, settings({ seed: 's', rules }))).toContain('1992-93 to 2007-08')
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

  it('still marks a dynasty\'s aged copy of a classic player, whose id names no season', () => {
    const classic = u.clubSeasonByKey['arsenal@2003']!.squad[0]
    const standard = u.clubSeasonByKey['arsenal@2015']!.squad[0]
    const aged = ageOneYear(classic, new Rng('era-aged'), 2)
    expect(aged.id).toBe(`${classic.playerId}@dyn2`)
    expect(isEstimated(u, aged)).toBe(true)
    expect(isEstimated(u, ageOneYear(standard, new Rng('era-aged'), 2))).toBe(false)
    expect(estimatedNote(u, [aged, standard.id], 'england', 2015)).toBe('Estimated ratings: 1 classic pick')
  })

  it('runs a classic-era dynasty from 2007-08 into 2008-09, labels and all', () => {
    const rules = { ...SEASON_RULES, leagues: ['england'], fromSeason: 1992, toSeason: 2007, classic: true }
    const host = u.clubSeasons.find((cs) => cs.season === 2007 && cs.position === 10)!.clubId
    const g = createGame(settings({ mode: 'dynasty', seed: 'era-dynasty', leagueSeason: 2007, hostClubId: host, rules }))
    let rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    const get = playerLookup(g, u)
    const before = Object.values(g.lineup).map((id) => get(id)!)
    expect(before.every((p) => isEstimated(u, p))).toBe(true)
    advanceToNextSeason(g, u)
    expect(g.settings.leagueSeason).toBe(2008)
    // The kept players are aged copies now, still counted as estimated by the club-season they came from
    const kept = Object.keys(g.squad).map((id) => playerLookup(g, u)(id)!)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((p) => p.id.includes('@dyn') && isEstimated(u, p))).toBe(true)
    rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginSeason(g, u)
    expect(g.season!.leagueSeason).toBe(2008)
    expect(Object.keys(g.season!.ai).length).toBe(19)
  })
})
