/**
 * Render a shareable PNG of a season result on a canvas: tier, record, the XI
 * on a pitch and the TouchLine lockup. Returns a data URL. The card is always
 * drawn in the Floodlit colours (brand.ts), whatever the viewer's theme.
 */
import type { Formation, PlayerSeason, TableRow } from '@engine/types'
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

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
