import { useEffect, type CSSProperties } from 'react'
import type { SeasonTier } from '@engine/types'
import { celebrationFor, confettiPieces, prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'

const PIECES = confettiPieces(28)

/**
 * The tier reveal's flourish, behind the tier name: a gold flare for a title,
 * the flare plus a burst of confetti for the perfect season. It plays the
 * first time a result is revealed in this visit and on every replay, never on
 * a plain revisit. Decoration only (aria-hidden, no pointer events), hidden
 * under reduced motion.
 */
export function Celebrate({ tier, resultKey, replayed }: { tier: SeasonTier; resultKey: string; replayed: boolean }) {
  const kind = celebrationFor(tier)
  const play = useFirstReveal(resultKey, replayed)
  // A title gets the Cup's fanfare, the perfect season the Treble's, when the flourish plays (sound follows its own switch)
  useEffect(() => {
    if (kind && play) playSound({ id: 'fanfare', treble: kind === 'confetti', reduced: prefersReducedMotion() })
  }, [])
  if (!kind || !play) return null
  return (
    <span className="celebrate" aria-hidden="true" data-testid="celebrate" data-kind={kind}>
      <span className="flare" />
      {kind === 'confetti' &&
        PIECES.map((p, i) => <span key={i} className={`piece c${p.colour}`} style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`, '--delay': `${p.delay}ms`, '--w': `${p.size}px` } as CSSProperties} />)}
    </span>
  )
}
