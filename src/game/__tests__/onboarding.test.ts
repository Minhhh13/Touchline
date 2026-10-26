import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { createGame, defaultHostClub, quickSetupLine, summariseSetup } from '../logic/setup'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { FIRST_RUN_STEPS, firstDraftSettings, firstResultNext, isNewcomer, resultsFinished } from '../logic/onboarding'
import type { LeaderboardEntry, Profile } from '../types'

const u = loadTestUniverse(['england'])

const fresh: Profile = { achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' }
const entry = { points: 70 } as unknown as LeaderboardEntry

describe('who counts as new', () => {
  it('is a profile with nothing finished and no game waiting', () => {
    expect(isNewcomer(fresh, false)).toBe(true)
    expect(isNewcomer(fresh, true)).toBe(false)
    // A first draft abandoned before its season: still new
    const abandoned: Profile = { ...fresh, gamesPlayed: 3 }
    expect(isNewcomer(abandoned, false)).toBe(true)
  })

  it('stops at the first result of any kind, older saves included', () => {
    expect(isNewcomer({ ...fresh, leaderboard: [entry] }, false)).toBe(false)
    expect(isNewcomer({ ...fresh, seasonsSimulated: 4 }, false)).toBe(false)
    expect(isNewcomer({ ...fresh, dailyResults: { 'daily-2026-10-01': { points: 60, tier: 'MID_TABLE' } } }, false)).toBe(false)
    expect(isNewcomer({ ...fresh, arenaRuns: [{} as never] }, false)).toBe(false)
    expect(isNewcomer({ ...fresh, runIns: [{} as never] }, false)).toBe(false)
    expect(isNewcomer({ ...fresh, cabinet: { h2h: { played: 1 } } as Profile['cabinet'] }, false)).toBe(false)
  })

  it('counts a quick season once though it is on the board, the season count and the Daily', () => {
    expect(resultsFinished({ ...fresh, leaderboard: [entry], seasonsSimulated: 1, dailyResults: { 'daily-2026-10-26': { points: 60, tier: 'MID_TABLE' } } })).toBe(1)
  })
})

describe('the first draft', () => {
  const s = firstDraftSettings(u, 'FIRST-RUN-1')!

  it("is an untouched Quick Draft setup: the line Setup shows above Start Draft", () => {
    expect(s).not.toBeNull()
    expect(quickSetupLine(u, s)).toBe('Touchline XI · 4-3-3 · Normal · Prime ratings · bench 1')
    expect(s).toMatchObject({ mode: 'quick', seed: 'FIRST-RUN-1', formationId: '4-3-3', teamName: 'Touchline XI', leagueId: 'england', wheelLeagues: ['england'], difficulty: 'calibrated', january: true, jobSecurity: false, continental: false })
    expect(s.rules).toEqual({ ...QUICK_RULES, leagues: ['england'], ratings: 'prime', benchPicks: 1, managerSpin: true, endCase: true })
    expect(s.rules.budget).toBeUndefined()
    expect(s.rules.fromSeason).toBeUndefined()
  })

  it("plays the Premier League's newest complete season in a mid-table club's place", () => {
    const newest = Math.max(...u.clubSeasons.filter((cs) => cs.complete).map((cs) => cs.season))
    expect(s.leagueSeason).toBe(newest)
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === newest).map((cs) => cs.clubId).sort((a, b) => u.clubById[a].name.localeCompare(u.clubById[b].name))
    expect(s.hostClubId).toBe(defaultHostClub(u, 'england', newest, clubs))
    expect(summariseSetup(u, s)).toContain('Premier League')
  })

  it('draws nothing: the same seed gives the same settings, another seed only another seed', () => {
    expect(firstDraftSettings(u, 'FIRST-RUN-1')).toEqual(s)
    expect({ ...firstDraftSettings(u, 'FIRST-RUN-2')!, seed: 'FIRST-RUN-1' }).toEqual(s)
  })

  it('drafts and plays a whole season over many seeds', () => {
    for (let i = 0; i < 6; i++) {
      const g = createGame(firstDraftSettings(u, `FIRST-RUN-SEASON-${i}`)!)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, u)
      kickOff(g, u, true)
      expect(g.phase).toBe('january')
      closeJanuary(g, u, null)
      expect(g.quickResult?.results?.length).toBe(38)
    }
  }, 120_000)

  it('is null without the Premier League loaded', () => {
    expect(firstDraftSettings({ ...u, clubSeasons: u.clubSeasons.filter((cs) => cs.leagueId !== 'england') }, 'X')).toBeNull()
  })

  it('explains the game in three short steps', () => {
    expect(FIRST_RUN_STEPS.map((x) => x.title)).toEqual(['Spin', 'Draft', 'Play'])
    for (const x of FIRST_RUN_STEPS) expect(x.line.length).toBeLessThanOrEqual(64)
  })
})

describe('after the first result', () => {
  const one = { ...fresh, leaderboard: [entry], seasonsSimulated: 1 }

  it("offers today's Daily and another draft after a first Quick Draft", () => {
    expect(firstResultNext(one, 'quick', false)).toEqual(['daily', 'quick'])
    expect(firstResultNext(one, 'quick', true)).toEqual(['quick'])
    expect(firstResultNext(one, 'weekly', false)).toEqual(['daily', 'quick'])
  })

  it('offers a draft of your own after a first Daily', () => {
    expect(firstResultNext(one, 'daily', true)).toEqual(['quick'])
  })

  it('stays out of every later result and of the managed modes', () => {
    expect(firstResultNext({ ...one, leaderboard: [entry, entry], seasonsSimulated: 2 }, 'quick', false)).toBeNull()
    expect(firstResultNext(fresh, 'quick', false)).toBeNull()
    expect(firstResultNext(one, 'season', false)).toBeNull()
    expect(firstResultNext(one, 'arena', false)).toBeNull()
  })
})
