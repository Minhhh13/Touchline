/**
 * The width of a line of the pitch's label type (Sora, semi-bold), measured on a canvas so a name or a role is judged by
 * what it will take on screen: Sora runs from 5.7 px a letter ("J. Jaaskelainen") to 7.4 ("Aubameyang") at 11 px, and a
 * flat estimate clipped the wide ones. Where there is no canvas (tests, a server) it falls back to a wide estimate.
 * Presentation only: nothing here reaches the game.
 */

/** The fallback, in px a character at 11 px: towards the wide end of the names measured (5.7 to 7.4). */
export const WIDE_CHAR = 7

const cache = new Map<string, number>()
let canvas: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (canvas !== undefined) return canvas
  try {
    canvas = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  } catch {
    canvas = null
  }
  return canvas
}

/** Forget what was measured (the font arrived after the first measurements, which used the fallback face). */
export function forgetWidths(): void {
  cache.clear()
}

/** The width of `text` in px at `size` px, semi-bold. */
export function textWidth(text: string, size: number): number {
  const key = `${size}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const ctx = context()
  let w = (text.length * size * WIDE_CHAR) / 11
  if (ctx) {
    ctx.font = `600 ${size}px Sora, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`
    const m = ctx.measureText(text).width
    if (m > 0) w = m
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, w)
  return w
}
