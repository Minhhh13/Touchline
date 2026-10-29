import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { applyEventChoice, playMatchweek, startSeasonProper } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function started(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const weekScores = (g: Game) => g.season!.fixtures.filter((f) => f.matchweek === g.season!.matchweek).map((f) => `${f.homeTeamId}-${f.awayTeamId} ${f.result?.homeGoals}:${f.result?.awayGoals}`)

describe('a simmed week after an event (engine 8)', () => {
  it('plays its matches on the stream the event left, as if the event had been answered first', { timeout: 120_000 }, () => {
    let events = 0
    let moved = 0
    for (let s = 0; s < 12; s++) {
      const g = started(`sim-event-${s}`)
      while (!g.pendingEvent && g.season!.matchweek < 12) playMatchweek(g, u, true)
      if (!g.pendingEvent) continue
      events++
      // The assistant's answer (the second choice), given by hand before the week
      const answered = clone(g)
      const ev = answered.pendingEvent!
      applyEventChoice(answered, u, ev.choices[Math.min(1, ev.choices.length - 1)].id)
      // Engine 7's stream: the week built before the event drew
      const unanswered = clone(g)
      unanswered.pendingEvent = null
      playMatchweek(g, u, true)
      playMatchweek(answered, u, true)
      playMatchweek(unanswered, u, true)
      expect(weekScores(g), `seed ${s}`).toEqual(weekScores(answered))
      expect(g.rngState).toEqual(answered.rngState)
      if (weekScores(g).join() !== weekScores(unanswered).join()) moved++
    }
    expect(events).toBeGreaterThan(3)
    // The event's draws reach the week's matches: engine 7 reused them
    expect(moved).toBeGreaterThan(0)
  })
})
