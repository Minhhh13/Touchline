/**
 * The xG graph story: each side's expected goals as a step line, one step per
 * attempt, a marker on every goal, filling to the clock. Shared by the live
 * dashboard and the report (`data-testid=xg-race`).
 */
import { useEffect, useRef, useState } from 'react'
import type { XgStep } from '@engine/matchStats'
import { scoreAt } from '@engine/matchFeed'
import type { MatchEvent } from '@engine/types'
import { minuteLabel } from '../../format'
import { xgStepPoints } from '../model'
import { Swatch } from './bits'
import { lineTone } from '../../match/charts'

export interface XgStoryProps {
  story: { home: XgStep[]; away: XgStep[] }
  events: MatchEvent[]
  minute: number
  /** The axis's last minute (the whistle, or 95 until it is known). */
  span: number
  home: { code: string; colour: string }
  away: { code: string; colour: string }
  /** Smaller type and no footer, for the phone's pulse row. */
  dense?: boolean
  /** In a slot whose header already names it: no title in the chart. */
  bare?: boolean
  /** Drawn at the size of the box the stylesheet gives it, one unit a pixel (the dashboard's widget row), so its type stays legible however short the slot. */
  fill?: boolean
}

export function XgStory({ story, events, minute, span, home, away, dense = false, bare = false, fill = false }: XgStoryProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = svgRef.current
    if (!fill || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w > 80 && h > 40) setBox((b) => (b && b.w === w && b.h === h ? b : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])
  const W = fill && box ? box.w : 300
  const H = fill && box ? box.h : dense ? 100 : 150
  const px = 24
  const py = 8
  const pw = W - px - 8
  const ph = H - py - 16
  const upto = Math.max(0, Math.min(span, minute))
  const hp = xgStepPoints(story.home, upto)
  const ap = xgStepPoints(story.away, upto)
  const hNow = hp.length ? hp[hp.length - 1][1] : 0
  const aNow = ap.length ? ap[ap.length - 1][1] : 0
  // The axis grows with the bigger total so far, never with what is still to come
  const yMax = Math.max(0.5, Math.ceil(Math.max(hNow, aNow) * 2) / 2)
  const X = (m: number) => px + (Math.min(m, span) / span) * pw
  const Y = (v: number) => py + ph - (v / yMax) * ph
  const pts = (p: Array<[number, number]>) => p.map(([m, v]) => `${X(m).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const goals = [...story.home, ...story.away].filter((s) => s.goal && s.minute <= upto)
  const score = scoreAt(events, upto)
  const homeTone = lineTone(home.colour)
  const awayTone = lineTone(away.colour)
  return (
    <div className={`mchart md-xg ${dense ? 'dense' : ''}`} data-testid="xg-race">
      <div className="row between small">
        <span className="row" style={{ gap: 6 }}>
          <Swatch colour={home.colour} />
          {home.code} <b className="mono">{hNow.toFixed(2)}</b>
        </span>
        {!bare && <span className="muted">xG graph story</span>}
        <span className="row" style={{ gap: 6 }}>
          <b className="mono">{aNow.toFixed(2)}</b> {away.code}
          <Swatch colour={away.colour} />
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Expected goals: ${home.code} ${hNow.toFixed(2)}, ${away.code} ${aNow.toFixed(2)}`}>
        {[0, yMax / 2, yMax].map((t) => (
          <g key={t}>
            <line x1={px} y1={Y(t)} x2={px + pw} y2={Y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={px - 4} y={Y(t) + 3} fontSize="9" textAnchor="end" fill="var(--text-3)">
              {String(+t.toFixed(2))}
            </text>
          </g>
        ))}
        <line x1={X(45)} y1={py} x2={X(45)} y2={py + ph} stroke="var(--line-2)" strokeDasharray="2 2" />
        {[0, 45, 90].map((m) => (
          <text key={m} x={X(m)} y={H - 4} fontSize="9" textAnchor={m === 0 ? 'start' : 'middle'} fill="var(--text-3)">
            {m === 0 ? "0'" : m === 45 ? 'HT' : 'FT'}
          </text>
        ))}
        {/* The home line first: its points are the ones the smokes count. A kit too close to the panel's colour gets a casing under its line, in the theme that needs it (lineTone) */}
        {homeTone && <polyline className="line-casing" data-tone={homeTone} data-testid="xg-casing" points={pts(hp)} fill="none" strokeWidth="4.2" strokeLinejoin="round" />}
        {awayTone && <polyline className="line-casing" data-tone={awayTone} data-testid="xg-casing" points={pts(ap)} fill="none" strokeWidth="4.2" strokeLinejoin="round" />}
        <polyline points={pts(hp)} fill="none" stroke={home.colour} strokeWidth="2.2" strokeLinejoin="round" />
        <polyline points={pts(ap)} fill="none" stroke={away.colour} strokeWidth="2.2" strokeLinejoin="round" />
        <polyline points={pts(hp)} fill="none" stroke="var(--text)" strokeWidth="0.6" strokeLinejoin="round" opacity="0.35" />
        <polyline points={pts(ap)} fill="none" stroke="var(--text)" strokeWidth="0.6" strokeLinejoin="round" opacity="0.35" />
        {goals.map((g, i) => (
          <g key={i}>
            <circle cx={X(g.minute)} cy={Y(g.cumulative)} r="3.6" fill={g.side === 'home' ? home.colour : away.colour} stroke="var(--panel)" strokeWidth="1.5" />
            <title>{`${minuteLabel(g.minute)} ${g.playerName ?? 'Goal'} (${g.xg.toFixed(2)} xG)`}</title>
          </g>
        ))}
      </svg>
      {!dense && (
        <div className="small muted md-xg-foot">
          Goals {score.home}-{score.away} · xG {hNow.toFixed(2)}-{aNow.toFixed(2)}
        </div>
      )}
    </div>
  )
}
