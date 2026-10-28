import { useEffect, useId, type CSSProperties } from 'react'
import type { SeasonTier } from '@engine/types'
import { celebrationFor, confettiPieces, prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'
import { runAfterPaint } from '../afterPaint'
import '../visuals.css'

const PIECES = confettiPieces(28)
/** The light behind a title: sixteen soft gold beams round the tier, each a thin wedge from the centre (never a star). */
const RAYS = Array.from({ length: 16 }, (_, i) => i * 22.5)

/** The beams, drawn once; `.cel-rays` turns and fades them (transform and opacity only). */
function Rays() {
  const fade = `cel-ray-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  return (
    <svg className="cel-rays" viewBox="-100 -100 200 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={fade} cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
          <stop offset="0.12" style={{ stopColor: 'var(--gold)', stopOpacity: 0 }} />
          <stop offset="0.3" style={{ stopColor: 'var(--gold)', stopOpacity: 0.34 }} />
          <stop offset="1" style={{ stopColor: 'var(--gold)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>
      {RAYS.map((a) => (
        <path key={a} d={a % 45 ? 'M 0 0 L -3 -100 L 3 -100 Z' : 'M 0 0 L -6 -100 L 6 -100 Z'} transform={`rotate(${a})`} fill={`url(#${fade})`} />
      ))}
    </svg>
  )
}

/**
 * The tier reveal's flourish, behind the tier name: a gold flare for a title,
 * the flare plus a burst of confetti for the perfect season. Gold beams turn
 * behind both; the perfect season adds two neon rings (cyan, then magenta). It plays the
 * first time a result is revealed in this visit and on every replay, never on
 * a plain revisit. Decoration only (aria-hidden, no pointer events), hidden
 * under reduced motion.
 */
export function Celebrate({ tier, resultKey, replayed }: { tier: SeasonTier; resultKey: string; replayed: boolean }) {
  const kind = celebrationFor(tier)
  const play = useFirstReveal(resultKey, replayed)
  // A title gets the Cup's fanfare, the perfect season the Treble's, when the flourish plays (sound follows its own switch),
  // once the screen has painted: its score is worked out on first use (about 70 ms on a 4x-throttled phone)
  useEffect(() => {
    if (kind && play) runAfterPaint(() => playSound({ id: 'fanfare', treble: kind === 'confetti', reduced: prefersReducedMotion() }))
  }, [])
  if (!kind || !play) return null
  return (
    <span className="celebrate" aria-hidden="true" data-testid="celebrate" data-kind={kind}>
      <Rays />
      <span className="flare" />
      {kind === 'confetti' && (
        <>
          <span className="cel-ring cyan" />
          <span className="cel-ring magenta" />
        </>
      )}
      {kind === 'confetti' &&
        PIECES.map((p, i) => <span key={i} className={`piece c${p.colour}`} style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg`, '--delay': `${p.delay}ms`, '--w': `${p.size}px` } as CSSProperties} />)}
    </span>
  )
}
