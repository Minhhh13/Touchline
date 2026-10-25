/**
 * The brand in one place: the display name, the mark's geometry and the colours
 * used where CSS cannot reach (the canvas share card, the generated icons).
 * docs/DESIGN_SYSTEM.md describes how they are used. This module has no imports,
 * so scripts/brand/icons.mjs can load it directly with Node.
 */

/** The wordmark's two halves; the second is set in the accent blue. */
export const WORDMARK = ['Touch', 'Line'] as const

/** The product name as it is displayed: mixed case, one word. */
export const APP_NAME = WORDMARK.join('')

/**
 * The mark, on a 64-unit grid: a pitch corner (the touchline running up, the
 * goal line running right, the corner arc between them) and the ball struck
 * from it. Strokes use round caps and joins. The pentagon on the ball is only
 * drawn from 40 px up; below that the ball is a plain disc.
 */
export const MARK = {
  grid: 64,
  /** Corner radius of the rounded tile. */
  tileRadius: 15,
  /** Touchline and goal line, meeting at the corner (14, 50). */
  lines: 'M14 13V50H51',
  lineWidth: 6.5,
  /** The corner arc, radius 12 around the corner. */
  arc: 'M14 38A12 12 0 0 1 26 50',
  arcWidth: 5,
  ball: { cx: 36.5, cy: 27.5, r: 9.5 },
  /** The pentagon on the ball, point up, knocked out of the disc. */
  pentagon: pentagonPath(36.5, 27.5, 4),
  /** Below this rendered size the pentagon is left out. */
  detailFrom: 40,
  /** The tile's gradient, top left to bottom right; its midpoint is the primary blue. */
  gradient: ['#3b82f6', '#1d4ed8'] as const,
} as const

/** A regular pentagon with one point up, as an SVG path (also valid for Path2D). */
function pentagonPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180
    return `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  })
  return `M${pts.join('L')}Z`
}

/**
 * Colours for drawing outside the stylesheet. They mirror the Floodlit (dark)
 * tokens in styles.css; keep the two in step.
 */
export const BRAND_COLOURS = {
  bg: '#0a1120',
  panel: '#111b2f',
  navy: '#0b1633',
  navy2: '#1b2a4a',
  line: '#24324d',
  text: '#eef3fc',
  text2: '#b8c4d9',
  text3: '#8695ae',
  primary: '#2563eb',
  accent: '#60a5fa',
  good: '#34d399',
  warn: '#fb923c',
  bad: '#f87171',
  gold: '#f5c542',
  draw: '#a3adbf',
  pitch: '#1d7a3f',
  pitch2: '#1a6f39',
  pitchLine: 'rgba(255, 255, 255, 0.5)',
  pitchDisc: 'rgba(10, 17, 32, 0.9)',
  rating90: '#f5c542',
  rating85: '#eab308',
  rating80: '#3b82f6',
  rating75: '#93c5fd',
  rating70: '#a5b4cb',
  ratingBase: '#94a3b8',
} as const
