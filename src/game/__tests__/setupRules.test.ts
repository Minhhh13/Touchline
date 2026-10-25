import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { QUICK_RULES, SEASON_RULES, autoDraft, canUse, chooseSlot, difficultyOf, eligibleSlots, isComplete, positionFirst, ratingsHidden, spin, targetSlot } from '@engine/draft'
import { ERA_PRESETS, eraCount, eraHandles, eraRange, seasonStop, wheelSeasons } from '@engine/era'
import { DAILY_RULES, createGame, dailyGameSettings, describeRules, setupRules, summariseSetup, type SetupChoices } from '../logic/setup'
import { playerLookup } from '../logic/players'
import type { GameSettings } from '../types'

const u = loadTestUniverse()
const seasons = wheelSeasons(u, ['england'])
const first = seasons[0]
const last = seasons[seasons.length - 1]

/** The setup screen as it opens for a quick draft: Normal, ratings on, Squad First, Season ratings, the full slider. */
function choices(partial: Partial<SetupChoices> = {}): SetupChoices {
  return { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: first, eraTo: last, first, last, twists: true, leagues: ['england'], ...partial }
}

function settings(rules = setupRules(QUICK_RULES, choices())): GameSettings {
  return { mode: 'quick', seed: 'SETUP-38', formationId: '4-3-3', teamName: 'Touchline XI', shortName: 'TX', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2025, rules, jobSecurity: false, difficulty: 'calibrated' }
}

describe('the era slider', () => {
  it('runs over every season the wheel leagues hold', () => {
    expect(seasons).toHaveLength(19)
    expect(first).toBe(2008)
    expect(last).toBe(2026)
    expect(seasons).toEqual([...seasons].sort((a, b) => a - b))
  })

  it('puts the handles where each preset starts, clamped to the data', () => {
    expect(eraHandles('all', first, last)).toEqual([2008, 2026])
    // 2000s+ starts before the data does, so it reads as the whole slider
    expect(eraHandles('2000s', first, last)).toEqual([2008, 2026])
    expect(eraHandles('2010s', first, last)).toEqual([2010, 2026])
    expect(eraHandles('modern', first, last)).toEqual([2016, 2026])
    // A preset that starts after the newest season pins both handles to it
    expect(eraHandles('modern', 2008, 2012)).toEqual([2012, 2012])
  })

  it('stops a handle only on seasons the data holds, even across a gap', () => {
    expect(seasonStop(seasons, 2016)).toBe(seasons.indexOf(2016))
    expect(seasonStop(seasons, 1990)).toBe(0)
    expect(seasonStop(seasons, 2040)).toBe(seasons.length - 1)
    // Older packs may leave gaps: a year in a gap snaps to the nearest season, the earlier on a tie
    const gappy = [1992, 1993, 1994, 2008, 2009]
    expect(seasonStop(gappy, 2000)).toBe(2)
    expect(seasonStop(gappy, 2003)).toBe(3)
    expect(seasonStop([2000, 2002], 2001)).toBe(0)
    expect(seasonStop([], 2016)).toBe(-1)
  })
})

describe('setupRules: the setup screen to DraftRules', () => {
  it('opens on exactly the quick defaults: Normal, ratings on, Squad First, Season ratings, all-time', () => {
    const r = setupRules(QUICK_RULES, choices())
    expect(r).toEqual({ ...QUICK_RULES, leagues: ['england'] })
    expect(r.fromSeason).toBeUndefined()
    expect(r.toSeason).toBeUndefined()
    // The Daily's literal rules are the same wheel as an untouched quick setup, but for its original 2 re-spins and no manager pick
    expect(r).toEqual({ ...DAILY_RULES, respins: 1, managers: true, leagues: ['england'] })
  })

  it('gives each difficulty card its re-spins and keeps hard mode in step', () => {
    expect(setupRules(QUICK_RULES, choices({ difficulty: 'easy' }))).toMatchObject({ difficulty: 'easy', respins: 3, hardMode: false, showRatings: true })
    expect(setupRules(QUICK_RULES, choices({ difficulty: 'normal' }))).toMatchObject({ difficulty: 'normal', respins: 1, hardMode: false, showRatings: true })
    const hard = setupRules(QUICK_RULES, choices({ difficulty: 'hard' }))
    expect(hard).toMatchObject({ difficulty: 'hard', respins: 0, hardMode: true })
    expect(difficultyOf(hard)).toBe('hard')
  })

  it('hides ratings when the card says off, and always on Hard whatever the card says', () => {
    const blind = setupRules(QUICK_RULES, choices({ showRatings: false }))
    expect(blind.showRatings).toBe(false)
    expect(blind.difficulty).toBe('normal')
    expect(ratingsHidden(blind)).toBe(true)
    const hardOn = setupRules(QUICK_RULES, choices({ difficulty: 'hard', showRatings: true }))
    expect(hardOn.showRatings).toBe(false)
    expect(ratingsHidden(hardOn)).toBe(true)
    // Back to Normal, the card's own choice comes back
    expect(setupRules(QUICK_RULES, choices({ difficulty: 'normal', showRatings: true })).showRatings).toBe(true)
  })

  it('carries the draft mode and the ratings mode', () => {
    const r = setupRules(QUICK_RULES, choices({ draftMode: 'position', ratings: 'prime' }))
    expect(r.draftMode).toBe('position')
    expect(r.ratings).toBe('prime')
  })

  it('writes a slider range as bounds, leaving out a bound at either end of the slider', () => {
    expect(setupRules(QUICK_RULES, choices({ eraFrom: 2012, eraTo: 2018 }))).toMatchObject({ fromSeason: 2012, toSeason: 2018 })
    // Handles may cross; the range is ordered
    expect(setupRules(QUICK_RULES, choices({ eraFrom: 2018, eraTo: 2012 }))).toMatchObject({ fromSeason: 2012, toSeason: 2018 })
    const toNewest = setupRules(QUICK_RULES, choices({ eraFrom: 2016, eraTo: last }))
    expect(toNewest.fromSeason).toBe(2016)
    expect(toNewest.toSeason).toBeUndefined()
    const fromOldest = setupRules(QUICK_RULES, choices({ eraFrom: first, eraTo: 2013 }))
    expect(fromOldest.fromSeason).toBeUndefined()
    expect(fromOldest.toSeason).toBe(2013)
    // Out-of-range handles clamp to the data
    const wide = setupRules(QUICK_RULES, choices({ eraFrom: 1990, eraTo: 2040 }))
    expect(wide.fromSeason).toBeUndefined()
    expect(wide.toSeason).toBeUndefined()
    // A single season is a range of one
    expect(setupRules(QUICK_RULES, choices({ eraFrom: 2019, eraTo: 2019 }))).toMatchObject({ fromSeason: 2019, toSeason: 2019 })
  })

  it('gives every preset the same bounds as eraRange, so a chip and the slider make one wheel', () => {
    for (const p of ERA_PRESETS) {
      const [a, b] = eraHandles(p.id, first, last)
      const r = setupRules(QUICK_RULES, choices({ eraFrom: a, eraTo: b }))
      const want = eraRange(p.id, first, last)
      // 2000s+ starts at the data's first season, which is no bound at all
      expect(r.fromSeason, p.id).toBe(want.fromSeason !== undefined && want.fromSeason > first ? want.fromSeason : undefined)
      expect(r.toSeason, p.id).toBeUndefined()
    }
    // The setup line under the slider: Modern is 11 of 19 seasons
    const modern = setupRules(QUICK_RULES, choices({ eraFrom: 2016, eraTo: last }))
    expect(eraCount(u, ['england'], modern)).toMatchObject({ n: 11, m: 19, label: '11 of 19 seasons', caption: '2016-17 to 2026-27' })
  })

  it('keeps the base rules of a managed season: its squad size and repeatable club-seasons', () => {
    const r = setupRules({ ...SEASON_RULES, squadSize: 20 }, choices({ difficulty: 'easy', twists: false }))
    expect(r).toMatchObject({ squadSize: 20, uniqueClubSeasons: false, respins: 3, difficulty: 'easy', twists: false })
  })

  it('passes the one-club and one-nation filters and the wheel leagues through', () => {
    const r = setupRules(QUICK_RULES, choices({ onlyNation: 'BRA', leagues: ['england', 'spain'] }))
    expect(r.onlyNation).toBe('BRA')
    expect(r.onlyClub).toBeUndefined()
    expect(r.leagues).toEqual(['england', 'spain'])
  })
})

describe('a game started from the setup cards', () => {
  it('plays Position First: a slot first, then a spin that only lands on clubs that can fill it', () => {
    const g = createGame(settings(setupRules(QUICK_RULES, choices({ draftMode: 'position', difficulty: 'easy' }))))
    const d = g.draft!
    expect(positionFirst(d)).toBe(true)
    expect(d.respinsLeft).toBe(3)
    const rng = Rng.fromState(g.rngState)
    expect(() => spin(u, d, rng)).toThrow()
    chooseSlot(u, d, 'gk')
    expect(targetSlot(d)?.position).toBe('GK')
    const cs = spin(u, d, rng)
    const fits = cs.squad.filter((p) => canUse(d, p))
    expect(fits.length).toBeGreaterThan(0)
    // Every usable player fits the chosen slot, and only that slot
    for (const p of fits) expect(eligibleSlots(d, p).map((s) => s.id)).toEqual(['gk'])
  })

  it('completes a Hard, Prime, Modern draft from the cards with no re-spins and the era respected', () => {
    const rules = setupRules(QUICK_RULES, choices({ difficulty: 'hard', ratings: 'prime', eraFrom: 2016, eraTo: last }))
    const g = createGame(settings(rules))
    expect(g.draft!.respinsLeft).toBe(0)
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    expect(isComplete(g.draft!)).toBe(true)
    for (const h of g.draft!.history) expect(h.season).toBeGreaterThanOrEqual(2016)
    // Prime ratings: every drafted player is rated at least as high as his season
    const get = playerLookup(g, u)
    for (const id of Object.values(g.draft!.lineup)) expect(get(id)!.overall).toBeGreaterThanOrEqual(u.index[id].overall)
  })
})

describe('describeRules: a fixed wheel in plain words', () => {
  it("reads the Daily's pinned rules", () => {
    expect(describeRules(u, dailyGameSettings(u, 'daily-2026-10-25').rules)).toEqual(['2 re-spins', 'Ratings on', 'Squad First', 'Season ratings', 'All-time', 'Twists on'])
  })

  it('names every option that differs', () => {
    expect(describeRules(u, setupRules(QUICK_RULES, choices({ difficulty: 'hard', draftMode: 'position', ratings: 'prime', eraFrom: 2016, eraTo: 2019, twists: false })))).toEqual(['Hard: no re-spins', 'Ratings hidden', 'Position First', 'Prime ratings', '2016-17 to 2019-20', 'No twists', 'Manager pick'])
    expect(describeRules(u, setupRules(QUICK_RULES, choices({ difficulty: 'easy', showRatings: false }))).slice(0, 2)).toEqual(['Easy: 3 re-spins', 'Ratings hidden'])
  })
})

describe('the summary line above Start', () => {
  it('stays the documented short line for the default cards', () => {
    expect(summariseSetup(u, settings())).toBe('Touchline XI, 4-3-3, in the Premier League 2025-26, calibrated, seed SETUP-38')
  })

  it('names the cards that differ from the mode defaults', () => {
    const line = summariseSetup(u, settings(setupRules(QUICK_RULES, choices({ difficulty: 'easy', showRatings: false, draftMode: 'position', ratings: 'prime', eraFrom: 2016, eraTo: last }))))
    expect(line).toBe('Touchline XI, 4-3-3, in the Premier League 2025-26, calibrated, seed SETUP-38, 2016-17 to 2026-27, easy mode, blind, Position First, prime ratings')
    expect(summariseSetup(u, settings(setupRules(QUICK_RULES, choices({ difficulty: 'hard', showRatings: false }))))).toBe('Touchline XI, 4-3-3, in the Premier League 2025-26, calibrated, seed SETUP-38, hard mode')
    // A managed season defaults to Easy, so Normal is the change there
    const season: GameSettings = { ...settings(setupRules({ ...SEASON_RULES, squadSize: 18 }, choices({ difficulty: 'normal', twists: false }))), mode: 'season', jobSecurity: true }
    expect(summariseSetup(u, season)).toBe('Touchline XI, 4-3-3, as Brentford in the Premier League 2025-26, calibrated, seed SETUP-38, normal mode, squad of 18')
  })
})
