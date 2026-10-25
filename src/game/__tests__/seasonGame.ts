import type { LoadedUniverse } from '@engine/universe'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import type { Game, GameSettings } from '../types'

export function seasonSettings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'season',
    seed,
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

/** A drafted season game in pre-season, then `simmed` matchweeks played through by the assistant. */
export function seasonGame(u: LoadedUniverse, seed: string, simmed = 0): Game {
  const g = createGame(seasonSettings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  for (let i = 0; i < simmed; i++) {
    playMatchweek(g, u, true)
    if (g.phase === 'match') g.phase = 'week'
  }
  return g
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
