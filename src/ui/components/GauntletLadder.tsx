import type { LoadedUniverse } from '@engine/universe'
import { clubIdOfKey } from '@engine/knockout'
import { GAUNTLET_RUNGS } from '@engine/gauntlet'
import type { ArenaState, ChallengeSettings } from '@game/types'
import { ghostStepLine } from '@game/logic/arenaClaim'
import { arenaClubName, stepWon } from '@game/logic/arena'
import { ClubBadge } from './bits'

/**
 * The Gauntlet's fifteen rungs in a row: the rungs climbed as club codes in
 * green, the defeat in red, the rung up next with its badge, the rest by
 * number. A challenge's ghost marks the rung where the challenger fell (👻)
 * and names his score on every rung he played.
 */
export function GauntletLadder({ u, a, ghost }: { u: LoadedUniverse; a: ArenaState; ghost?: Pick<ChallengeSettings, 'name' | 'arena'> }) {
  const code = (key: string) => u.clubById[clubIdOfKey(key)]?.code ?? clubIdOfKey(key).slice(0, 3).toUpperCase()
  const fell = ghost?.arena && !ghost.arena.claim.w ? ghost.arena.claim.g.length - 1 : -1
  const mark = (i: number) => (i === fell ? ' 👻' : '')
  const note = (i: number) => (ghost?.arena ? ` · ${ghostStepLine(ghost, i)}` : '')
  return (
    <div className="row wrap" style={{ gap: 6 }} data-testid="gauntlet-ladder">
      {Array.from({ length: GAUNTLET_RUNGS }, (_, i) => {
        const played = a.log[i]
        if (played) {
          const won = stepWon(played)
          return (
            <span key={i} className={`chip ${won ? 'good' : 'bad'}`} title={`Rung ${i + 1}: ${played.gf}-${played.ga}${played.pens ? ` (${played.pens.us}-${played.pens.them} pens)` : ''} v ${arenaClubName(u, played.opponent)}${note(i)}`} data-testid={won ? 'rung-won' : 'rung-lost'}>
              {code(played.opponent)}
              {mark(i)}
            </span>
          )
        }
        if (i === a.step && !a.over && a.next) {
          return (
            <span key={i} className="chip gold" title={`Rung ${i + 1}: ${arenaClubName(u, a.next)}${note(i)}`} data-testid="rung-next">
              <ClubBadge clubId={clubIdOfKey(a.next)} size={18} /> {i + 1}
              {mark(i)}
            </span>
          )
        }
        return (
          <span key={i} className="chip" style={{ opacity: 0.6 }} title={ghost?.arena ? `Rung ${i + 1}${note(i)}` : undefined}>
            {i + 1}
            {mark(i)}
          </span>
        )
      })}
    </div>
  )
}
