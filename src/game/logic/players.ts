import type { Game } from '../types'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ratingsModeOf } from '@engine/draft'
import { primeLookup } from '@engine/prime'

/**
 * Player lookup that sees game-created players (dynasty progression, free agents) first. Under the
 * Prime ratings rule every real player-season comes back at its player's career-best overall and
 * attributes in the draft's wheel leagues (`src/engine/prime.ts`), so the draft list, team strength
 * and the quick season all rate him there; game-created players are never re-rated.
 */
export function playerLookup(game: Game, u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
  if (ratingsModeOf(game.settings.rules) === 'prime') {
    const { leagues, classic } = game.settings.rules
    return (id: string) => game.customPlayers[id] ?? primeLookup(u, id, leagues, classic)
  }
  return (id: string) => game.customPlayers[id] ?? u.index[id]
}

export function squadPlayers(game: Game, u: LoadedUniverse): Array<{ p: PlayerSeason; s: SquadPlayer }> {
  const get = playerLookup(game, u)
  const out: Array<{ p: PlayerSeason; s: SquadPlayer }> = []
  for (const id of Object.keys(game.squad)) {
    const p = get(id)
    if (p) out.push({ p, s: game.squad[id] })
  }
  return out
}

export function isAvailable(s: SquadPlayer | undefined): boolean {
  return !!s && !s.injury && s.suspension <= 0
}
