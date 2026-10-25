/**
 * Render a shareable PNG of a season result on a canvas: tier, record, the XI
 * on a pitch and the TouchLine lockup. Returns a data URL. The card is always
 * drawn in the Floodlit colours (brand.ts), whatever the viewer's theme.
 */
import type { Formation, MatchEvent, PlayerSeason, TableRow } from '@engine/types'
import type { SeasonTier } from '@engine/types'
import { BALL_EDGE, BRAND_COLOURS as C, LOCKUP, MARK, WORDMARK, ballPanels, pennantPath } from './brand'
import { tierName } from './format'

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
}

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

const DISPLAY = "'Barlow Condensed', 'Arial Narrow', Impact, sans-serif"
const BODY = "'Inter', system-ui, sans-serif"

export function renderShareCard(input: ShareCardInput): string {
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
  ctx.font = font(54)
  ctx.fillText(input.title, W / 2, 92)
  ctx.fillStyle = C.text2
  ctx.font = font(26, 400, BODY)
  ctx.fillText(input.subtitle, W / 2, 134)

  ctx.fillStyle = TIER_COLOUR[input.tier] ?? C.text
  ctx.font = font(88)
  ctx.fillText(tierName(input.tier), W / 2, 232)

  // Record: wins, draws, defeats in the status colours
  const rec = [
    { t: `${input.row.won}W`, c: C.good },
    { t: `${input.row.drawn}D`, c: C.draw },
    { t: `${input.row.lost}L`, c: C.bad },
  ]
  ctx.font = font(60)
  const widths = rec.map((r) => ctx.measureText(r.t).width)
  const gap = 40
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * 2) / 2
  for (let i = 0; i < rec.length; i++) {
    ctx.fillStyle = rec[i].c
    ctx.textAlign = 'left'
    ctx.fillText(rec[i].t, x, 306)
    x += widths[i] + gap
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = C.text
  ctx.font = font(30, 600, BODY)
  const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 > 3 ? 0 : n % 10] ?? 'th')
  ctx.fillText(`${input.row.points} points · finished ${ord(input.position)}`, W / 2, 354)

  // The pitch: grass stays green, the frame and lines are neutral
  const px = 90
  const py = 396
  const pw = W - 180
  const ph = 740
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
    const cy = py + ((100 - slot.y) / 100) * ph
    ctx.fillStyle = C.pitchDisc
    ctx.beginPath()
    ctx.arc(cx, cy - 10, 34, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = p ? ratingColour(p.overall) : 'rgba(255, 255, 255, 0.4)'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = font(28)
    ctx.textAlign = 'center'
    ctx.fillText(p ? (input.hideRatings ? '?' : String(p.overall)) : slot.position, cx, cy)
    if (p) {
      ctx.font = font(21, 600, BODY)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
      ctx.shadowBlur = 4
      ctx.fillText(p.name, cx, cy + 48)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)'
      ctx.font = font(17, 400, BODY)
      ctx.fillText(`${p.season}-${String((p.season + 1) % 100).padStart(2, '0')}`, cx, cy + 70)
    }
  }

  ctx.fillStyle = C.text3
  ctx.font = font(22, 400, BODY)
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
  // The flag: the pennant with its fold (at rest), then the pole standing on the line
  ctx.save()
  ctx.scale(u, u)
  const P = LOCKUP.pennant
  const fold = ctx.createLinearGradient(P.x, 0, P.tipX, 0)
  for (const [o, c] of MARK.fold) fold.addColorStop(o, c)
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
 * right-hand goal, away at the left) and the xG race. Returns a data URL.
 */
export function renderMatchCard(input: MatchCardInput): string {
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
  ctx.font = font(26, 400, body)
  ctx.fillText(input.subtitle, W / 2, 70)
  ctx.fillStyle = C.text
  ctx.font = font(40)
  ctx.fillText(input.title, W / 2, 118)

  // Score: names either side, the colours as bars under them
  ctx.font = font(150)
  ctx.fillText(`${input.home.goals} - ${input.away.goals}`, W / 2, 290)
  ctx.font = font(40)
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
  ctx.font = font(22, 400, body)
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
  ctx.font = font(34)
  ctx.textAlign = 'left'
  ctx.fillStyle = C.text
  ctx.fillText(`xG ${input.home.xg.toFixed(2)} - ${input.away.xg.toFixed(2)}`, cx, cy - 14)

  ctx.textAlign = 'center'
  ctx.fillStyle = C.text3
  ctx.font = font(22, 400, body)
  ctx.fillText(input.footer, W / 2, H - 120)
  drawLockup(ctx, W / 2, H - 62, 48)
  return canvas.toDataURL('image/png')
}

/** Shorten a label until it fits `max` pixels in the current font. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
