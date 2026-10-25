import type { LoadedUniverse } from '@engine/universe'
import { clubIdOfKey } from '@engine/knockout'
import { GAUNTLET_RUNGS } from '@engine/gauntlet'
import type { ArenaState } from '@game/types'
import { arenaClubName, stepWon } from '@game/logic/arena'
import { ClubBadge } from './bits'

/**
 * The Gauntlet's fifteen rungs in a row: the rungs climbed as club codes in
 * green, the defeat in red, the rung up next with its badge, the rest by
 * number.
 */
export function GauntletLadder({ u, a }: { u: LoadedUniverse; a: ArenaState }) {
  const code = (key: string) => u.clubById[clubIdOfKey(key)]?.code ?? clubIdOfKey(key).slice(0, 3).toUpperCase()
  return (
    <div className="row wrap" style={{ gap: 6 }} data-testid="gauntlet-ladder">
      {Array.from({ length: GAUNTLET_RUNGS }, (_, i) => {
        const played = a.log[i]
        if (played) {
          const won = stepWon(played)
          return (
            <span key={i} className={`chip ${won ? 'good' : 'bad'}`} title={`Rung ${i + 1}: ${played.gf}-${played.ga}${played.pens ? ` (${played.pens.us}-${played.pens.them} pens)` : ''} v ${arenaClubName(u, played.opponent)}`} data-testid={won ? 'rung-won' : 'rung-lost'}>
              {code(played.opponent)}
            </span>
          )
        }
        if (i === a.step && !a.over && a.next) {
          return (
            <span key={i} className="chip gold" title={`Rung ${i + 1}: ${arenaClubName(u, a.next)}`} data-testid="rung-next">
              <ClubBadge clubId={clubIdOfKey(a.next)} size={18} /> {i + 1}
            </span>
          )
        }
        return (
          <span key={i} className="chip" style={{ opacity: 0.6 }}>
            {i + 1}
          </span>
        )
      })}
    </div>
  )
}
