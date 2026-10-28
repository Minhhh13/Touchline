/**
 * QA round 3 (r8) fixes in game logic, each pinned on its own (the sweeps in `qaR8*.test.ts` found them).
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { playerLookup } from '../logic/players'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function dynasty(seed: string): GameSettings {
  return { mode: 'dynasty', seed, formationId: '4-3-3', teamName: 'R8 Fix', shortName: 'R8F', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2018, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', continental: false }
}

describe('R8-2: the January window never lists a man who retired from a Dynasty squad', () => {
  it('bars every retired player id, as the summer window and the market do', () => {
    for (const seed of ['r8-jan-1', 'r8-jan-2', 'r8-jan-3']) {
      const g = createGame(dynasty(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      startSeasonProper(g, u)
      // A Dynasty some summers in: half the league's players retired (by real player id, every season of them)
      const ids = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === 'england').flatMap((cs) => cs.squad.map((p) => p.playerId)))]
      g.retiredPlayers = ids.filter((_, i) => i % 2 === 0)
      const retired = new Set(g.retiredPlayers)
      while (g.window?.kind !== 'january' && g.phase !== 'summary') playMatchweek(g, u, true)
      expect(g.window?.kind).toBe('january')
      const get = playerLookup(g, u)
      const listed = g.window!.listings.map((l) => get(l.playerSeasonId)!)
      expect(listed.length).toBeGreaterThan(5)
      expect(listed.filter((p) => retired.has(p.playerId)).map((p) => p.name)).toEqual([])
    }
  }, 120_000)
})
