import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { h2hAutoPick, h2hComplete, h2hSpin, newH2HDraft } from '@engine/h2h'
import { Rng } from '@engine/rng'
import { runInJob } from '@engine/scenario'
import { USER_TEAM } from '@engine/season'
import type { Fixture } from '@engine/types'
import { advanceToNextSeason } from '../logic/dynasty'
import { h2hRules, runH2HSeason, type H2HManager } from '../logic/h2h'
import { closeJanuary, kickOff, toKickoff } from '../logic/quick'
import { beginRunIn, runInGameSettings, seedRunInDraft } from '../logic/runin'
import { beginSeason, createGame, dailyGameSettings } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import type { GameSettings } from '../types'
import { seasonGame, seasonSettings } from './seasonGame'

/**
 * TL-05 through every mode that plays a league: no side is home or away more than twice running. The playtest's
 * head-to-head (seed QEWA-3V9H, the Premier League 2025-26, Manager 1 for Chelsea in a 4-3-3, Manager 2 for Arsenal
 * in a 4-4-2, calibrated, the assistant drafting both) had Manager 2 away in all of matchweeks 1 to 19 and at home in
 * all of 20 to 38 on ENGINE_VERSION 4.
 */
const u = loadTestUniverse(['england'])
const longestRun = (xs: boolean[]) => xs.reduce((acc, x, i) => { const cur = i > 0 && x === xs[i - 1] ? acc.cur + 1 : 1; return { cur, best: Math.max(acc.best, cur) } }, { cur: 0, best: 0 }).best
const venuesOf = (fixtures: Fixture[], id: string) => fixtures.filter((f) => f.homeTeamId === id || f.awayTeamId === id).sort((a, b) => a.matchweek - b.matchweek).map((f) => f.homeTeamId === id)

describe('home and away all season (TL-05)', { timeout: 300_000 }, () => {
  it('the playtest head-to-head alternates for both managers', () => {
    const managers: [H2HManager, H2HManager] = [
      { name: 'Manager 1', shortName: 'MA1', formationId: '4-3-3', hostClubId: 'chelsea' },
      { name: 'Manager 2', shortName: 'MA2', formationId: '4-4-2', hostClubId: 'arsenal' },
    ]
    const rng = new Rng('QEWA-3V9H')
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], h2hRules(['england'], false))
    while (!h2hComplete(h)) {
      h2hSpin(u, h, rng)
      for (let guard = 0; h.picking !== null && guard < 4; guard++) h2hAutoPick(u, h)
    }
    const res = runH2HSeason(u, rng, managers, h.drafts, 'england', 2025, 'calibrated')
    for (const games of res.results!) {
      const home = games.map((g) => g.home)
      expect(home).toHaveLength(38)
      expect(home.filter(Boolean)).toHaveLength(19)
      expect(longestRun(home)).toBeLessThanOrEqual(2)
      // Both halves mix home and away (the playtest's Manager 2 had none at home before matchweek 20)
      expect(home.slice(0, 19).filter(Boolean).length).toBeGreaterThanOrEqual(9)
    }
  })

  it('Quick Draft and the Daily', () => {
    const quick: GameSettings = { mode: 'quick', seed: 'venues-quick', formationId: '4-3-3', teamName: 'Venue XI', shortName: 'VEN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false }
    for (const s of [quick, dailyGameSettings(u, 'daily-2026-10-26')]) {
      const g = createGame(s)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      toKickoff(g, u)
      kickOff(g, u, true)
      if (g.phase === 'january') closeJanuary(g, u, null)
      const home = g.quickResult!.results!.map((r) => r.home)
      expect(home.length).toBeGreaterThanOrEqual(34)
      expect(longestRun(home)).toBeLessThanOrEqual(2)
    }
  })

  it('Season, every club of the league', () => {
    const g = seasonGame(u, 'venues-season')
    const ids = [USER_TEAM, ...Object.keys(g.season!.ai)]
    expect(ids).toHaveLength(20)
    for (const id of ids) expect(longestRun(venuesOf(g.season!.fixtures, id))).toBeLessThanOrEqual(2)
  })

  it('a Dynasty season and the one after the summer', () => {
    const d = createGame(seasonSettings('venues-dynasty', { mode: 'dynasty' }))
    const rng = Rng.fromState(d.rngState)
    autoDraft(u, d.draft!, rng)
    d.rngState = rng.getState()
    beginSeason(d, u)
    startSeasonProper(d)
    expect(longestRun(venuesOf(d.season!.fixtures, USER_TEAM))).toBeLessThanOrEqual(2)
    for (let i = 0; i < 40 && d.phase !== 'summary'; i++) {
      playMatchweek(d, u, true)
      if (d.phase === 'match') d.phase = 'week'
    }
    expect(d.phase).toBe('summary')
    advanceToNextSeason(d, u)
    if (d.draft) {
      const r = Rng.fromState(d.rngState)
      autoDraft(u, d.draft, r)
      d.rngState = r.getState()
    }
    if (d.phase === 'draft') beginSeason(d, u)
    expect(d.year).toBe(2)
    expect(longestRun(venuesOf(d.season!.fixtures, USER_TEAM))).toBeLessThanOrEqual(2)
  })

  it('a Run-in', () => {
    const job = runInJob(u, 'survival', 'england', 2015, 'norwich-city')!
    const g = createGame(runInGameSettings(u, job, { seed: 'TX3U-SU25' }))
    seedRunInDraft(g, u)
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginRunIn(g, u)
    expect(longestRun(venuesOf(g.season!.fixtures, USER_TEAM))).toBeLessThanOrEqual(2)
  })
})
