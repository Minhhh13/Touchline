/**
 * Render a shareable PNG of a season result on a canvas: tier, record, the XI
 * on a pitch and the TouchLine lockup. Resolves to a data URL once the type
 * has loaded. The card is always drawn in the Floodlit colours (brand.ts),
 * whatever the viewer's theme.
 */
import type { Formation, MatchEvent, PlayerSeason, TableRow } from '@engine/types'
import type { SeasonTier } from '@engine/types'
import type { BadgeState, BadgeTier } from '@engine/badges'
import type { Cabinet } from '@game/types'
import { BALL_EDGE, BRAND_COLOURS as C, LOCKUP, MARK, WORDMARK, ballPanels, clothStops, pennantPath } from './brand'
import { tierName } from './format'
import { exportDataUrl } from './exportFile'

export interface ShareCardInput {
  title: string
  subtitle: string
  tier: SeasonTier
  row: Pick<TableRow, 'won' | 'drawn' | 'lost' | 'points'>
  position: number
  formation: Formation
  lineup: Record<string, string>
  getPlayer: (id: string) => PlayerSeason | undefined
  footer: string
  hideRatings?: boolean
  /** Season Story: one cell per game under the record, up to 46. */
  strip?: Array<'W' | 'D' | 'L'>
  /** Season Story: one line under the strip. */
  moment?: string
  /** Replaces the tier label (an arena result names its own round). */
  banner?: { text: string; colour?: string }
  /** Up to six lines drawn in place of the W/D/L row and the points line (knockout ties, a ladder). */
  lines?: string[]
  /** The Treble or a Double, one gold line under the record ("The Treble · League, Cup and Continental Cup"). */
  honour?: string
  /** The draft's grade ("Draft grade B"), one accent line under the record. */
  grade?: string
}

const STRIP_COLOUR: Record<'W' | 'D' | 'L', string> = { W: C.good, D: C.draw, L: C.bad }

const TIER_COLOUR: Partial<Record<SeasonTier, string>> = {
  PERFECT: C.gold,
  INVINCIBLE: C.gold,
  CHAMPIONS: C.gold,
  TITLE_RACE: C.accent,
  EUROPEAN: C.accent,
  MID_TABLE: C.text2,
  RELEGATION_BATTLE: C.warn,
  RELEGATED: C.bad,
}

/** The rating scale of styles.css (--rating-*), as solid colours for the disc rings. */
function ratingColour(v: number): string {
  if (v >= 90) return C.rating90
  if (v >= 85) return C.rating85
  if (v >= 80) return C.rating80
  if (v >= 75) return C.rating75
  if (v >= 70) return C.rating70
  return C.ratingBase
}

/** The site's one family (--font-display and --font-body in styles.css). */
const DISPLAY = "'Sora', 'Segoe UI', system-ui, sans-serif"
const BODY = DISPLAY

/**
 * A canvas draws with whatever is loaded when it draws, so wait for the faces
 * the cards use (at most 2 s; offline it draws in the fallback face).
 */
async function cardFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  const load = Promise.all([400, 600, 700].map((w) => document.fonts.load(`${w} 40px 'Sora'`))).then(() => undefined, () => undefined)
  await Promise.race([load, new Promise<void>((done) => setTimeout(done, 2000))])
}

export async function renderShareCard(input: ShareCardInput): Promise<string> {
  await cardFontsReady()
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  // Background: deep navy with a blue floodlight from the top
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, C.panel)
  g.addColorStop(1, C.bg)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 760)
  glow.addColorStop(0, 'rgba(37, 99, 235, 0.32)')
  glow.addColorStop(1, 'rgba(37, 99, 235, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const font = (size: number, weight = 700, family = DISPLAY) => `${weight} ${size}px ${family}`
  ctx.textAlign = 'center'
  ctx.fillStyle = C.text
  ctx.font = font(48)
  ctx.fillText(fit(ctx, input.title, W - 120), W / 2, 92)
  ctx.fillStyle = C.text2
  ctx.font = font(24, 400, BODY)
  ctx.fillText(fit(ctx, input.subtitle, W - 120), W / 2, 134)

  ctx.fillStyle = input.banner?.colour ?? TIER_COLOUR[input.tier] ?? C.text
  ctx.font = font(72)
  ctx.fillText(fit(ctx, input.banner?.text ?? tierName(input.tier, input.position), W - 120), W / 2, 228)

  const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 > 3 ? 0 : n % 10] ?? 'th')
  // The caller's own lines (knockout ties, a ladder) in place of the record; `y` is the baseline of the last thing drawn
  let y = 392
  const lines = (input.lines ?? []).slice(0, 6)
  if (lines.length) {
    ctx.textAlign = 'center'
    ctx.fillStyle = C.text
    ctx.font = font(30, 600, BODY)
    lines.forEach((l, i) => ctx.fillText(fit(ctx, l, W - 160), W / 2, 290 + i * 42))
    y = 290 + (lines.length - 1) * 42
  } else {
    // Record: wins, draws, defeats in the status colours
    const rec = [
      { t: `${input.row.won}W`, c: C.good },
      { t: `${input.row.drawn}D`, c: C.draw },
      { t: `${input.row.lost}L`, c: C.bad },
    ]
    ctx.font = font(52)
    const widths = rec.map((r) => ctx.measureText(r.t).width)
    const gap = 40
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * 2) / 2
    for (let i = 0; i < rec.length; i++) {
      ctx.fillStyle = rec[i].c
      ctx.textAlign = 'left'
      ctx.fillText(rec[i].t, x, 306)
      x += widths[i] + gap
    }
    // The season as blocks, one per match: in the order played when the Season Story strip is given, as on the summary screen otherwise
    const strip = (input.strip ?? []).slice(0, 46)
    const games = strip.length ? strip.map((o) => STRIP_COLOUR[o]) : [...Array<string>(input.row.won).fill(C.good), ...Array<string>(input.row.drawn).fill(C.draw), ...Array<string>(input.row.lost).fill(C.bad)]
    const block = Math.min(18, Math.floor((W - 180) / Math.max(1, games.length)) - 5)
    const blocksW = games.length * (block + 5) - 5
    games.forEach((c, i) => {
      ctx.fillStyle = c
      roundRect(ctx, W / 2 - blocksW / 2 + i * (block + 5), 330, block, block, 3)
      ctx.fill()
    })
    ctx.textAlign = 'center'
    ctx.fillStyle = C.text
    ctx.font = font(28, 600, BODY)
    ctx.fillText(`${input.row.points} points · finished ${ord(input.position)}`, W / 2, 392)
  }
  // The Treble or a Double, in gold
  if (input.honour) {
    ctx.textAlign = 'center'
    ctx.fillStyle = C.gold
    ctx.font = font(30, 700)
    ctx.fillText(fit(ctx, input.honour, W - 160), W / 2, y + 42)
    y += 42
  }
  // The draft's grade, as the recap gave it
  if (input.grade) {
    ctx.textAlign = 'center'
    ctx.fillStyle = C.accent
    ctx.font = font(26, 700)
    ctx.fillText(fit(ctx, input.grade, W - 160), W / 2, y + 40)
    y += 40
  }
  // Season Story: the one line that tells the season
  if (input.moment) {
    ctx.textAlign = 'center'
    ctx.fillStyle = C.text2
    ctx.font = font(26, 600, BODY)
    ctx.fillText(fit(ctx, input.moment, W - 160), W / 2, y + 40)
    y += 40
  }

  // The pitch: grass stays green, the frame and lines are neutral; pushed down (and shortened) by whatever sits above it
  const px = 90
  const py = Math.max(420, y + 28)
  const pw = W - 180
  const ph = 1136 - py
  ctx.fillStyle = C.pitch
  roundRect(ctx, px, py, pw, ph, 22)
  ctx.fill()
  ctx.save()
  roundRect(ctx, px, py, pw, ph, 22)
  ctx.clip()
  ctx.fillStyle = C.pitch2
  for (let i = 0; i < 8; i += 2) ctx.fillRect(px, py + (ph / 8) * i, pw, ph / 8)
  ctx.restore()
  ctx.strokeStyle = C.navy2
  ctx.lineWidth = 4
  roundRect(ctx, px, py, pw, ph, 22)
  ctx.stroke()
  ctx.strokeStyle = C.pitchLine
  ctx.lineWidth = 3
  ctx.strokeRect(px + 20, py + 20, pw - 40, ph - 40)
  ctx.beginPath()
  ctx.moveTo(px + 20, py + ph / 2)
  ctx.lineTo(px + pw - 20, py + ph / 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(px + pw / 2, py + ph / 2, 80, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeRect(px + pw / 2 - 180, py + 20, 360, 120)
  ctx.strokeRect(px + pw / 2 - 180, py + ph - 140, 360, 120)

  for (const slot of input.formation.slots) {
    const id = input.lineup[slot.id]
    const p = id ? input.getPlayer(id) : undefined
    const cx = px + (slot.x / 100) * pw
    // Inset so the keeper's name and the striker's disc stay on the grass
    const cy = py + 56 + ((100 - slot.y) / 100) * (ph - 140)
    ctx.fillStyle = C.pitchDisc
    ctx.beginPath()
    ctx.arc(cx, cy - 10, 34, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = p ? ratingColour(p.overall) : 'rgba(255, 255, 255, 0.4)'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = font(24)
    ctx.textAlign = 'center'
    ctx.fillText(p ? (input.hideRatings ? '?' : String(p.overall)) : slot.position, cx, cy)
    if (p) {
      ctx.font = font(18, 600, BODY)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
      ctx.shadowBlur = 4
      ctx.fillText(fit(ctx, p.name, 170), cx, cy + 48)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
      ctx.font = font(16, 400, BODY)
      ctx.fillText(`${p.season}-${String((p.season + 1) % 100).padStart(2, '0')}`, cx, cy + 70)
    }
  }

  ctx.fillStyle = C.text3
  ctx.font = font(20, 400, BODY)
  ctx.textAlign = 'center'
  ctx.fillText(input.footer, W / 2, H - 132)
  drawLockup(ctx, W / 2, H - 72, 76)
  return canvas.toDataURL('image/png')
}

/**
 * The open lockup of brand.ts (LOCKUP), `h` px tall and centred on (cx, cy):
 * the corner flag standing on a short touchline, the flat ball resting on it,
 * and the two-tone name standing on the same ground (no line under the name).
 */
function drawLockup(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number) {
  const u = h / LOCKUP.grid
  ctx.font = `700 ${LOCKUP.name.size * u}px ${DISPLAY}`
  const [touch, line] = WORDMARK
  const wTouch = ctx.measureText(touch).width
  const wLine = ctx.measureText(line).width
  const width = LOCKUP.name.left * u + wTouch + wLine
  ctx.save()
  ctx.translate(cx - width / 2, cy - h / 2)
  // The short touchline, from the pole's left edge to a little past the ball
  const rule = LOCKUP.rule
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, rule.left * u, rule.y * u, rule.length * u, rule.w * u, (rule.w / 2) * u)
  ctx.fill()
  // The ball (the flat tier: a white disc with a soft grey edge and the black panels)
  const b = LOCKUP.ball
  const bx = b.cx * u
  const by = (rule.y - b.r) * u
  const br = b.r * u
  const shade = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.35, 0, bx - br * 0.3, by - br * 0.35, br * 1.45)
  shade.addColorStop(0.55, '#ffffff')
  shade.addColorStop(1, BALL_EDGE.dark)
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.arc(bx, by, br, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = MARK.panel
  for (const p of ballPanels(bx, by, br)) if (p.type === 'pent') ctx.fill(new Path2D(p.d))
  ctx.restore()
  // The flag: the pennant with its folds (at rest), then the pole standing on the line and its finial
  ctx.save()
  ctx.scale(u, u)
  const P = LOCKUP.pennant
  const fold = ctx.createLinearGradient(P.x, P.top, P.tipX, P.tipY + (P.tipX - P.x) * 0.3)
  for (const [o, c] of clothStops(P, 0, MARK.cloth.strength.lockup)) fold.addColorStop(o, c)
  ctx.fillStyle = fold
  ctx.fill(new Path2D(pennantPath(P)))
  const pole = LOCKUP.pole
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = pole.w
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pole.x, pole.y1)
  ctx.lineTo(pole.x, pole.y2)
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(pole.x, LOCKUP.finial.cy, LOCKUP.finial.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // The name, its baseline where the stylesheet puts it
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const baseline = LOCKUP.name.baseline * u
  ctx.fillStyle = C.text
  ctx.fillText(touch, LOCKUP.name.left * u, baseline)
  ctx.fillStyle = C.accent
  ctx.fillText(line, LOCKUP.name.left * u + wTouch, baseline)
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface MatchCardInput {
  title: string
  subtitle: string
  home: { name: string; colour: string; goals: number; xg: number }
  away: { name: string; colour: string; goals: number; xg: number }
  /** Events with positions (attacking coordinates for their side); the rest are skipped. */
  events: MatchEvent[]
  /** Cumulative xG per minute, 0..90, for each side (see xgSeries). */
  xgHome: number[]
  xgAway: number[]
  footer: string
}

const SHOT_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal', 'chance', 'save'])
const GOAL_TYPES = new Set<MatchEvent['type']>(['goal', 'penalty', 'own_goal'])

/**
 * A shareable PNG of one match: the score, the shot map (home shots at the
 * right-hand goal, away at the left) and the xG race. Resolves to a data URL.
 */
export async function renderMatchCard(input: MatchCardInput): Promise<string> {
  await cardFontsReady()
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, C.panel)
  g.addColorStop(1, C.bg)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 760)
  glow.addColorStop(0, 'rgba(37, 99, 235, 0.32)')
  glow.addColorStop(1, 'rgba(37, 99, 235, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  const font = (size: number, weight = 700, family = DISPLAY) => `${weight} ${size}px ${family}`
  const body = BODY

  ctx.textAlign = 'center'
  ctx.fillStyle = C.text2
  ctx.font = font(24, 400, body)
  ctx.fillText(fit(ctx, input.subtitle, W - 120), W / 2, 70)
  ctx.fillStyle = C.text
  ctx.font = font(36)
  ctx.fillText(fit(ctx, input.title, W - 120), W / 2, 118)

  // Score: names either side, the colours as bars under them
  ctx.font = font(120)
  ctx.fillText(`${input.home.goals} - ${input.away.goals}`, W / 2, 290)
  ctx.font = font(34)
  ctx.textAlign = 'right'
  ctx.fillText(fit(ctx, input.home.name, 300), 330, 240)
  ctx.textAlign = 'left'
  ctx.fillText(fit(ctx, input.away.name, 300), W - 330, 240)
  ctx.fillStyle = input.home.colour
  ctx.fillRect(330 - 120, 258, 120, 8)
  ctx.fillStyle = input.away.colour
  ctx.fillRect(W - 330, 258, 120, 8)

  // Shot map
  const px = 90
  const py = 350
  const pw = W - 180
  const ph = Math.round((pw * 68) / 105)
  ctx.save()
  roundRect(ctx, px, py, pw, ph, 18)
  ctx.clip()
  ctx.fillStyle = C.pitch
  ctx.fillRect(px, py, pw, ph)
  ctx.fillStyle = C.pitch2
  for (let i = 0; i < 10; i += 2) ctx.fillRect(px + (pw / 10) * i, py, pw / 10, ph)
  ctx.restore()
  const sx = (x: number) => px + (x / 100) * pw
  const sy = (y: number) => py + (y / 100) * ph
  ctx.strokeStyle = C.pitchLine
  ctx.lineWidth = 3
  roundRect(ctx, px, py, pw, ph, 18)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(sx(50), py)
  ctx.lineTo(sx(50), py + ph)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(sx(50), sy(50), (9.15 / 105) * pw, 0, Math.PI * 2)
  ctx.stroke()
  const boxDepth = (16.5 / 105) * 100
  const boxHalf = (20.15 / 68) * 100
  ctx.strokeRect(px, sy(50 - boxHalf), (boxDepth / 100) * pw, ((2 * boxHalf) / 100) * ph)
  ctx.strokeRect(sx(100 - boxDepth), sy(50 - boxHalf), (boxDepth / 100) * pw, ((2 * boxHalf) / 100) * ph)
  for (const e of input.events) {
    if (!SHOT_TYPES.has(e.type) || !e.position) continue
    const x = e.side === 'home' ? e.position.x : 100 - e.position.x
    const y = e.side === 'home' ? e.position.y : 100 - e.position.y
    const colour = e.side === 'home' ? input.home.colour : input.away.colour
    ctx.beginPath()
    if (GOAL_TYPES.has(e.type)) {
      ctx.arc(sx(x), sy(y), 17, 0, Math.PI * 2)
      ctx.fillStyle = colour
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    } else {
      ctx.arc(sx(x), sy(y), 13, 0, Math.PI * 2)
      ctx.lineWidth = 5
      ctx.strokeStyle = colour
      ctx.setLineDash(e.type === 'save' ? [] : [7, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
  ctx.fillStyle = C.text2
  ctx.font = font(20, 400, body)
  ctx.textAlign = 'center'
  ctx.fillText('Shot map: filled = goal, ring = saved, dashed = chance', W / 2, py + ph + 40)

  // xG race
  const cx = 150
  const cy = py + ph + 110
  const cw = W - 240
  const ch = 150
  const yMax = Math.max(0.5, Math.ceil(Math.max(input.home.xg, input.away.xg) * 2) / 2)
  const X = (m: number) => cx + (m / 90) * cw
  const Y = (v: number) => cy + ch - (v / yMax) * ch
  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.fillStyle = C.text3
  ctx.textAlign = 'right'
  for (const t of [0, yMax / 2, yMax]) {
    ctx.beginPath()
    ctx.moveTo(cx, Y(t))
    ctx.lineTo(cx + cw, Y(t))
    ctx.stroke()
    ctx.fillText(String(+t.toFixed(2)), cx - 12, Y(t) + 8)
  }
  ctx.textAlign = 'center'
  ctx.fillText('HT', X(45), cy + ch + 34)
  const line = (series: number[], colour: string) => {
    ctx.beginPath()
    series.forEach((v, m) => (m === 0 ? ctx.moveTo(X(m), Y(v)) : ctx.lineTo(X(m), Y(v))))
    ctx.lineJoin = 'round'
    ctx.lineWidth = 10
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.stroke()
    ctx.lineWidth = 6
    ctx.strokeStyle = colour
    ctx.stroke()
  }
  line(input.xgHome, input.home.colour)
  line(input.xgAway, input.away.colour)
  ctx.font = font(30)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.text
  ctx.fillText(`xG ${input.home.xg.toFixed(2)} - ${input.away.xg.toFixed(2)}`, cx, cy - 14)

  ctx.textAlign = 'center'
  ctx.fillStyle = C.text3
  ctx.font = font(20, 400, body)
  ctx.fillText(input.footer, W / 2, H - 120)
  drawLockup(ctx, W / 2, H - 62, 48)
  return canvas.toDataURL('image/png')
}

export interface ManagerCardInput {
  name: string
  seasons: number
  cabinet: Pick<Cabinet, 'league' | 'cup' | 'continental' | 'doubles' | 'trebles' | 'perfect'>
  /** Up to six badges, best first (`topBadges`). */
  badges: Array<Pick<BadgeState, 'tier' | 'progress'> & { badge: Pick<BadgeState['badge'], 'icon' | 'title'> }>
  /** Up to three best seasons, already worded: a title line and a detail line each. */
  best: Array<{ title: string; detail: string }>
  dataStamp: string
}

const RING_COLOUR: Record<BadgeTier, string> = { bronze: '#cd8a4a', silver: '#c9d3d8', gold: C.gold }

/**
 * The Trophy Room's manager card, 1080 by 1350: the name and seasons
 * simulated, a 3 by 2 grid of trophy counts, the top six badges with their
 * tier rings, three best seasons and the footer. Returns a data URL.
 */
export function renderManagerCard(input: ManagerCardInput): string {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, C.panel)
  g.addColorStop(1, C.bg)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(37, 99, 235, 0.12)'
  ctx.beginPath()
  ctx.arc(W / 2, -220, 700, 0, Math.PI * 2)
  ctx.fill()
  const font = (size: number, weight = 700, family = DISPLAY) => `${weight} ${size}px ${family}`
  const body = BODY

  ctx.textAlign = 'center'
  ctx.fillStyle = C.text2
  ctx.font = font(26, 600, body)
  ctx.fillText('MANAGER CARD', W / 2, 70)
  ctx.fillStyle = C.text
  ctx.font = font(84)
  ctx.fillText(fit(ctx, input.name.toUpperCase(), W - 140), W / 2, 160)
  ctx.fillStyle = C.text2
  ctx.font = font(28, 400, body)
  ctx.fillText(`${input.seasons} season${input.seasons === 1 ? '' : 's'} simulated`, W / 2, 205)

  // Trophy counts, 3 by 2
  const c = input.cabinet
  const trophies: Array<[string, string, number]> = [
    ['🏆', 'League titles', c.league],
    ['🥇', 'Cups', c.cup],
    ['🌍', 'Continental Cups', c.continental],
    ['🏆🏆', 'Doubles', c.doubles],
    ['👑', 'Trebles', c.trebles],
    ['💎', 'Perfect seasons', c.perfect],
  ]
  const cellW = (W - 180) / 3
  trophies.forEach(([icon, label, n], i) => {
    const x = 90 + (i % 3) * cellW
    const y = 240 + Math.floor(i / 3) * 170
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    roundRect(ctx, x + 10, y, cellW - 20, 150, 16)
    ctx.fill()
    ctx.globalAlpha = n ? 1 : 0.45
    // An emoji takes the fill's alpha too, so not the cell's 5% white
    ctx.fillStyle = C.text
    ctx.font = font(40, 400, body)
    ctx.fillText(icon, x + cellW / 2, y + 50)
    ctx.fillStyle = n ? C.gold : C.text
    ctx.font = font(56)
    ctx.fillText(String(n), x + cellW / 2, y + 108)
    ctx.fillStyle = C.text2
    ctx.font = font(22, 400, body)
    ctx.fillText(label, x + cellW / 2, y + 138)
    ctx.globalAlpha = 1
  })

  // Badges with their tier rings, 3 by 2
  ctx.fillStyle = C.text
  ctx.font = font(34)
  ctx.fillText('TROPHY ROOM', W / 2, 620)
  input.badges.slice(0, 6).forEach((b, i) => {
    const cx = 90 + (i % 3) * cellW + cellW / 2
    const cy = 700 + Math.floor(i / 3) * 190
    ctx.globalAlpha = b.tier ? 1 : 0.45
    ctx.beginPath()
    ctx.arc(cx, cy, 52, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(8,20,14,0.9)'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = b.tier ? RING_COLOUR[b.tier] : 'rgba(255,255,255,0.25)'
    ctx.stroke()
    ctx.fillStyle = C.text
    ctx.font = font(44, 400, body)
    ctx.fillText(b.badge.icon, cx, cy + 16)
    ctx.font = font(28)
    ctx.fillText(fit(ctx, b.badge.title, cellW - 20), cx, cy + 88)
    ctx.fillStyle = b.tier ? RING_COLOUR[b.tier] : C.text3
    ctx.font = font(20, 400, body)
    ctx.fillText(fit(ctx, b.tier ? `${b.tier[0].toUpperCase()}${b.tier.slice(1)} · ${b.progress}` : b.progress, cellW - 20), cx, cy + 116)
    ctx.globalAlpha = 1
  })

  // Best seasons
  ctx.fillStyle = C.text
  ctx.font = font(34)
  ctx.fillText('BEST SEASONS', W / 2, 1060)
  if (!input.best.length) {
    ctx.fillStyle = C.text3
    ctx.font = font(26, 400, body)
    ctx.fillText('Nothing yet. Spin the wheel.', W / 2, 1106)
  }
  input.best.slice(0, 3).forEach((s, i) => {
    const y = 1104 + i * 58
    ctx.fillStyle = C.text
    ctx.font = font(30)
    ctx.fillText(fit(ctx, s.title, W - 180), W / 2, y)
    ctx.fillStyle = C.text2
    ctx.font = font(20, 400, body)
    ctx.fillText(fit(ctx, s.detail, W - 180), W / 2, y + 24)
  })

  ctx.fillStyle = C.text3
  ctx.font = font(22, 400, body)
  ctx.fillText(input.dataStamp, W / 2, H - 70)
  ctx.fillStyle = C.good
  ctx.font = font(34)
  ctx.fillText('TOUCHLINE', W / 2, H - 28)
  return canvas.toDataURL('image/png')
}

/** Shorten a label until it fits `max` pixels in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

export function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  return exportDataUrl(dataUrl, filename)
}
