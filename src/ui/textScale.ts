/**
 * iOS Dynamic Type, ready for the native wrapper (docs/ACCESSIBILITY.md section 5). The wrapper reads the reader's
 * preferred text size (`TextZoom.getPreferred()` from `@capacitor/text-zoom`: the body text style's point size over
 * 17, so 1 is the default "Large", about 1.12 to 1.35 the larger standard sizes and 1.65 to 3.12 the accessibility
 * sizes) and hands it to `applyTextScale`. The scale goes on the root font size, so everything set in rem (the
 * `--fs-*` type tokens: body copy, small text, chips, headings, buttons) grows, while what is drawn to a fixed
 * geometry in px (the lockup, the pitch, the reels, the crests) keeps its shape. No native code here: pure, and safe
 * on the web, where nothing calls it.
 */

/** Never smaller than the design: the smallest token is already 11 px. */
export const TEXT_SCALE_MIN = 1
/** Phones are checked to 200 % (the accessibility sizes above it are capped there). */
export const TEXT_SCALE_MAX = 2
/** From this width the shell is the one-screen desktop layout, whose boxes hold at 115 % text (at 135 % the Setup cards crowd at 1280x720). */
export const TEXT_SCALE_WIDE_FROM = 1100
export const TEXT_SCALE_WIDE_MAX = 1.15

/** The root font scale for a preferred text size and the window width: clamped, in steps of 5 %. */
export function textScaleFor(preferred: number, viewportWidth: number): number {
  if (!Number.isFinite(preferred) || preferred <= 0) return 1
  const max = viewportWidth >= TEXT_SCALE_WIDE_FROM ? TEXT_SCALE_WIDE_MAX : TEXT_SCALE_MAX
  const clamped = Math.min(max, Math.max(TEXT_SCALE_MIN, preferred))
  return Math.round(clamped * 20) / 20
}

/** The root `font-size` for a scale: a percentage, so it multiplies the web view's default (16 px), or '' for 100 %. */
export function rootFontSize(scale: number): string {
  return scale === 1 ? '' : `${Math.round(scale * 100)}%`
}

interface RootLike {
  style: { fontSize: string }
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/**
 * Puts a preferred text size on the page: the root font size, and `data-text-scale` (the percentage) for any rule
 * that must know. Call it at launch and again when the app comes back to the foreground (the reader may have
 * changed the setting meanwhile). Returns the scale applied.
 */
export function applyTextScale(preferred: number, viewportWidth: number, root: RootLike = document.documentElement): number {
  const scale = textScaleFor(preferred, viewportWidth)
  root.style.fontSize = rootFontSize(scale)
  if (scale === 1) root.removeAttribute('data-text-scale')
  else root.setAttribute('data-text-scale', String(Math.round(scale * 100)))
  return scale
}
