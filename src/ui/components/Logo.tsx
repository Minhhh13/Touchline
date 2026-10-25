import { useEffect, useId, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { APP_NAME, LOCKUP, LOCKUP_FLAG_WIDTH, MARK, WORDMARK, lockupBallSvg, lockupFlagSvg, markSvgInner, markTier, type MarkVariant } from '../brand'

/** Named sizes in CSS pixels; any number works too. */
export const LOGO_SIZES = { sm: 24, md: 32, lg: 48, xl: 96 } as const
export type LogoSize = keyof typeof LOGO_SIZES | number

/**
 * colour: the blue tile, white pole and line, red pennant, black-and-white ball (the default, and the app icon).
 * mono: the glyph alone in the current text colour, no tile, the ball's panels knocked out (on a photo or a primary button).
 * inverse: a white tile with the glyph in the tile blue (on a blue or navy background).
 */
export type LogoVariant = MarkVariant

function toPx(size: LogoSize): number {
  return typeof size === 'number' ? size : LOGO_SIZES[size]
}

/** useId is unique per instance; keep it to characters that are safe inside url(#…). */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

/**
 * The mark: a corner flag standing on the touchline, a classic ball resting on
 * it right of the pole and the thin line running on past both, on the blue tile. Geometry and the SVG live in brand.ts
 * so the share card and the generated icons draw the same shape; the detail
 * tier follows the rendered size. Decorative unless `title` is given.
 */
export function LogoMark({ size = 'md', variant = 'colour', title }: { size?: LogoSize; variant?: LogoVariant; title?: string }) {
  const px = toPx(size)
  const id = useSvgId('tl')
  const tier = markTier(px)
  const html = useMemo(() => markSvgInner(id, { tier, variant }), [id, tier, variant])
  const g = MARK.grid
  return <svg className="logo-mark" width={px} height={px} viewBox={`0 0 ${g} ${g}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" dangerouslySetInnerHTML={{ __html: html }} />
}

/** "TouchLine" in the display face, "Line" in the accent blue. Real text, so it reads and copies as the name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      {WORDMARK[0]}
      <span className="wordmark-line">{WORDMARK[1]}</span>
    </span>
  )
}

/** The compact lockup: the tile with the wordmark beside it, the type scaled to the mark. */
export function Logo({ size = 'md', variant = 'colour', className }: { size?: LogoSize; variant?: LogoVariant; className?: string }) {
  const px = toPx(size)
  return (
    <span className={className ? `logo ${className}` : 'logo'} style={{ '--logo-size': `${px}px` } as CSSProperties}>
      <LogoMark size={px} variant={variant} />
      <Wordmark />
    </span>
  )
}

// The load animation plays on the first lockup that asks for it, once per page load
let loadPlayed = false

const REDUCED = '(prefers-reduced-motion: reduce)'
function subscribeReduced(cb: () => void) {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED) : null
  mq?.addEventListener('change', cb)
  return () => mq?.removeEventListener('change', cb)
}
/** True when motion should stay off; also on the server, where nothing animates. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(REDUCED).matches : true),
    () => true,
  )
}

/**
 * The open lockup: the mark's drawing without the tile (the corner flag
 * standing on a short touchline, the ball resting on it), then "TouchLine"
 * standing on the same ground; no line under the name. `height` is in px (a
 * stylesheet may resize it through --h; the ball's detail follows `height`).
 * The pennant flutters in a light wind, always (SMIL, so the pole and the ball
 * stay still). animate: 'load' plays the shine, the short line drawing itself
 * and the ball rolling in along it once per page load; 'hover' plays it on
 * hover or keyboard focus. The resting state is the finished logo, so
 * prefers-reduced-motion shows that, with the pennant still.
 */
export function Lockup({ height = 64, animate = 'none', className }: { height?: number; animate?: 'none' | 'load' | 'hover'; className?: string }) {
  const id = useSvgId('tll')
  // Both StrictMode calls of the initialiser see the same flag; the effect sets it
  const [play] = useState(() => animate === 'load' && !loadPlayed)
  useEffect(() => {
    if (play) loadPlayed = true
  }, [play])
  const tier = (height * 2 * LOCKUP.ball.r) / LOCKUP.grid >= LOCKUP.fullBallFrom ? 'full' : 'mid'
  const wave = !useReducedMotion()
  const flag = useMemo(() => lockupFlagSvg(id, wave), [id, wave])
  const ball = useMemo(() => lockupBallSvg(id, tier), [id, tier])
  const d = 2 * LOCKUP.ball.r
  const cls = ['tl-lockup', play && 'tl-play', animate === 'hover' && 'tl-hover', className].filter(Boolean).join(' ')
  return (
    <span className={cls} style={{ '--tl-h': `${height}px` } as CSSProperties}>
      <span className="tl-rule" aria-hidden="true" />
      <svg className="tl-ball" viewBox={`0 0 ${d} ${d}`} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: ball }} />
      <svg className="tl-flag" viewBox={`0 0 ${LOCKUP_FLAG_WIDTH} ${LOCKUP.grid}`} aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: flag }} />
      <span className="tl-name">
        <span className="tl-touch">{WORDMARK[0]}</span>
        <span className="wordmark-line">{WORDMARK[1]}</span>
        {/* The glint's copy of the name is generated content, so the page text, find-in-page and copy see the name once */}
        <span className="tl-shine" aria-hidden="true" data-text={APP_NAME} />
      </span>
    </span>
  )
}
