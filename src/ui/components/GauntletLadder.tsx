import { useEffect } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import { clubIdOfKey } from '@engine/knockout'
import { GAUNTLET_RUNGS } from '@engine/gauntlet'
import type { ArenaState, ChallengeSettings } from '@game/types'
import { ghostStepLine } from '@game/logic/arenaClaim'
import { arenaClubName, GAUNTLET_BONUS_AFTER, stepWon } from '@game/logic/arena'
import { Gift } from 'lucide-react'
import { ClubBadge } from './bits'
import { playSound } from '../sound/synth'

/** The rungs climbed already heard in this visit, by run (its ladder, built once), so a revisit rings nothing. */
const climbHeard = new Map<string, number>()
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'

const t = translator(arena)

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
  // A rung still to climb that a bonus spin follows (after rungs 2, 4, 6 and 8) carries a gift, so the reward shows ahead
  const bonus = (i: number) => GAUNTLET_BONUS_AFTER.includes(i + 1)
  const gift = (i: number) =>
    bonus(i) ? (
      <>
        <Gift size={12} aria-hidden="true" className="rung-gift" />
        <span className="sr-only">{t('rungBonus')}</span>
      </>
    ) : null
  return (
    <div className="row wrap" style={{ gap: 6 }} role="list" aria-label={t('rungsLabel')} data-testid="gauntlet-ladder">
      {Array.from({ length: GAUNTLET_RUNGS }, (_, i) => {
        const played = a.log[i]
        if (played) {
          const won = stepWon(played)
          return (
            <span key={i} role="listitem" className={`chip ${won ? 'good' : 'bad'}`} title={t('rungTip', { n: i + 1, score: `${played.gf}-${played.ga}`, pens: played.pens ? t('rungPens', { score: `${played.pens.us}-${played.pens.them}` }) : '', club: arenaClubName(u, played.opponent), note: note(i) })} data-testid={won ? 'rung-won' : 'rung-lost'}>
              <span className="sr-only">{t('rungSr', { n: i + 1, won: won ? 'yes' : 'no', score: `${played.gf}-${played.ga}`, pens: played.pens ? t('rungSrPens', { score: `${played.pens.us}-${played.pens.them}` }) : '', club: arenaClubName(u, played.opponent), note: note(i) })}</span>
              <span aria-hidden="true">{code(played.opponent)}</span>
              <span className="res-letter" aria-hidden="true">{t(won ? 'resW' : 'resL')}</span>
              {mark(i)}
            </span>
          )
        }
        if (i === a.step && !a.over && a.next) {
          return (
            <span key={i} role="listitem" className="chip gold" title={t('rungNextTip', { n: i + 1, club: arenaClubName(u, a.next), note: note(i) }) + (bonus(i) ? t('rungBonus') : '')} data-testid="rung-next">
              <span className="sr-only">{t('rungNextSr', { n: i + 1, club: arenaClubName(u, a.next), note: note(i) })}</span>
              <span aria-hidden="true" className="row" style={{ gap: 4 }}>
                <ClubBadge clubId={clubIdOfKey(a.next)} size={18} /> {i + 1}
              </span>
              {gift(i)}
              {mark(i)}
            </span>
          )
        }
        return (
          <span key={i} role="listitem" className="chip rung-ahead" title={ghost?.arena || bonus(i) ? t('rungAheadTip', { n: i + 1, note: note(i) }) + (bonus(i) ? t('rungBonus') : '') : undefined}>
            {i + 1}
            {gift(i)}
            {mark(i)}
          </span>
        )
      })}
    </div>
  )
}
