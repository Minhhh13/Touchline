/**
 * Render a shareable PNG of a season result on a canvas: tier, record, the XI
 * on a pitch and a footer. Returns a data URL.
 */
import type { Formation, PlayerSeason, TableRow } from '@engine/types'
import { TIER_LABEL } from '@engine/season'
import type { SeasonTier } from '@engine/types'

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
  PERFECT: '#f5c542',
  INVINCIBLE: '#f5c542',
  CHAMPIONS: '#f5c542',
  TITLE_RACE: '#3ddc84',
  EUROPEAN: '#3ddc84',
  MID_TABLE: '#cfd8d2',
  RELEGATION_BATTLE: '#f08a3c',
  RELEGATED: '#ef5350',
}

function ratingColour(v: number): string {
  if (v >= 85) return '#f5c542'
  if (v >= 80) return '#3ddc84'
  if (v >= 75) return '#5fd0b2'
  if (v >= 70) return '#8ab4c0'
  return '#9aa8a0'
}

export function renderShareCard(input: ShareCardInput): string {
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  // background
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#132019')
  g.addColorStop(1, '#0b1410')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(61,220,132,0.08)'
  ctx.beginPath()
  ctx.arc(W / 2, -200, 700, 0, Math.PI * 2)
  ctx.fill()

  const font = (size: number, weight = 700, family = "'Barlow Condensed', 'Arial Narrow', Impact, sans-serif") => `${weight} ${size}px ${family}`
  ctx.textAlign = 'center'
  ctx.fillStyle = '#eef5f0'
  ctx.font = font(44)
  ctx.fillText(input.title.toUpperCase(), W / 2, 90)
  ctx.fillStyle = '#b4c6ba'
  ctx.font = font(26, 400, "'Inter', system-ui, sans-serif")
  ctx.fillText(input.subtitle, W / 2, 130)

  ctx.fillStyle = TIER_COLOUR[input.tier] ?? '#eef5f0'
  ctx.font = font(84)
  ctx.fillText(TIER_LABEL[input.tier], W / 2, 225)

  // record
  const rec = [
    { t: `${input.row.won}W`, c: '#3ddc84' },
    { t: `${input.row.drawn}D`, c: '#cfd8d2' },
    { t: `${input.row.lost}L`, c: '#ef5350' },
  ]
  ctx.font = font(60)
  const widths = rec.map((r) => ctx.measureText(r.t).width)
  const gap = 40
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * 2) / 2
  for (let i = 0; i < rec.length; i++) {
    ctx.fillStyle = rec[i].c
    ctx.textAlign = 'left'
    ctx.fillText(rec[i].t, x, 300)
    x += widths[i] + gap
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = '#eef5f0'
  ctx.font = font(34)
  const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 > 3 ? 0 : n % 10] ?? 'th')
  ctx.fillText(`${input.row.points} points · finished ${ord(input.position)}`, W / 2, 350)

  // pitch
  const px = 90
  const py = 400
  const pw = W - 180
  const ph = 760
  ctx.fillStyle = '#1d7a3f'
  roundRect(ctx, px, py, pw, ph, 18)
  ctx.fill()
  ctx.fillStyle = '#1a6f39'
  for (let i = 0; i < 8; i += 2) {
    ctx.fillRect(px, py + (ph / 8) * i, pw, ph / 8)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
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
    ctx.fillStyle = 'rgba(8,20,14,0.9)'
    ctx.beginPath()
    ctx.arc(cx, cy - 10, 34, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = p ? ratingColour(p.overall) : 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = font(28)
    ctx.textAlign = 'center'
    ctx.fillText(p ? (input.hideRatings ? '?' : String(p.overall)) : slot.position, cx, cy)
    if (p) {
      ctx.font = font(21, 600, "'Inter', system-ui, sans-serif")
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur = 4
      ctx.fillText(p.name, cx, cy + 48)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = font(17, 400, "'Inter', system-ui, sans-serif")
      ctx.fillText(`${p.season}-${String((p.season + 1) % 100).padStart(2, '0')}`, cx, cy + 70)
    }
  }

  ctx.fillStyle = '#7f9587'
  ctx.font = font(22, 400, "'Inter', system-ui, sans-serif")
  ctx.fillText(input.footer, W / 2, H - 100)
  ctx.fillStyle = '#3ddc84'
  ctx.font = font(34)
  ctx.fillText('TOUCHLINE', W / 2, H - 50)
  return canvas.toDataURL('image/png')
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
