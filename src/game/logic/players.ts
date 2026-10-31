import type { Game } from '../types'
import type { PlayerSeason, SquadPlayer } from '@engine/types'
import type { LoadedUniverse } from '@engine/universe'
import { ratingsModeOf } from '@engine/draft'
import { primeLookup } from '@engine/prime'
import { boostedPlayer } from '@engine/upgrader'
import { draftBoost } from '@engine/powerups'
import { reserveKeeperById } from '@engine/reserve'

/**
 * Player lookup that sees game-created players (dynasty progression, free agents) first. Under the
 * Prime ratings rule every real player-season comes back at its player's career-best overall and
 * attributes in the draft's wheel leagues (`src/engine/prime.ts`), so the draft list, team strength
 * and the quick season all rate him there; game-created players are never re-rated. The Player Upgrader's result
 * (`game.draft.upgrade`, kept with a quick game's draft) moves that one player's rating on top, as an override, and so does the Captain's armband power-up (`draftBoost`).
 */
export function playerLookup(game: Game, u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
  const base = basicLookup(game, u)
  const d = game.draft
  if (!d || (!d.upgrade?.delta && !d.powerUps?.length)) return base
  return (id: string) => {
    const p = base(id)
    const delta = p ? draftBoost(d, id) : 0
    return p && delta ? boostedPlayer(p, delta) : p
  }
}

function basicLookup(game: Game, u: LoadedUniverse): (id: string) => PlayerSeason | undefined {
  if (ratingsModeOf(game.settings.rules) === 'prime') {
    const { leagues, classic } = game.settings.rules
    return (id: string) => game.customPlayers[id] ?? primeLookup(u, id, leagues, classic) ?? reserveKeeperById(u, id)
  }
  // An AI side's reserve keeper (E6-5) is never in the index: screens that name a match's men still find him
  return (id: string) => game.customPlayers[id] ?? u.index[id] ?? reserveKeeperById(u, id)
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
