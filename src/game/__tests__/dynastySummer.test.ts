import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { ownedHumans, SQUAD_CAP } from '../logic/marketOps'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function settings(seed: string, squadSize: number): GameSettings {
  return { mode: 'dynasty', seed, formationId: '4-3-3', teamName: 'Summer XI', shortName: 'SUM', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'], squadSize }, jobSecurity: false, difficulty: 'calibrated' }
}

/** A dynasty's first season drafted by the assistant and simulated to its summary. */
function firstSeason(seed: string, squadSize: number): Game {
  const g = createGame(settings(seed, squadSize))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  while (g.phase !== 'summary') playMatchweek(g, u, true)
  return g
}

describe('the dynasty summer', () => {
  it('never drafts past the squad cap: a 22-man squad and its bonus spins used to reach 24', () => {
    for (const seed of ['summer-cap-1', 'summer-cap-2', 'summer-cap-3']) {
      const g = firstSeason(seed, 22)
      const before = Object.keys(g.squad).length
      advanceToNextSeason(g, u)
      expect(g.draft!.rules.squadSize, seed).toBeLessThanOrEqual(SQUAD_CAP)
      // Still a spin or two whenever the cap has room
      expect(g.draft!.rules.squadSize, seed).toBeGreaterThan(Math.min(SQUAD_CAP - 1, Object.keys(g.squad).length))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginSeason(g, u)
      expect(Object.keys(g.squad).length, `${seed} from ${before}`).toBeLessThanOrEqual(SQUAD_CAP)
    }
  })

  it('a retired man never comes back younger, on the summer wheel or the market', () => {
    let retirements = 0
    for (const seed of ['summer-retire-1', 'summer-retire-2', 'summer-retire-3', 'summer-retire-4']) {
      const g = firstSeason(seed, 20)
      // Two veterans of 37 (nine in ten retire at that age): their real ids must stay out of every pool afterwards
      const get = playerLookup(g, u)
      const ids = Object.keys(g.squad).slice(0, 2)
      for (const id of ids) g.customPlayers[id] = { ...get(id)!, age: 37 }
      const people = ids.map((id) => get(id)!.playerId)
      const report = advanceToNextSeason(g, u)
      const gone = people.filter((pid) => !Object.keys(g.squad).some((id) => playerLookup(g, u)(id)?.playerId === pid))
      retirements += report.retired.length
      for (const pid of gone) {
        expect(g.retiredPlayers, seed).toContain(pid)
        expect(g.draft!.takenPlayers, seed).toContain(pid)
        expect(ownedHumans(g, u).has(pid), seed).toBe(true)
        expect(g.window!.listings.some((l) => u.index[l.playerSeasonId]?.playerId === pid), seed).toBe(false)
      }
      // The summer wheel then drafts around them, and they stay barred a season later
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      const picked = [...Object.values(g.draft!.lineup), ...g.draft!.bench].map((id) => playerLookup(g, u)(id)?.playerId)
      for (const pid of gone) expect(picked, seed).not.toContain(pid)
      beginSeason(g, u)
      startSeasonProper(g)
      while (g.phase !== 'summary') playMatchweek(g, u, true)
      advanceToNextSeason(g, u)
      for (const pid of gone) expect(g.draft!.takenPlayers, `${seed} year 3`).toContain(pid)
    }
    expect(retirements).toBeGreaterThan(3)
  }, 120_000)
})

describe('the dynasty summer and the game-made players', () => {
  it("keeps only the copies the new season's squad (and the academy) still use, so the save does not grow a squad a year", () => {
    for (const seed of ['summer-copies-1', 'summer-copies-2']) {
      const g = firstSeason(seed, 20)
      const sizes: number[] = []
      for (let year = 0; year < 2; year++) {
        advanceToNextSeason(g, u)
        const keep = new Set([...Object.keys(g.squad), ...(g.youthIntake?.candidates ?? [])])
        expect(Object.keys(g.customPlayers).filter((id) => !keep.has(id)), seed).toEqual([])
        // Every man of the new season still resolves, as himself
        for (const id of Object.keys(g.squad)) expect(playerLookup(g, u)(id)?.id, seed).toBe(id)
        sizes.push(Object.keys(g.customPlayers).length)
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        g.rngState = rng.getState()
        beginSeason(g, u)
        startSeasonProper(g, u)
        while (g.phase !== 'summary') playMatchweek(g, u, true)
      }
      expect(sizes[1], seed).toBeLessThanOrEqual(SQUAD_CAP + 3)
    }
  })
})
