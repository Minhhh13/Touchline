import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Crown, Globe, Medal, SkipForward } from 'lucide-react'
import { USER_TEAM } from '@engine/season'
import type { Game, QuickCupRound, QuickCupRun } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { quickCupBracket, revealCount, revealSteps, tieAtStep, userRoute } from '@game/logic/bracket'
import { cupReachLabel, cupRoundLabel, cupScoreLabel, wonCup, type QuickCupComp } from '@game/logic/quickCups'
import { honourDetail, honourOf } from '@game/logic/cabinet'
import { sideNamer } from '@game/logic/superLeague'
import { Bracket } from './Bracket'
import { ClubBadge, Modal, TeamBadge } from './bits'
import { TrebleArt, TrophyArt } from './TrophyArt'
import { confettiPieces, prefersReducedMotion } from '../motion'
import { revealDelay, userInPlay } from '../cupReveal'
import { playSound } from '../sound/synth'
import { useFocusOnLanding } from '../a11y'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'

const t = translator(summary)

const ROUNDS: QuickCupRound[] = ['R16', 'QF', 'SF', 'F']
const CUP_PIECES = confettiPieces(36)
const TREBLE_PIECES = confettiPieces(56)

/**
 * A Quick Draft cup night: the cup's whole bracket in a modal. Opened as the cup is played (`reveal`), the ties fill in
 * round by round, the user's tie held for its moment, with Skip to the end; a cup won ends on the trophy lifted, and
 * the second cup of a league-winning season on the Treble. Opened later it shows the finished bracket. The store has
 * played the cup already; this only paces what is shown. Reduced motion shows everything at once and no confetti.
 */
export function CupNight({ game, u, comp, run, reveal, onClose, onRevealEnd }: { game: Game; u: LoadedUniverse; comp: QuickCupComp; run: QuickCupRun; reveal: boolean; onClose: () => void; onRevealEnd?: () => void }) {
  const view = useMemo(() => quickCupBracket(run, comp), [run, comp])
  const steps = useMemo(() => revealSteps(view), [view])
  const total = revealCount(view)
  const [reduced] = useState(prefersReducedMotion)
  const [shown, setShown] = useState(() => (reveal && !reduced ? 0 : total))
  const done = shown >= total
  // The trophy moment: only after a reveal (a later look at the bracket goes straight to it)
  const lifted = run.reached === 'W'
  const [celebrating, setCelebrating] = useState(reveal && lifted)
  useEffect(() => {
    if (done) return
    const timer = setTimeout(() => setShown((n) => n + 1), revealDelay(view, steps, shown))
    return () => clearTimeout(timer)
  }, [done, shown, view, steps])
  useEffect(() => {
    if (done) onRevealEnd?.()
  }, [done, onRevealEnd])
  const namer = sideNamer(game, u)
  const nameOf = (id: string) => (id === USER_TEAM ? game.settings.teamName : namer(id))
  const badge = (id: string) => (id === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={18} /> : <ClubBadge clubId={id} size={18} />)
  const live = !done && userInPlay(view, steps, shown)
  // The user's tie last revealed (or the one in play), for the line over the bracket
  const route = userRoute(view)
  const mineShown = run.ties.filter((t) => {
    const r = ROUNDS.indexOf(t.round)
    const i = route[r]
    return i !== null && i !== undefined && steps[r][i] < shown
  })
  const current = live ? tieAtStep(steps, shown) : null
  const latest = mineShown.at(-1)
  const q = game.quickResult
  const honour = q && lifted ? honourOf(q.position === 1, wonCup(q, 'cup'), wonCup(q, 'continental')) : null
  const treble = honour === 'treble'
  const line = current
    ? t('tieInPlay', { round: view.rounds[current.round].name })
    : latest
      ? t('tieLine', { round: cupRoundLabel(comp, latest.round), won: latest.won ? 'yes' : 'no', score: cupScoreLabel(latest), opponent: nameOf(latest.opponentId) })
      : t('drawMade')
  const verdict = done ? (lifted ? t(comp === 'cup' ? 'cupWinners' : 'continentChampions') : t('outInThe', { round: cupReachLabel(run.reached, comp) })) : null
  const Icon = comp === 'cup' ? Medal : Globe
  return (
    <Modal open onClose={onClose} title={t(`cupTitle_${comp}`)} className="cup-night" testId={`cup-night-${comp}`}>
      <div className="cup-night-bar">
        <span className={`cup-night-line ${live ? 'live' : ''}`} data-testid="cup-night-line" aria-live="polite">
          <Icon size={16} aria-hidden="true" /> {verdict ?? line}
        </span>
        {!done ? (
          <button className="btn sm ghost" onClick={() => setShown(total)} data-testid="cup-night-skip">
            <SkipForward size={14} aria-hidden="true" /> {t('skipToEnd')}
          </button>
        ) : (
          lifted &&
          !celebrating && (
            <button className="btn sm" onClick={() => setCelebrating(true)} data-testid="cup-night-trophy">
              {treble ? <Crown size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />} {t(treble ? 'theTreble' : 'theTrophy')}
            </button>
          )
        )}
      </div>
      <div className="cup-night-body">
        <Bracket view={view} nameOf={nameOf} badge={badge} userId={USER_TEAM} trophy={comp} reveal={done ? undefined : { steps, shown, live }} testId={`cup-bracket-${comp}`} />
        {done && celebrating && lifted && <CupLift comp={comp} treble={treble} teamName={game.settings.teamName} detail={treble ? honourDetail(['cup', 'continental']) : null} played={!reduced} onBack={() => setCelebrating(false)} onDone={onClose} />}
      </div>
    </Modal>
  )
}

/**
 * The trophy lifted, over the bracket: our own cartoon cup rising on a gold flare and a burst of confetti (the fixed
 * pattern of `confettiPieces`), the name, and the way back. The Treble's is bigger: the three trophies under a crown,
 * two bursts. Decoration is aria-hidden; under reduced motion it stands still and the confetti is not drawn.
 */
export function CupLift({ comp, treble, teamName, detail, played, onBack, onDone }: { comp: QuickCupComp; treble: boolean; teamName: string; detail: string | null; played: boolean; onBack: () => void; onDone: () => void }) {
  const pieces = treble ? TREBLE_PIECES : CUP_PIECES
  // The reveal's Skip has gone when the trophy rises: the focus goes to Done
  const doneRef = useRef<HTMLButtonElement>(null)
  useFocusOnLanding(true, doneRef)
  // The fanfare as the trophy rises (the Treble's is bigger); no shimmer under reduced motion
  useEffect(() => {
    playSound({ id: 'fanfare', treble, reduced: !played })
  }, [])
  const burst = (later: number) => (
    <span className="celebrate cup-burst" aria-hidden="true" style={{ '--burst': `${later}ms` } as CSSProperties}>
      <span className="flare" />
      {pieces.map((p, i) => (
        <span key={i} className={`piece c${p.colour}`} style={{ '--dx': `${Math.round(p.dx * (treble ? 1.5 : 1.15))}px`, '--dy': `${Math.round(p.dy * (treble ? 2.2 : 1.6))}px`, '--rot': `${p.rot}deg`, '--delay': `${p.delay}ms`, '--w': `${p.size + (treble ? 2 : 0)}px` } as CSSProperties} />
      ))}
    </span>
  )
  return (
    <div className={`cup-lift ${treble ? 'treble' : ''}`} data-testid="cup-celebration" data-kind={treble ? 'treble' : comp} role="status">
      <div className="cup-lift-stage">
        {played && burst(0)}
        {played && treble && burst(420)}
        {treble ? <TrebleArt size={170} className="cup-lift-art" /> : <TrophyArt kind={comp} size={170} className="cup-lift-art" />}
      </div>
      <div className="cup-lift-title" data-testid="cup-celebration-title">
        {t(treble ? 'theTreble' : comp === 'cup' ? 'cupWinners' : 'continentChampions')}
      </div>
      <div className="cup-lift-line">{treble ? t('trebleLine', { team: teamName, detail }) : t(comp === 'cup' ? 'liftCup' : 'liftContinental', { team: teamName })}</div>
      <div className="cup-lift-actions">
        <button className="btn ghost" onClick={onBack} data-testid="cup-celebration-bracket">
          {t('seeBracket')}
        </button>
        <button ref={doneRef} className="btn primary" onClick={onDone} data-testid="cup-celebration-done">
          {t('done')}
        </button>
      </div>
    </div>
  )
}
