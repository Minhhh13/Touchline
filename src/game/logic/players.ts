import type { Game } from '../types'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'

/** Player lookup that sees game-created players (dynasty progression, free agents) first. */
export function playerLookup(game: Game, u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
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
