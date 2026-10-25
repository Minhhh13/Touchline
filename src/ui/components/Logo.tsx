import { useId, type CSSProperties } from 'react'
import { MARK, WORDMARK } from '../brand'

/** Named sizes in CSS pixels; any number works too. */
export const LOGO_SIZES = { sm: 24, md: 32, lg: 48, xl: 96 } as const
export type LogoSize = keyof typeof LOGO_SIZES | number

/**
 * colour: the blue tile with a white glyph (the default, and the app icon).
 * mono: the glyph alone in the current text colour, no tile (on a photo, a primary button or in print).
 * inverse: a white tile with a blue glyph (on a blue or navy background).
 */
export type LogoVariant = 'colour' | 'mono' | 'inverse'

function toPx(size: LogoSize): number {
  return typeof size === 'number' ? size : LOGO_SIZES[size]
}

/**
 * The mark: a pitch corner (touchline, goal line, corner arc) and the ball
 * struck from it, on a rounded tile. Geometry lives in brand.ts so the share
 * card and the generated icons draw the same shape. Decorative unless `title`
 * is given.
 */
export function LogoMark({ size = 'md', variant = 'colour', title }: { size?: LogoSize; variant?: LogoVariant; title?: string }) {
  const px = toPx(size)
  // useId is unique per instance; keep it to characters that are safe inside url(#…)
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const gradId = `tl-grad-${uid}`
  const maskId = `tl-ball-${uid}`
  const detail = px >= MARK.detailFrom
  const ink = variant === 'colour' ? '#ffffff' : variant === 'inverse' ? `url(#${gradId})` : 'currentColor'
  const g = MARK.grid
  return (
    <svg className="logo-mark" width={px} height={px} viewBox={`0 0 ${g} ${g}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <defs>
        {variant !== 'mono' && (
          <linearGradient id={gradId} x1="0" y1="0" x2={g} y2={g} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={MARK.gradient[0]} />
            <stop offset="1" stopColor={MARK.gradient[1]} />
          </linearGradient>
        )}
        {detail && (
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={g} height={g}>
            <rect width={g} height={g} fill="#ffffff" />
            <path d={MARK.pentagon} fill="#000000" />
          </mask>
        )}
      </defs>
      {variant !== 'mono' && <rect width={g} height={g} rx={MARK.tileRadius} fill={variant === 'colour' ? `url(#${gradId})` : '#ffffff'} />}
      <path d={MARK.lines} fill="none" stroke={ink} strokeWidth={MARK.lineWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d={MARK.arc} fill="none" stroke={ink} strokeWidth={MARK.arcWidth} strokeLinecap="round" />
      <circle cx={MARK.ball.cx} cy={MARK.ball.cy} r={MARK.ball.r} fill={ink} mask={detail ? `url(#${maskId})` : undefined} />
    </svg>
  )
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

/** The lockup: the mark with the wordmark beside it, the type scaled to the mark. */
export function Logo({ size = 'md', variant = 'colour', className }: { size?: LogoSize; variant?: LogoVariant; className?: string }) {
  const px = toPx(size)
  return (
    <span className={className ? `logo ${className}` : 'logo'} style={{ '--logo-size': `${px}px` } as CSSProperties}>
      <LogoMark size={px} variant={variant} />
      <Wordmark />
    </span>
  )
}
