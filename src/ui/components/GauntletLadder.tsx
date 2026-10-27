import { useEffect } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import { clubIdOfKey } from '@engine/knockout'
import { GAUNTLET_RUNGS } from '@engine/gauntlet'
import type { ArenaState, ChallengeSettings } from '@game/types'
import { ghostStepLine } from '@game/logic/arenaClaim'
import { arenaClubName, stepWon } from '@game/logic/arena'
import { ClubBadge } from './bits'
import { playSound } from '../sound/synth'

/** The rungs climbed already heard in this visit, by run (its ladder, built once), so a revisit rings nothing. */
const climbHeard = new Map<string, number>()

/**
 * The Gauntlet's fifteen rungs in a row: the rungs climbed as club codes in
 * green, the defeat in red, the rung up next with its badge, the rest by
 * number. A challenge's ghost marks the rung where the challenger fell (👻)
 * and names his score on every rung he played.
 */
export function GauntletLadder({ u, a, ghost }: { u: LoadedUniverse; a: ArenaState; ghost?: Pick<ChallengeSettings, 'name' | 'arena'> }) {
  // A rung climbed: one step higher on the scale for each, heard the first time the ladder shows it (a fresh visit only records)
  const climbed = a.log.filter(stepWon).length
  const run = a.ladder ? a.ladder.mains.join() : ''
  useEffect(() => {
    const before = climbHeard.get(run)
    climbHeard.set(run, climbed)
    if (before !== undefined && climbed > before) playSound({ id: 'rung', rung: climbed - 1 })
  }, [run, climbed])
  const code = (key: string) => u.clubById[clubIdOfKey(key)]?.code ?? clubIdOfKey(key).slice(0, 3).toUpperCase()
  const fell = ghost?.arena && !ghost.arena.claim.w ? ghost.arena.claim.g.length - 1 : -1
  const mark = (i: number) => (i === fell ? ' 👻' : '')
  const note = (i: number) => (ghost?.arena ? ` · ${ghostStepLine(ghost, i)}` : '')
  return (
    <div className="row wrap" style={{ gap: 6 }} role="list" aria-label="The Gauntlet's rungs" data-testid="gauntlet-ladder">
      {Array.from({ length: GAUNTLET_RUNGS }, (_, i) => {
        const played = a.log[i]
        if (played) {
          const won = stepWon(played)
          return (
            <span key={i} role="listitem" className={`chip ${won ? 'good' : 'bad'}`} title={`Rung ${i + 1}: ${played.gf}-${played.ga}${played.pens ? ` (${played.pens.us}-${played.pens.them} pens)` : ''} v ${arenaClubName(u, played.opponent)}${note(i)}`} data-testid={won ? 'rung-won' : 'rung-lost'}>
              <span className="sr-only">Rung {i + 1}, {won ? 'won' : 'lost'} {played.gf}-{played.ga}{played.pens ? `, ${played.pens.us}-${played.pens.them} on penalties,` : ''} v {arenaClubName(u, played.opponent)}{note(i)}: </span>
              <span aria-hidden="true">{code(played.opponent)}</span>
              <span className="res-letter" aria-hidden="true">{won ? 'W' : 'L'}</span>
              {mark(i)}
            </span>
          )
        }
        if (i === a.step && !a.over && a.next) {
          return (
            <span key={i} role="listitem" className="chip gold" title={`Rung ${i + 1}: ${arenaClubName(u, a.next)}${note(i)}`} data-testid="rung-next">
              <span className="sr-only">Up next, rung {i + 1} v {arenaClubName(u, a.next)}{note(i)}: </span>
              <span aria-hidden="true" className="row" style={{ gap: 4 }}>
                <ClubBadge clubId={clubIdOfKey(a.next)} size={18} /> {i + 1}
              </span>
              {mark(i)}
            </span>
          )
        }
        return (
          <span key={i} role="listitem" className="chip rung-ahead" title={ghost?.arena ? `Rung ${i + 1}${note(i)}` : undefined}>
            {i + 1}
            {mark(i)}
          </span>
        )
      })}
    </div>
  )
}
