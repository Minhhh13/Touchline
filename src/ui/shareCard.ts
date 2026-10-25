/**
 * Render a shareable PNG of a season result on a canvas: tier, record, the XI
 * on a pitch and a footer. Returns a data URL.
 */
import type { Formation, MatchEvent, PlayerSeason, TableRow } from '@engine/types'
import { TIER_LABEL } from '@engine/season'
import type { SeasonTier } from '@engine/types'
import type { BadgeState, BadgeTier } from '@engine/badges'
import type { Cabinet } from '@game/types'

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
}

const STRIP_COLOUR: Record<'W' | 'D' | 'L', string> = { W: '#3ddc84', D: '#cfd8d2', L: '#ef5350' }

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

  ctx.fillStyle = input.banner?.colour ?? TIER_COLOUR[input.tier] ?? '#eef5f0'
  ctx.font = font(84)
  ctx.fillText(fit(ctx, input.banner?.text ?? TIER_LABEL[input.tier], W - 120), W / 2, 225)

  // The record, or the caller's own lines in its place; `y` is the baseline of the last thing drawn
  let y = 350
  const lines = (input.lines ?? []).slice(0, 6)
  if (lines.length) {
    ctx.fillStyle = '#eef5f0'
    ctx.font = font(34)
    lines.forEach((l, i) => ctx.fillText(fit(ctx, l, W - 160), W / 2, 295 + i * 44))
    y = 295 + (lines.length - 1) * 44
  } else {
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
  }

  // Season Story: the game-by-game strip and the moment line
  const strip = (input.strip ?? []).slice(0, 46)
  if (strip.length) {
    const sw = W - 180
    const gapX = 4
    const cell = Math.min(22, (sw - gapX * (strip.length - 1)) / strip.length)
    let sx = W / 2 - (cell * strip.length + gapX * (strip.length - 1)) / 2
    for (const o of strip) {
      ctx.fillStyle = STRIP_COLOUR[o]
      ctx.fillRect(sx, y + 22, cell, 22)
      sx += cell + gapX
    }
    y += 44
  }
  if (input.moment) {
    ctx.fillStyle = '#eef5f0'
    ctx.font = font(30, 600, "'Inter', system-ui, sans-serif")
    ctx.fillText(fit(ctx, input.moment, W - 160), W / 2, y + 46)
    y += 46
  }

  // pitch, pushed down (and shortened) by whatever sits above it
  const px = 90
  const py = Math.max(400, y + 34)
  const pw = W - 180
  const ph = 1160 - py
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
  g.addColorStop(0, '#132019')
  g.addColorStop(1, '#0b1410')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const font = (size: number, weight = 700, family = "'Barlow Condensed', 'Arial Narrow', Impact, sans-serif") => `${weight} ${size}px ${family}`
  const body = "'Inter', system-ui, sans-serif"

  ctx.textAlign = 'center'
  ctx.fillStyle = '#b4c6ba'
  ctx.font = font(26, 400, body)
  ctx.fillText(input.subtitle, W / 2, 70)
  ctx.fillStyle = '#eef5f0'
  ctx.font = font(40)
  ctx.fillText(input.title.toUpperCase(), W / 2, 118)

  // Score: names either side, the colours as bars under them
  ctx.font = font(150)
  ctx.fillText(`${input.home.goals} - ${input.away.goals}`, W / 2, 290)
  ctx.font = font(40)
  ctx.textAlign = 'right'
  ctx.fillText(fit(ctx, input.home.name.toUpperCase(), 300), 330, 240)
  ctx.textAlign = 'left'
  ctx.fillText(fit(ctx, input.away.name.toUpperCase(), 300), W - 330, 240)
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
  ctx.fillStyle = '#1d7a3f'
  ctx.fillRect(px, py, pw, ph)
  ctx.fillStyle = '#1a6f39'
  for (let i = 0; i < 10; i += 2) ctx.fillRect(px + (pw / 10) * i, py, pw / 10, ph)
  ctx.restore()
  const sx = (x: number) => px + (x / 100) * pw
  const sy = (y: number) => py + (y / 100) * ph
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
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
  ctx.fillStyle = '#b4c6ba'
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
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 2
  ctx.fillStyle = '#7f9587'
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
  ctx.fillStyle = '#eef5f0'
  ctx.fillText(`xG ${input.home.xg.toFixed(2)} - ${input.away.xg.toFixed(2)}`, cx, cy - 14)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#7f9587'
  ctx.font = font(22, 400, body)
  ctx.fillText(input.footer, W / 2, H - 80)
  ctx.fillStyle = '#3ddc84'
  ctx.font = font(34)
  ctx.fillText('TOUCHLINE', W / 2, H - 36)
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

const RING_COLOUR: Record<BadgeTier, string> = { bronze: '#cd8a4a', silver: '#c9d3d8', gold: '#f5c542' }

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
  g.addColorStop(0, '#132019')
  g.addColorStop(1, '#0b1410')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(245,197,66,0.07)'
  ctx.beginPath()
  ctx.arc(W / 2, -220, 700, 0, Math.PI * 2)
  ctx.fill()
  const font = (size: number, weight = 700, family = "'Barlow Condensed', 'Arial Narrow', Impact, sans-serif") => `${weight} ${size}px ${family}`
  const body = "'Inter', system-ui, sans-serif"

  ctx.textAlign = 'center'
  ctx.fillStyle = '#b4c6ba'
  ctx.font = font(26, 600, body)
  ctx.fillText('MANAGER CARD', W / 2, 70)
  ctx.fillStyle = '#eef5f0'
  ctx.font = font(84)
  ctx.fillText(fit(ctx, input.name.toUpperCase(), W - 140), W / 2, 160)
  ctx.fillStyle = '#b4c6ba'
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
    ctx.font = font(40, 400, body)
    ctx.fillText(icon, x + cellW / 2, y + 50)
    ctx.fillStyle = n ? '#f5c542' : '#eef5f0'
    ctx.font = font(56)
    ctx.fillText(String(n), x + cellW / 2, y + 108)
    ctx.fillStyle = '#b4c6ba'
    ctx.font = font(22, 400, body)
    ctx.fillText(label, x + cellW / 2, y + 138)
    ctx.globalAlpha = 1
  })

  // Badges with their tier rings, 3 by 2
  ctx.fillStyle = '#eef5f0'
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
    ctx.fillStyle = '#eef5f0'
    ctx.font = font(44, 400, body)
    ctx.fillText(b.badge.icon, cx, cy + 16)
    ctx.font = font(28)
    ctx.fillText(fit(ctx, b.badge.title, cellW - 20), cx, cy + 88)
    ctx.fillStyle = b.tier ? RING_COLOUR[b.tier] : '#7f9587'
    ctx.font = font(20, 400, body)
    ctx.fillText(fit(ctx, b.tier ? `${b.tier[0].toUpperCase()}${b.tier.slice(1)} · ${b.progress}` : b.progress, cellW - 20), cx, cy + 116)
    ctx.globalAlpha = 1
  })

  // Best seasons
  ctx.fillStyle = '#eef5f0'
  ctx.font = font(34)
  ctx.fillText('BEST SEASONS', W / 2, 1060)
  if (!input.best.length) {
    ctx.fillStyle = '#7f9587'
    ctx.font = font(26, 400, body)
    ctx.fillText('Nothing yet. Spin the wheel.', W / 2, 1106)
  }
  input.best.slice(0, 3).forEach((s, i) => {
    const y = 1104 + i * 58
    ctx.fillStyle = '#eef5f0'
    ctx.font = font(30)
    ctx.fillText(fit(ctx, s.title, W - 180), W / 2, y)
    ctx.fillStyle = '#b4c6ba'
    ctx.font = font(20, 400, body)
    ctx.fillText(fit(ctx, s.detail, W - 180), W / 2, y + 24)
  })

  ctx.fillStyle = '#7f9587'
  ctx.font = font(22, 400, body)
  ctx.fillText(input.dataStamp, W / 2, H - 70)
  ctx.fillStyle = '#3ddc84'
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

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
