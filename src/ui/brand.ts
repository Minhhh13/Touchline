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
}

interface TierGeometry {
  pole: { x: number; y1: number; y2: number; w: number }
  line: { x1: number; x2: number; y: number; w: number }
  pennant: Pennant
  ball: { cx: number; cy: number; r: number }
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
  /** The pennant: a light-dark fold along the cloth on the waving tiers, flat red on the straight one. */
  red: '#ef4444',
  fold: [
    [0, '#dc2626'],
    [0.22, '#f87171'],
    [0.5, '#ef4444'],
    [0.74, '#b91c1c'],
    [1, '#ef4444'],
  ] as const,
  /** The ball's black panels. */
  panel: '#0d1117',
  tiers: {
    full: {
      pole: standing(16, 9.8, 2.8, FULL_LINE, 'round'),
      line: FULL_LINE,
      pennant: { x: 16, top: 12, bottom: 27.2, tipX: 38.5, tipY: 19.2, amp: 1.7 },
      ball: onLine(41.5, 11.5, FULL_LINE),
      caps: 'round',
    },
    mid: {
      pole: standing(16, 9.4, 4, MID_LINE, 'round'),
      line: MID_LINE,
      pennant: { x: 16, top: 11.5, bottom: 28.9, tipX: 39, tipY: 19.9, amp: 1.1 },
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
  pole: { x: 9, y1: 9, y2: 50.5, w: 3 },
  pennant: { x: 9, top: 10, bottom: 26.5, tipX: 41, tipY: 17.5, amp: 1.8 },
  /** The short line: its left end (the pole's left edge), length, top edge and thickness. */
  rule: { left: 7.5, length: 36, y: 52, w: 2 },
  ball: { cx: 28, r: 11.5 },
  /** The ball rolls in this far (u) along the line to its spot, fading in as it starts. */
  roll: 5,
  /** The name: left edge, top of its line box, font size (cap height 0.7 of it), and where its baseline lands (the line's top). */
  name: { left: 47.5, top: 12, size: 44.3, baseline: 52 },
  /** The pennant's flutter: one loop in seconds, and the frames it steps through. */
  wave: { dur: 2.6, frames: 8, amp: 2.2 },
  /** Below this ball diameter in px the lockup uses the flat ball. */
  fullBallFrom: 40,
} as const

/** The lockup's flag drawing box (viewBox 0 0 flagWidth 64). */
export const LOCKUP_FLAG_WIDTH = 46

const r2 = (n: number) => +n.toFixed(2)

/**
 * A pennant from the pole: a triangle whose two edges carry the same gentle
 * wave. `phase` (radians) moves the wave along the cloth, away from the pole;
 * the edge at the pole never moves, and phase 0 is the resting shape.
 */
export function pennantPath(p: Pennant, steps = 28, phase = 0): string {
  if (p.amp === 0) return `M${p.x} ${p.top}L${p.tipX} ${p.tipY}L${p.x} ${p.bottom}Z`
  const wave = (t: number) => -p.amp * (Math.sin(Math.PI * t * 1.15 - phase) + Math.sin(phase) * (1 - t)) * (0.35 + 0.65 * t)
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    pts.push(`${r2(p.x + (p.tipX - p.x) * t)} ${r2(p.top + (p.tipY - p.top) * t + wave(t))}`)
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    pts.push(`${r2(p.x + (p.tipX - p.x) * t)} ${r2(p.bottom + (p.tipY - p.bottom) * t + wave(t))}`)
  }
  return `M${pts.join('L')}Z`
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
    return {
      defs: `${clipDef}<radialGradient id="${id}-rs" cx="${r2(cx - r * 0.3)}" cy="${r2(cy - r * 0.35)}" r="${r2(r * 1.45)}" gradientUnits="userSpaceOnUse"><stop offset="0.55" stop-color="#ffffff"/><stop offset="1" stop-color="${o.edge ?? BALL_EDGE.light}"/></radialGradient>`,
      body: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-rs)"/><g clip-path="url(#${clip})" fill="${MARK.panel}">${patches.map((d) => `<path d="${d}"/>`).join('')}</g>${after}`,
    }
  }
  const hex = panels.filter((p) => p.type === 'hex').map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('')
  const pent = pents.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('')
  return {
    defs:
      clipDef +
      `<radialGradient id="${id}-hl" cx="${r2(cx - r * 0.38)}" cy="${r2(cy - r * 0.42)}" r="${r2(r * 0.75)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${id}-rim" cx="${r2(cx - r * 0.2)}" cy="${r2(cy - r * 0.25)}" r="${r2(r * 1.25)}" gradientUnits="userSpaceOnUse"><stop offset="0.6" stop-color="#0b1633" stop-opacity="0"/><stop offset="1" stop-color="#0b1633" stop-opacity="0.38"/></radialGradient>`,
    body:
      `<g clip-path="url(#${clip})" stroke="#2b3547" stroke-width="${r2(r * 0.04)}" stroke-linejoin="round">${hex}${pent}</g>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-rim)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-hl)"/>${after}`,
  }
}

function foldGradient(id: string, p: Pennant): string {
  if (p.amp === 0) return ''
  const stops = MARK.fold.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
  return `<linearGradient id="${id}" x1="${p.x}" y1="0" x2="${p.tipX}" y2="0" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`
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
  let red = ink
  if (variant !== 'mono') {
    const fold = foldGradient(penId, T.pennant)
    defs += fold
    red = fold ? `url(#${penId})` : MARK.red
  }
  const b = ballSvg(`${id}-b`, { ...T.ball, tier: o.tier, style: variant === 'colour' ? 'colour' : variant === 'mono' ? 'knockout' : 'outline', ink })
  defs += b.defs
  const glyph =
    `<path d="${pennantPath(T.pennant)}" fill="${red}"/>` +
    `<line x1="${T.pole.x}" y1="${T.pole.y1}" x2="${T.pole.x}" y2="${T.pole.y2}" stroke="${ink}" stroke-width="${T.pole.w}" stroke-linecap="${T.caps}"/>` +
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
 * The lockup's flag (pennant and pole) in a 0 0 LOCKUP_FLAG_WIDTH 64 box. The
 * pole takes its colour from the CSS variable --tl-ink (white on dark, the text
 * navy on light). `wave` adds the pennant's flutter (the pole stays still).
 */
export function lockupFlagSvg(id: string, wave = false): string {
  const P = LOCKUP.pennant
  const pole = LOCKUP.pole
  const anim = wave ? pennantWave(P) : ''
  return `<defs>${foldGradient(`${id}-pen`, P)}</defs><path d="${pennantPath(P)}" fill="url(#${id}-pen)">${anim}</path><line x1="${pole.x}" y1="${pole.y1}" x2="${pole.x}" y2="${pole.y2}" stroke="#ffffff" style="stroke:var(--tl-ink,#ffffff)" stroke-width="${pole.w}" stroke-linecap="round"/>`
}

/** The lockup's ball in a 0 0 2r 2r box, with a ring that only shows on light (--tl-ball-ring). */
export function lockupBallSvg(id: string, tier: MarkTier): string {
  const r = LOCKUP.ball.r
  const w = tier === 'full' ? 1.1 : 1.5
  const ring = `<circle cx="${r}" cy="${r}" r="${r2(r - w / 2)}" fill="none" stroke="transparent" style="stroke:var(--tl-ball-ring,transparent)" stroke-width="${w}"/>`
  const b = ballSvg(`${id}-b`, { cx: r, cy: r, r, tier: tier === 'tiny' ? 'mid' : tier, edge: BALL_EDGE.dark, after: ring })
  return `<defs>${b.defs}</defs>${b.body}`
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
