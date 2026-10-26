import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { movement, zoneOf, type LiveRow } from '@game/logic/liveTable'
import { ClubBadge } from './bits'

/** Height of one live-table row in px: rows slide between places by this much (FLIP by transform). The stylesheet can
 * make the rows shorter (`--lt-row`, the season playback's compact rows on a short window); the default is this. */
const ROW_H = 26
/** A length of `n` rows, in the stylesheet's row height. */
const rows = (n: number) => `calc(${n} * var(--lt-row, ${ROW_H}px))`

/**
 * The live league table beside the playback: every club after the game shown, the user's row highlighted. Rows keep
 * one DOM order (by club) and are placed by a transform, so a change of place slides smoothly instead of jumping;
 * reduced motion and the 4x playback turn the slide off. Arrows show the move since the game before; zone tints and lines mark
 * the title, the top four, the top six and the bottom three.
 */
export function LiveTable({ table, before, userId, teamName, nameOf, slide = true }: { table: LiveRow[]; before: LiveRow[]; userId: string; teamName: string; nameOf: (teamId: string) => string; /** Off, rows jump to their new place (4x, where a slide would still be running when the next game lands). */ slide?: boolean }) {
  const teams = table.length
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const mine = table.findIndex((r) => r.teamId === userId)
  useEffect(() => {
    // Keep the user's row in view inside the table's own box (never the page): the box scrolls, the page does not
    const body = bodyRef.current
    const box = body?.closest('.fit-cell')
    if (!body || !box || mine < 0 || box.scrollHeight <= box.clientHeight) return
    const rowH = body.querySelector('.lt-row')?.getBoundingClientRect().height || ROW_H
    const top = body.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + mine * rowH
    if (top < box.scrollTop + rowH || top > box.scrollTop + box.clientHeight - 2 * rowH) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: 'smooth' })
  }, [mine])
  const byClub = [...table].sort((a, b) => a.teamId.localeCompare(b.teamId))
  const place = new Map(table.map((r, i) => [r.teamId, i]))
  const zones: Array<{ key: string; from: number; to: number }> = [
    { key: 'title', from: 0, to: 1 },
    { key: 'top4', from: 1, to: 4 },
    { key: 'top6', from: 4, to: 6 },
    { key: 'releg', from: teams - 3, to: teams },
  ]
  return (
    <div className={`live-table ${slide ? '' : 'no-slide'}`} style={{ ['--lt-n' as string]: String(teams) }} data-testid="live-table">
      <div className="lt-head small muted">
        <span>#</span>
        <span />
        <span>Club</span>
        <span className="num">P</span>
        <span className="num">GD</span>
        <span className="num">Pts</span>
      </div>
      <div className="lt-body" ref={bodyRef} style={{ height: rows(teams) }}>
        {zones.map((z) => (
          <div key={z.key} className={`lt-zone ${z.key}`} style={{ top: rows(z.from), height: rows(z.to - z.from) }} aria-hidden="true" />
        ))}
        {byClub.map((r) => {
          const i = place.get(r.teamId) ?? 0
          const move = movement(before, table, r.teamId)
          const gd = r.goalsFor - r.goalsAgainst
          const me = r.teamId === userId
          return (
            <div key={r.teamId} className={`lt-row ${me ? 'me' : ''} ${zoneOf(i + 1, teams) ?? ''}`} style={{ transform: `translateY(${rows(i)})` }} data-testid={me ? 'live-table-me' : 'live-table-row'} data-place={i + 1}>
              <span className="lt-pos">{i + 1}</span>
              <span className="lt-move" aria-label={move > 0 ? `Up ${move}` : move < 0 ? `Down ${-move}` : undefined}>
                {move > 0 ? <ArrowUp size={12} className="up" /> : move < 0 ? <ArrowDown size={12} className="down" /> : null}
              </span>
              <span className="lt-club">
                {!me && <ClubBadge clubId={r.teamId} size={16} />}
                <span className="lt-name">{me ? teamName : nameOf(r.teamId)}</span>
              </span>
              <span className="num">{r.played}</span>
              <span className="num">{gd > 0 ? `+${gd}` : gd}</span>
              <b className="num">{r.points}</b>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * League position by game: 1st at the top, last at the bottom, zone bands behind, the user's line thick and bright
 * (it draws itself on as each game lands; reduced motion shows it at once) and the leading rivals' lines faint.
 * `unit` names the x axis ("Game" on the playback, "MW" on the Dugout's Table tab); `target` draws the board's
 * expectation as a dashed line; `first` is the x label of the first point (a run-in starts after the takeover).
 * `fill` draws it to the proportions of the box the stylesheet gives it (the season playback, where it gives way to the
 * bench), so a short wide box gets a short wide chart rather than a small one with empty sides.
 */
export function PositionChart({ series, rivals, teams, games, unit = 'Game', target, first = 1, title = 'League position by game', fill = false }: { series: number[]; rivals: Array<{ teamId: string; name: string; series: number[] }>; teams: number; games: number; unit?: string; target?: number; first?: number; title?: string; fill?: boolean }) {
  const W = 360
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [fillH, setFillH] = useState(220)
  useEffect(() => {
    const el = svgRef.current
    if (!fill || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setFillH(Math.round(Math.min(440, Math.max(90, (W * r.height) / r.width))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])
  const H = fill ? fillH : 220
  const x0 = 22
  const x1 = W - 8
  const y0 = 8
  const y1 = H - 18
  const x = (k: number) => x0 + ((x1 - x0) * k) / Math.max(1, games - 1)
  const y = (p: number) => y0 + ((y1 - y0) * (p - 1)) / Math.max(1, teams - 1)
  const path = (s: number[]) => s.map((p, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const band = (from: number, to: number) => ({ y: y(from) - (y1 - y0) / (teams - 1) / 2, h: ((y1 - y0) / (teams - 1)) * (to - from + 1) })
  const bands: Array<{ key: string; from: number; to: number }> = [
    { key: 'title', from: 1, to: 1 },
    { key: 'top4', from: 2, to: 4 },
    { key: 'top6', from: 5, to: 6 },
    { key: 'releg', from: teams - 2, to: teams },
  ]
  const last = series.length - 1
  // The axis's places, thinned on a short chart so no two labels touch (the last place always stays)
  const ticks = [1, 4, 6, teams - 3 + 1, teams].reduce<number[]>((kept, p) => {
    const prev = kept[kept.length - 1]
    if (prev === undefined || y(p) - y(prev) >= 9) return [...kept, p]
    return p === teams && prev !== 1 ? [...kept.slice(0, -1), p] : kept
  }, [])
  return (
    <div className="mchart pos-chart" data-testid="position-chart">
      <div className="row between small">
        <span className="muted">{title}</span>
        <span className="row small" style={{ gap: 10 }}>
          {rivals.map((r) => (
            <span key={r.teamId} className="pc-rival-key muted">
              {r.name}
            </span>
          ))}
        </span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={last >= 0 ? `Position after ${unit.toLowerCase()} ${last + first}: ${series[last]}` : title}>
        {bands.map((b) => {
          const r = band(b.from, b.to)
          return <rect key={b.key} className={`pc-band ${b.key}`} x={x0} y={r.y} width={x1 - x0} height={r.h} />
        })}
        {ticks.map((p) => (
          <text key={p} x={x0 - 6} y={y(p) + 3} fontSize="8" textAnchor="end" fill="var(--text-3)">
            {p}
          </text>
        ))}
        {target !== undefined && target >= 1 && target <= teams && (
          <g className="pc-target" data-testid="position-target">
            <line x1={x0} x2={x1} y1={y(target)} y2={y(target)} />
            <text x={x1} y={y(target) - 3} fontSize="8" textAnchor="end">
              Target {target}
            </text>
          </g>
        )}
        {rivals.map((r) => (r.series.length > 1 ? <path key={r.teamId} d={path(r.series)} className="pc-rival" fill="none" /> : null))}
        {series.length > 1 && <path key={series.length} d={path(series)} className="pc-user" fill="none" pathLength={1} style={{ ['--pc-from' as string]: String(1 / (series.length - 1)) }} />}
        {last >= 0 && <circle cx={x(last)} cy={y(series[last])} r="4" className="pc-dot" />}
        <text x={x0} y={H - 4} fontSize="8" fill="var(--text-3)">
          {unit} {first}
        </text>
        <text x={x1} y={H - 4} fontSize="8" textAnchor="end" fill="var(--text-3)">
          {games + first - 1}
        </text>
      </svg>
    </div>
  )
}
