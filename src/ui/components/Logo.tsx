import { useId, useMemo, type CSSProperties } from 'react'
import { APP_NAME, MARK, WORDMARK, markSvgInner, markTier, type MarkVariant } from '../brand'

/** Named sizes in CSS pixels; any number works too. */
export const LOGO_SIZES = { sm: 24, md: 32, lg: 48, xl: 96 } as const
export type LogoSize = keyof typeof LOGO_SIZES | number
export type LogoVariant = MarkVariant

function toPx(size: LogoSize): number {
  return typeof size === 'number' ? size : LOGO_SIZES[size]
}

/** useId is unique per instance; keep it to characters that are safe inside url(#…). */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
}

/** The flat corner-flag mark. Decorative unless `title` is supplied. */
export function LogoMark({ size = 'md', variant = 'colour', title, open = false }: { size?: LogoSize; variant?: LogoVariant; title?: string; open?: boolean }) {
  const px = toPx(size)
  const id = useSvgId('tl')
  const tier = markTier(px)
  const html = useMemo(() => markSvgInner(id, { tier, variant, tile: open ? 'none' : undefined, themeable: true }), [id, tier, variant, open])
  return <svg className="logo-mark" width={px} height={px} viewBox={`0 0 ${MARK.grid} ${MARK.grid}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" dangerouslySetInnerHTML={{ __html: html }} />
}

/** “TouchLine” in the dedicated brand face. Real text, so it reads and copies as the name. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      {WORDMARK[0]}
      <span className="wordmark-line">{WORDMARK[1]}</span>
    </span>
  )
}

/** The compact mark and wordmark used by the loader and tight headers. */
export function Logo({ size = 'md', variant = 'colour', className }: { size?: LogoSize; variant?: LogoVariant; className?: string }) {
  const px = toPx(size)
  return (
    <span className={className ? `logo ${className}` : 'logo'} style={{ '--logo-size': `${px}px` } as CSSProperties}>
      <LogoMark size={px} variant={variant} />
      <Wordmark />
    </span>
  )
}

/**
 * The primary lockup is present immediately. `hover` enables a small pointer nudge;
 * `letters` opts the Home wordmark into its paused/reduced-motion-aware wave.
 */
export function Lockup({ height = 64, animate = 'none', className, open = false }: { height?: number; animate?: 'none' | 'load' | 'hover' | 'letters'; className?: string; open?: boolean }) {
  const cls = ['tl-lockup', animate === 'hover' && 'tl-hover', animate === 'letters' && 'tl-letters', className].filter(Boolean).join(' ')
  const word = (text: string, offset: number) => animate === 'letters'
    ? [...text].map((letter, i) => <span className="tl-letter" key={i} style={{ animationDelay: `${(offset + i) * 90}ms` }}>{letter}</span>)
    : text
  return (
    <span className={cls} style={{ '--tl-h': `${height}px` } as CSSProperties} role="img" aria-label={APP_NAME}>
      <LogoMark size={height} open={open} />
      <span className="tl-name" aria-hidden="true">
        <span className="tl-touch">{word(WORDMARK[0], 0)}</span>
        <span className="wordmark-line">{word(WORDMARK[1], WORDMARK[0].length)}</span>
      </span>
    </span>
  )
}
