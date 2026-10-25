/**
 * The brand in one place: the display name, the mark's and the lockup's
 * geometry, the SVG they are drawn with, and the colours used where CSS cannot
 * reach (the canvas share card, the generated icons). docs/DESIGN_SYSTEM.md
 * describes how they are used. This module has no imports, so
 * scripts/brand/icons.mjs can load it directly with Node.
 */

/** The wordmark's two halves; the second is set in the accent blue. */
export const WORDMARK = ['Touch', 'Line'] as const

/** The product name as it is displayed: mixed case, one word. */
export const APP_NAME = WORDMARK.join('')

/** full: 64 px and up. mid: 22 to 63 px. tiny: under 22 px (the favicon). */
export type MarkTier = 'full' | 'mid' | 'tiny'

/**
 * colour: the blue tile, white pole and line, red pennant, a black-and-white ball (the default and the app icon).
 * mono: everything in currentColor, no tile, the ball's panels knocked out (for light ink: on a photo or a primary button).
 * inverse: a white tile with the pole, line and ball outline in the tile blue (on a blue or navy background).
 */
export type MarkVariant = 'colour' | 'mono' | 'inverse'

interface Pennant {
  /** The pole's x, where the cloth is fixed. */
  x: number
  top: number
  bottom: number
  tipX: number
  tipY: number
  /** The wave along both edges; 0 is a straight triangle. */
  amp: number
  /** The radius of the rounded tip (0 or absent: a sharp point). */
  tip?: number
}

interface TierGeometry {
  pole: { x: number; y1: number; y2: number; w: number }
  line: { x1: number; x2: number; y: number; w: number }
  pennant: Pennant
  ball: { cx: number; cy: number; r: number }
  /** The round cap on top of the pole (the full tier only). */
  finial?: { cy: number; r: number }
  /** Round caps above 22 px; butt caps on the pixel grid below. */
  caps: 'round' | 'butt'
}

/** The ball rests on the top edge of the line. */
function onLine(cx: number, r: number, line: { y: number; w: number }) {
  return { cx, r, cy: line.y - line.w / 2 - r }
}

/** The pole stands on the line: its foot (with its cap) ends at the line's top edge, nothing below it. */
function standing(x: number, top: number, w: number, line: { y: number; w: number }, caps: 'round' | 'butt') {
  return { x, w, y1: caps === 'round' ? top + w / 2 : top, y2: line.y - line.w / 2 - (caps === 'round' ? w / 2 : 0) }
}

const FULL_LINE = { x1: 9, x2: 57, y: 51, w: 1.6 }
const MID_LINE = { x1: 9, x2: 57, y: 51, w: 2.4 }
// 4 units are 1 px at 16 px: the line is row 12, the pole column 4 standing on it
const TINY_LINE = { x1: 8, x2: 60, y: 50, w: 4 }

/**
 * The mark, on a 64-unit grid (y down): a corner flag (a white pole standing on
 * the touchline, a red pennant flying right from its top), a classic
 * black-and-white football resting on the line to the right of the pole, and
 * the thin white touchline running on past both, on the blue tile. Three tiers of the
 * same drawing; detail drops as the icon shrinks.
 */
export const MARK = {
  grid: 64,
  /** Corner radius of the rounded tile. */
  tileRadius: 15,
  /** The tile's gradient, top left to bottom right; its midpoint is the primary blue. */
  gradient: ['#3b82f6', '#1d4ed8'] as const,
  /** Rendered size in px at which each tier starts. */
  tierFrom: { full: 64, mid: 22 },
  /** The pennant: flat red on the straight tier; cloth (folds, shade, a lit upper edge) on the waving ones (`pennantCloth`). */
  red: '#ef4444',
  cloth: {
    /** The cloth facing the light and turned away from it; folds mix the red toward these. */
    light: '#ff8c7e',
    dark: '#8c1212',
    /** The shade under the cloth, along its lower edge and where it meets the pole. */
    shade: '#450a0a',
    /** How deep the folds and shade go: the tile's tiers (fainter at 22 to 63 px, so the red stays clean) and the lockup. */
    strength: { full: 1.3, mid: 0.6, lockup: 1.1 },
  },
  /** The ball's black panels. */
  panel: '#0d1117',
  tiers: {
    full: {
      pole: standing(16, 9.8, 2.8, FULL_LINE, 'round'),
      line: FULL_LINE,
      pennant: { x: 16, top: 12, bottom: 27.2, tipX: 38.5, tipY: 19.2, amp: 1.7, tip: 0.7 },
      ball: onLine(41.5, 11.5, FULL_LINE),
      finial: { cy: 10.6, r: 2 },
      caps: 'round',
    },
    mid: {
      pole: standing(16, 9.4, 4, MID_LINE, 'round'),
      line: MID_LINE,
      pennant: { x: 16, top: 11.5, bottom: 28.9, tipX: 39, tipY: 19.9, amp: 1.1, tip: 0.6 },
      ball: onLine(41, 12, MID_LINE),
      caps: 'round',
    },
    tiny: {
      // pole x 16 to 20, y 8 to 48, standing on the line (y 48 to 52)
      pole: standing(18, 8, 4, TINY_LINE, 'butt'),
      line: TINY_LINE,
      // 20 by 20 units (5 px), ending clear of the ball's top edge
      pennant: { x: 18, top: 8, bottom: 28, tipX: 40, tipY: 17, amp: 0 },
      // x 28 to 52, y 24 to 48
      ball: onLine(40, 12, TINY_LINE),
      caps: 'butt',
    },
  } satisfies Record<MarkTier, TierGeometry>,
} as const

/** The detail tier for a mark rendered `px` CSS pixels square. */
export function markTier(px: number): MarkTier {
  return px >= MARK.tierFrom.full ? 'full' : px >= MARK.tierFrom.mid ? 'mid' : 'tiny'
}

/**
 * The open lockup, in units of its height / 64: the mark's drawing without the
 * tile at the left (the corner flag standing on a short touchline, the ball
 * resting on it right of the pole, the line ending a little past the ball),
 * then "TouchLine" standing on the same ground: its baseline is the line's top
 * edge. No line under the name. The whole sits about centred in the 64u box.
 */
export const LOCKUP = {
  grid: 64,
  pole: { x: 9, y1: 13.4, y2: 49.5, w: 3 },
  /** The round cap on the pole's top: the highest point of the mark. */
  finial: { cy: 12.4, r: 2.2 },
  /** The pennant's top sits just above the name's cap tops (15.6u). */
  pennant: { x: 9, top: 14, bottom: 26, tipX: 37.5, tipY: 19, amp: 1.6, tip: 1.3 },
  /** The short line: its left end (the pole's left edge), length, top edge and thickness. */
  rule: { left: 7.5, length: 37, y: 51, w: 2 },
  /** About the name's x-height (0.55 of its size in Sora) across. */
  ball: { cx: 28.5, r: 12 },
  /** The ball rolls in this far (u) along the line to its spot, fading in as it starts. */
  roll: 5,
  /**
   * The name: left edge, top of its line box, font size (cap height 0.73 of
   * it in Sora), and where its baseline lands (the line's top). The mark from the
   * finial to the baseline is 1.15 cap heights; the gap after the line is
   * about half a letter; finial to line bottom is centred in the 64u box.
   */
  name: { left: 57, top: 10.7, size: 48, baseline: 51 },
  /** The pennant's flutter: one loop in seconds, and the frames it steps through. */
  wave: { dur: 2.6, frames: 8, amp: 2.2 },
  /** Below this ball diameter in px the lockup uses the flat ball. */
  fullBallFrom: 40,
} as const

/** The lockup's flag drawing box (viewBox 0 0 flagWidth 64). */
export const LOCKUP_FLAG_WIDTH = 46

const r2 = (n: number) => +n.toFixed(2)

/** The wave's vertical offset at t (0 at the pole, 1 at the tip) for a given phase. */
function waveAt(p: Pennant, t: number, phase: number): number {
  return -p.amp * (Math.sin(Math.PI * t * 1.15 - phase) + Math.sin(phase) * (1 - t)) * (0.35 + 0.65 * t)
}

/**
 * A pennant from the pole: a triangle whose two edges carry the same gentle
 * wave, its tip rounded off (`tip`). `phase` (radians) moves the wave along
 * the cloth, away from the pole; the edge at the pole never moves, and phase 0
 * is the resting shape.
 */
export function pennantPath(p: Pennant, steps = 28, phase = 0): string {
  if (p.amp === 0) return `M${p.x} ${p.top}L${p.tipX} ${p.tipY}L${p.x} ${p.bottom}Z`
  const r = p.tip ?? 0
  const tx = p.tipX - r
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push(`${r2(p.x + (tx - p.x) * t)} ${r2(p.top + (p.tipY - r - p.top) * t + waveAt(p, t, phase))}`)
  }
  if (r > 0) {
    const cy = p.tipY + waveAt(p, 1, phase)
    for (const a of [-60, -30, 0, 30, 60]) pts.push(`${r2(tx + r * Math.cos((a * Math.PI) / 180))} ${r2(cy + r * Math.sin((a * Math.PI) / 180))}`)
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    pts.push(`${r2(p.x + (tx - p.x) * t)} ${r2(p.bottom + (p.tipY + r - p.bottom) * t + waveAt(p, t, phase))}`)
  }
  return `M${pts.join('L')}Z`
}

/**
 * The cloth's folds at one phase: colour stops along the pennant (0 at the
 * pole, 1 at the tip). Each fold's light comes from the slope of the same wave
 * the edges carry plus a ripple at twice its frequency travelling with it, so
 * there are two or three soft light and dark bands and they move with the
 * cloth. `strength` scales how far the red goes toward light and dark.
 */
export function clothStops(p: Pennant, phase = 0, strength = 1, n = 17): [number, string][] {
  const C = MARK.cloth
  const e = 1e-3
  const out: [number, string][] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const slope = (waveAt(p, t + e, phase) - waveAt(p, t - e, phase)) / (2 * e) / (Math.max(p.amp, 0.01) * 3.2)
    const ripple = Math.cos(Math.PI * 3.6 * t - 2 * phase) * (0.45 + 0.55 * t)
    // Rising toward the tip faces the light (y is down); the cloth near the pole is held flat
    const raw = (-0.5 * slope + 0.75 * ripple) * Math.min(1, 0.35 + 3 * t)
    // A soft knee: the folds keep a body of plain red between their light and dark crests
    const s = Math.max(-1, Math.min(1, Math.sign(raw) * Math.abs(raw) ** 0.65 * strength))
    out.push([r2(t), s >= 0 ? mix(MARK.red, C.light, s * 0.9) : mix(MARK.red, C.dark, -s * 0.9)])
  }
  return out
}

/** A regular pentagon with one point up, as an SVG path (also valid for Path2D). */
export function pentagonPath(cx: number, cy: number, r: number): string {
  const pts = Array.from({ length: 5 }, (_, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180
    return `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
  })
  return `M${pts.join('L')}Z`
}

// ---------------------------------------------------------------- the ball

type V3 = [number, number, number]
const PHI = (1 + Math.sqrt(5)) / 2
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
type M3 = [V3, V3, V3]
const mul = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
const mm = (a: M3, b: M3): M3 => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j])) as M3

function rotMat(axis: V3, ang: number): M3 {
  const [x, y, z] = norm(axis)
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const t = 1 - c
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ]
}

/** Every sign combination of v (zeros keep their sign). */
function signed(v: V3): V3[] {
  const out: V3[] = []
  for (let m = 0; m < 8; m++) {
    if (v.some((c, i) => c === 0 && (m >> i) & 1)) continue
    out.push(v.map((c, i) => ((m >> i) & 1 ? -c : c)) as V3)
  }
  return out
}
/** Even permutations of each base, with every sign: the truncated icosahedron's point sets. */
function allPts(bases: V3[]): V3[] {
  const pts: V3[] = []
  for (const [a, b, c] of bases) for (const p of [[a, b, c], [b, c, a], [c, a, b]] as V3[]) pts.push(...signed(p))
  return pts
}

const VERTS = allPts([
  [0, 1, 3 * PHI],
  [1, 2 + PHI, 2 * PHI],
  [PHI, 2, 2 * PHI + 1],
]).map(norm)
const PENT_C = allPts([[0, 1, PHI]]).map(norm)
const HEX_C = [...signed([1, 1, 1]), ...allPts([[0, PHI, 1 / PHI]])].map(norm)

function faceVerts(c: V3, n: number): V3[] {
  const near = VERTS.map((v) => [dot(v, c), v] as const)
    .sort((a, b) => b[0] - a[0])
    .slice(0, n)
    .map((x) => x[1])
  const u = norm(cross(c, Math.abs(c[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const w = cross(c, u)
  return near.sort((a, b) => Math.atan2(dot(a, w), dot(a, u)) - Math.atan2(dot(b, w), dot(b, u)))
}

/** Turn the ball so a pentagon faces front with a point up, then tilt it a little toward the light. */
function ballRotation(tiltX: number, tiltY: number): M3 {
  const z: V3 = [0, 0, 1]
  const p0 = PENT_C.find((c) => c[2] > 0.8) ?? PENT_C[0]
  let R = rotMat(cross(p0, z), Math.acos(dot(p0, z)))
  const fv = faceVerts(p0, 5).map((v) => mul(R, v))
  R = mm(rotMat(z, -Math.PI / 2 - Math.atan2(fv[0][1], fv[0][0])), R)
  R = mm(rotMat([1, 0, 0], tiltX), R)
  return mm(rotMat([0, 1, 0], tiltY), R)
}

/** Clip a spherical polygon to the front hemisphere, following the rim between cut points. */
function clipFront(poly: V3[]): V3[] {
  const out: V3[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a[2] >= 0) out.push(a)
    if (a[2] >= 0 !== b[2] >= 0) {
      const p = norm(lerp3(a, b, (0 - a[2]) / (b[2] - a[2])))
      out.push([p[0], p[1], 0])
    }
  }
  const res: V3[] = []
  for (let i = 0; i < out.length; i++) {
    const a = out[i]
    const b = out[(i + 1) % out.length]
    res.push(a)
    if (Math.abs(a[2]) < 1e-9 && Math.abs(b[2]) < 1e-9) {
      for (let k = 1; k < 6; k++) {
        const p = norm(lerp3(a, b, k / 6))
        res.push([p[0], p[1], 0])
      }
    }
  }
  return res
}

interface Face {
  type: 'hex' | 'pent'
  pts: V3[]
  /** The face's outward normal after the rotation (z toward the viewer). */
  n: V3
}

/**
 * The ball's panels: a true truncated icosahedron projected orthographically,
 * each edge bulged onto the sphere so the seams curve like a real ball. A front
 * pentagon, five hexagons around it and the edge panels cut by the rim.
 */
const FACES: Face[] = (() => {
  const R = ballRotation(0.2, -0.16)
  const seg = 6
  const faces: Face[] = []
  for (const [type, centres, n] of [
    ['hex', HEX_C, 6],
    ['pent', PENT_C, 5],
  ] as const) {
    for (const c of centres) {
      const nc = mul(R, c)
      if (nc[2] < -0.35) continue
      const vs = faceVerts(c, n)
      const dense: V3[] = []
      for (let i = 0; i < n; i++) for (let k = 0; k < seg; k++) dense.push(mul(R, norm(lerp3(vs[i], vs[(i + 1) % n], k / seg))))
      const pts = clipFront(dense)
      if (pts.length >= 3) faces.push({ type, pts, n: nc })
    }
  }
  return faces
})()

const LIGHT = norm([-0.55, -0.7, 0.75])

function mix(a: string, b: string, t: number): string {
  const h = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
  const A = h(a)
  const B = h(b)
  return '#' + A.map((c, i) => Math.round(c + (B[i] - c) * t).toString(16).padStart(2, '0')).join('')
}

/** One of the ball's panels at (cx, cy) radius r: its path and, for the shaded ball, its fill by facing angle. */
export interface BallPanel {
  type: 'hex' | 'pent'
  d: string
  fill: string
}

/** The ball's visible panels, laid out at (cx, cy) with radius r (for SVG and for Path2D). */
export function ballPanels(cx: number, cy: number, r: number): BallPanel[] {
  return FACES.map((fc) => {
    const lit = Math.max(0, dot(fc.n, LIGHT))
    return {
      type: fc.type,
      d: 'M' + fc.pts.map((p) => `${r2(cx + p[0] * r)} ${r2(cy + p[1] * r)}`).join('L') + 'Z',
      fill: fc.type === 'hex' ? mix('#aeb9c9', '#ffffff', 0.25 + 0.75 * lit) : mix('#06080c', '#262d39', lit),
    }
  })
}

/** The tiny mono and inverse ball's single patch: a pentagon nudged up and left, so it reads as a ball and not a target. */
export function tinyPatch(cx: number, cy: number, r: number): string {
  return pentagonPath(cx - r * 0.14, cy - r * 0.2, r * 0.52)
}

/**
 * The 16 px colour ball's patches: the front pentagon and the panels on the
 * lower rim. Dropping the upper rim panels keeps the top of the ball a clean
 * white arc against the tile at 16 px, while at 32 device px (a favicon on a
 * high-density screen) the real panels read as a football, not an eye.
 */
export function tinyPanels(cx: number, cy: number, r: number): string[] {
  return ballPanels(cx, cy, r)
    .filter((p) => p.type === 'pent')
    .filter((p) => {
      const pts = [...p.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]])
      const mx = pts.reduce((s, q) => s + q[0], 0) / pts.length
      const my = pts.reduce((s, q) => s + q[1], 0) / pts.length
      return Math.hypot(mx - cx, my - cy) < r * 0.35 || my > cy + r * 0.5
    })
    .map((p) => p.d)
}

/** The flat ball's soft grey edge, so a white disc stays round on blue or on a white page. */
export const BALL_EDGE = { light: '#c3cddb', dark: '#94a3b8' } as const

// ---------------------------------------------------------------- SVG

export type BallStyle = 'colour' | 'knockout' | 'outline'

interface BallOptions {
  cx: number
  cy: number
  r: number
  tier: MarkTier
  /** colour: white with black panels. knockout: a disc of `ink` with the panels cut out. outline: a ring and black panels in `ink`, the body left clear. */
  style?: BallStyle
  ink?: string
  /** The flat ball's edge grey. */
  edge?: string
  /** Extra markup at the end (the lockup's light-theme ring). */
  after?: string
  /** The lockup's flat ball: a soft rim shade, a highlight and a small contact shadow on the line under it. */
  depth?: boolean
}

/** The ball as SVG markup: `defs` go inside <defs>, `body` after it. Ids are prefixed with `id`. */
export function ballSvg(id: string, o: BallOptions): { defs: string; body: string } {
  const { cx, cy, r, tier } = o
  const style = o.style ?? 'colour'
  const ink = o.ink ?? 'currentColor'
  const panels = ballPanels(cx, cy, r)
  const pents = panels.filter((p) => p.type === 'pent')
  const patches = tier === 'tiny' ? [tinyPatch(cx, cy, r)] : pents.map((p) => p.d)
  const clip = `${id}-bc`
  const clipDef = `<clipPath id="${clip}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
  const after = o.after ?? ''
  // The contact shadow: a soft ellipse where the ball meets the line, drawn under the ball
  const shadow = o.depth
    ? { defs: `<radialGradient id="${id}-cs"><stop offset="0" stop-color="#020617" stop-opacity="0.6"/><stop offset="0.55" stop-color="#020617" stop-opacity="0.25"/><stop offset="1" stop-color="#020617" stop-opacity="0"/></radialGradient>`, body: `<ellipse cx="${cx}" cy="${r2(cy + r)}" rx="${r2(r * 0.85)}" ry="${r2(r * 0.14)}" fill="url(#${id}-cs)"/>` }
    : { defs: '', body: '' }
  if (style === 'knockout') {
    // Only the black panels are cut out: seams stroked into the mask break the rim
    const holes = patches.map((d) => `<path d="${d}" fill="#000"/>`).join('')
    return {
      defs: `<mask id="${id}-bm" maskUnits="userSpaceOnUse" x="${r2(cx - r - 1)}" y="${r2(cy - r - 1)}" width="${r2(2 * r + 2)}" height="${r2(2 * r + 2)}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/>${holes}</mask>`,
      body: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${ink}" mask="url(#${id}-bm)"/>${after}`,
    }
  }
  if (style === 'outline') {
    const w = r2(tier === 'tiny' ? 4 : r * 0.13)
    return {
      defs: clipDef,
      body: `<g clip-path="url(#${clip})" fill="${ink}">${patches.map((d) => `<path d="${d}"/>`).join('')}</g><circle cx="${cx}" cy="${cy}" r="${r2(r - w / 2)}" fill="none" stroke="${ink}" stroke-width="${w}"/>${after}`,
    }
  }
  if (tier === 'tiny') {
    // Real panels, not the single patch: at 32 device px (a favicon on a high-density screen) one centred patch reads as an eye
    return { defs: clipDef, body: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff"/><g clip-path="url(#${clip})" fill="${MARK.panel}">${tinyPanels(cx, cy, r).map((d) => `<path d="${d}"/>`).join('')}</g>${after}` }
  }
  if (tier === 'mid') {
    let defs = `${clipDef}<radialGradient id="${id}-rs" cx="${r2(cx - r * 0.3)}" cy="${r2(cy - r * 0.35)}" r="${r2(r * 1.45)}" gradientUnits="userSpaceOnUse"><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="${o.edge ?? BALL_EDGE.light}"/></radialGradient>`
    let over = ''
    if (o.depth) {
      defs += `<radialGradient id="${id}-rim" cx="${r2(cx - r * 0.25)}" cy="${r2(cy - r * 0.3)}" r="${r2(r * 1.3)}" gradientUnits="userSpaceOnUse"><stop offset="0.62" stop-color="#0b1633" stop-opacity="0"/><stop offset="1" stop-color="#0b1633" stop-opacity="0.34"/></radialGradient>`
      defs += `<radialGradient id="${id}-hl" cx="${r2(cx - r * 0.4)}" cy="${r2(cy - r * 0.45)}" r="${r2(r * 0.6)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
      over = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-rim)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-hl)"/>`
    }
    return {
      defs: defs + shadow.defs,
      body: `${shadow.body}<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-rs)"/><g clip-path="url(#${clip})" fill="${MARK.panel}">${patches.map((d) => `<path d="${d}"/>`).join('')}</g>${over}${after}`,
    }
  }
  const hex = panels.filter((p) => p.type === 'hex').map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('')
  const pent = pents.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('')
  return {
    defs:
      clipDef +
      shadow.defs +
      `<radialGradient id="${id}-hl" cx="${r2(cx - r * 0.38)}" cy="${r2(cy - r * 0.42)}" r="${r2(r * 0.75)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${id}-rim" cx="${r2(cx - r * 0.2)}" cy="${r2(cy - r * 0.25)}" r="${r2(r * 1.25)}" gradientUnits="userSpaceOnUse"><stop offset="0.6" stop-color="#0b1633" stop-opacity="0"/><stop offset="1" stop-color="#0b1633" stop-opacity="0.38"/></radialGradient>`,
    body:
      shadow.body +
      `<g clip-path="url(#${clip})" stroke="#2b3547" stroke-width="${r2(r * 0.04)}" stroke-linejoin="round">${hex}${pent}</g>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-rim)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-hl)"/>${after}`,
  }
}

interface ClothOptions {
  /** How deep the folds and shade go (MARK.cloth.strength). */
  strength?: number
  /** Animate the wave (the lockup): the shape and the folds step through the same frames. */
  wave?: boolean
}

/**
 * The pennant as cloth: one shape (`${id}-pc`, defined once, animated once)
 * drawn three times: with the folds, with the light along its upper edge and
 * the shade underneath and along the lower edge, and with the shadow where it
 * meets the pole. Flat red (one path) on the straight tier.
 */
export function pennantCloth(id: string, p: Pennant, o: ClothOptions = {}): { defs: string; body: string } {
  if (p.amp === 0) return { defs: '', body: `<path d="${pennantPath(p)}" fill="${MARK.red}"/>` }
  const C = MARK.cloth
  const k = o.strength ?? 1
  const W = LOCKUP.wave
  const phases = Array.from({ length: W.frames + 1 }, (_, i) => ((i % W.frames) / W.frames) * 2 * Math.PI)
  const flying = { ...p, amp: W.amp }
  const rest = clothStops(p, 0, k)
  const frames = o.wave ? phases.map((ph) => clothStops(flying, ph, k)) : []
  const stops = rest
    .map(([off, c], i) => {
      const anim = o.wave ? `<animate attributeName="stop-color" dur="${W.dur}s" repeatCount="indefinite" values="${frames.map((f) => f[i][1]).join(';')}"/>` : ''
      return anim ? `<stop offset="${off}" stop-color="${c}">${anim}</stop>` : `<stop offset="${off}" stop-color="${c}"/>`
    })
    .join('')
  const len = p.tipX - p.x
  // The folds run slightly slanted, from the upper edge back toward the pole
  const fold = `<linearGradient id="${id}-pf" x1="${p.x}" y1="${p.top}" x2="${p.tipX}" y2="${r2(p.tipY + len * 0.3)}" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`
  // Lit along the upper edge, shaded underneath; it follows the cloth's box as it waves
  const under = `<linearGradient id="${id}-pu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="${r2(0.34 * k)}"/><stop offset="0.16" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.52" stop-color="${C.shade}" stop-opacity="0"/><stop offset="1" stop-color="${C.shade}" stop-opacity="${r2(0.42 * k)}"/></linearGradient>`
  const pole = `<linearGradient id="${id}-pp" x1="${p.x}" y1="0" x2="${r2(p.x + len * 0.16)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.shade}" stop-opacity="${r2(0.5 * k)}"/><stop offset="1" stop-color="${C.shade}" stop-opacity="0"/></linearGradient>`
  const anim = o.wave ? pennantWave(p) : ''
  const shape = `<path id="${id}-pc" d="${pennantPath(p)}">${anim}</path>`
  const use = (fill: string) => `<use href="#${id}-pc" fill="url(#${id}-${fill})"/>`
  return { defs: fold + under + pole + shape, body: use('pf') + use('pu') + use('pp') }
}

/**
 * A pole that reads as a rounded post: the shaft in `ink`, then a slim
 * highlight left of centre and a shade along the right edge over it, and a
 * small round finial on top (when `finial` is given).
 */
function poleSvg(id: string, pole: { x: number; y1: number; y2: number; w: number }, ink: string, caps: 'round' | 'butt', finial?: { cy: number; r: number }, cssInk = false): { defs: string; body: string } {
  // The lockup's ink follows the theme through --tl-ink
  const st = cssInk ? ` style="stroke:var(--tl-ink,${ink})"` : ''
  const fst = cssInk ? ` style="fill:var(--tl-ink,${ink})"` : ''
  const hw = pole.w / 2
  let defs = `<linearGradient id="${id}-ph" x1="${r2(pole.x - hw)}" y1="0" x2="${r2(pole.x + hw)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0.14"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.6"/><stop offset="0.46" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></linearGradient>`
  const line = (stroke: string, extra = '') => `<line x1="${pole.x}" y1="${pole.y1}" x2="${pole.x}" y2="${pole.y2}" stroke="${stroke}"${extra} stroke-width="${pole.w}" stroke-linecap="${caps}"/>`
  let body = line(ink, st) + line(`url(#${id}-ph)`)
  if (finial) {
    const { cy, r } = finial
    defs += `<radialGradient id="${id}-fh" cx="${r2(pole.x - r * 0.35)}" cy="${r2(cy - r * 0.4)}" r="${r2(r * 1.35)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.32"/></radialGradient>`
    body += `<circle cx="${pole.x}" cy="${cy}" r="${r}" fill="${ink}"${fst}/><circle cx="${pole.x}" cy="${cy}" r="${r}" fill="url(#${id}-fh)"/>`
  }
  return { defs, body }
}

export interface MarkSvgOptions {
  tier: MarkTier
  variant?: MarkVariant
  /** rounded: the tile with transparent corners. square: full bleed (maskable and iOS icons). */
  tile?: 'rounded' | 'square'
  /** The glyph's scale about the centre, to keep it inside a mask's safe zone. */
  scale?: number
}

/** The mark's inner SVG (defs and shapes) on the 64 grid. Every id starts with `id`. */
export function markSvgInner(id: string, o: MarkSvgOptions): string {
  const T = MARK.tiers[o.tier]
  const variant = o.variant ?? 'colour'
  const g = MARK.grid
  const gradId = `${id}-tile`
  const penId = `${id}-pen`
  let defs = ''
  let tile = ''
  if (variant !== 'mono') {
    defs += `<linearGradient id="${gradId}" x1="0" y1="0" x2="${g}" y2="${g}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${MARK.gradient[0]}"/><stop offset="1" stop-color="${MARK.gradient[1]}"/></linearGradient>`
    const fill = variant === 'colour' ? `url(#${gradId})` : '#ffffff'
    tile = o.tile === 'square' ? `<rect width="${g}" height="${g}" fill="${fill}"/>` : `<rect width="${g}" height="${g}" rx="${MARK.tileRadius}" fill="${fill}"/>`
  }
  const ink = variant === 'colour' ? '#ffffff' : variant === 'inverse' ? `url(#${gradId})` : 'currentColor'
  let pennant = `<path d="${pennantPath(T.pennant)}" fill="${ink}"/>`
  if (variant !== 'mono') {
    const cloth = pennantCloth(penId, T.pennant, { strength: o.tier === 'tiny' ? 0 : MARK.cloth.strength[o.tier] })
    defs += cloth.defs
    pennant = cloth.body
  }
  // The rounded post and its finial on the full tier; a plain stroke below it
  const finial = o.tier === 'full' ? MARK.tiers.full.finial : undefined
  let pole = `<line x1="${T.pole.x}" y1="${T.pole.y1}" x2="${T.pole.x}" y2="${T.pole.y2}" stroke="${ink}" stroke-width="${T.pole.w}" stroke-linecap="${T.caps}"/>`
  if (o.tier === 'full' && variant !== 'mono') {
    const ps = poleSvg(`${id}-p`, T.pole, ink, T.caps, finial)
    defs += ps.defs
    pole = ps.body
  } else if (finial) pole += `<circle cx="${T.pole.x}" cy="${finial.cy}" r="${finial.r}" fill="${ink}"/>`
  const b = ballSvg(`${id}-b`, { ...T.ball, tier: o.tier, style: variant === 'colour' ? 'colour' : variant === 'mono' ? 'knockout' : 'outline', ink })
  defs += b.defs
  const glyph =
    pennant +
    pole +
    `<line x1="${T.line.x1}" y1="${T.line.y}" x2="${T.line.x2}" y2="${T.line.y}" stroke="${ink}" stroke-width="${T.line.w}" stroke-linecap="${T.caps}"/>` +
    b.body
  const s = o.scale ?? 1
  const t = r2((g / 2) * (1 - s))
  return `<defs>${defs}</defs>${tile}${s === 1 ? glyph : `<g transform="translate(${t} ${t}) scale(${s})">${glyph}</g>`}`
}

/** The mark as a standalone SVG document, `px` square. */
export function markSvg(id: string, px: number, o: MarkSvgOptions): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${MARK.grid} ${MARK.grid}">${markSvgInner(id, o)}</svg>`
}

/**
 * The pennant's flutter: SMIL keyframes stepping the wave along the cloth, one
 * full loop (the last frame is the first), so it plays in every browser and
 * the pole never moves. Without it (reduced motion, the icons) the pennant
 * keeps its resting shape.
 */
export function pennantWave(p: Pennant): string {
  const W = LOCKUP.wave
  const flying = { ...p, amp: W.amp }
  const values = Array.from({ length: W.frames + 1 }, (_, i) => pennantPath(flying, 28, ((i % W.frames) / W.frames) * 2 * Math.PI))
  return `<animate attributeName="d" dur="${W.dur}s" repeatCount="indefinite" values="${values.join(';')}"/>`
}

/**
 * The lockup's flag (the pennant as cloth, the rounded pole and its finial) in
 * a 0 0 LOCKUP_FLAG_WIDTH 64 box. The pole takes its colour from the CSS
 * variable --tl-ink (white on dark, the text navy on light). `wave` adds the
 * pennant's flutter, its folds moving with it (the pole stays still).
 */
export function lockupFlagSvg(id: string, wave = false): string {
  const cloth = pennantCloth(`${id}-pen`, LOCKUP.pennant, { wave, strength: MARK.cloth.strength.lockup })
  const pole = poleSvg(`${id}-pole`, LOCKUP.pole, '#ffffff', 'round', LOCKUP.finial, true)
  return `<defs>${cloth.defs}${pole.defs}</defs>${cloth.body}${pole.body}`
}

/** The lockup's ball in a 0 0 2r 2r box, with a ring that only shows on light (--tl-ball-ring). */
export function lockupBallSvg(id: string, tier: MarkTier): string {
  const r = LOCKUP.ball.r
  const w = tier === 'full' ? 1.1 : 1.5
  const ring = `<circle cx="${r}" cy="${r}" r="${r2(r - w / 2)}" fill="none" stroke="transparent" style="stroke:var(--tl-ball-ring,transparent)" stroke-width="${w}"/>`
  const b = ballSvg(`${id}-b`, { cx: r, cy: r, r, tier: tier === 'tiny' ? 'mid' : tier, edge: BALL_EDGE.dark, after: ring, depth: true })
  return `<defs>${b.defs}</defs>${b.body}`
}

/**
 * Colours for drawing outside the stylesheet. They mirror the Floodlit (dark)
 * tokens in styles.css; keep the two in step.
 */
export const BRAND_COLOURS = {
  bg: '#07102e',
  panel: '#0c1a46',
  navy: '#081544',
  navy2: '#13266b',
  line: '#1f3270',
  text: '#f1f4ff',
  text2: '#c3cdf0',
  text3: '#93a3d6',
  primary: '#38d9f5',
  accent: '#5ee3fb',
  magenta: '#e070ff',
  good: '#34d399',
  warn: '#fb923c',
  bad: '#f87171',
  gold: '#f5c542',
  draw: '#f5c542',
  pitch: '#1d7a3f',
  pitch2: '#1a6f39',
  pitchLine: 'rgba(255, 255, 255, 0.5)',
  pitchDisc: 'rgba(7, 16, 46, 0.9)',
  rating90: '#f5c542',
  rating85: '#eab308',
  rating80: '#3b82f6',
  rating75: '#93c5fd',
  rating70: '#a5b4cb',
  ratingBase: '#94a3b8',
} as const
