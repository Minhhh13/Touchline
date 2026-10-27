import type { LoadedUniverse } from '@engine/universe'
import type { Position } from '@engine/types'
import { POSITION_LABEL } from '@engine/positions'
import { formBand, seasonScale, type FormPoint, type MapSpot, type SeasonPoint } from '@game/logic/playerCard'
import { clubName } from '../format'

/**
 * The player card's small charts, drawn in SVG on the design tokens: the rating by season (a line
 * on a fixed scale with every season's number at its point), the position map and the form graph.
 */

const SW = 280
const SH = 122

/** Rating by season: one colour, direct labels, the peak in `--meter-mid`, estimated seasons dashed with hollow dots, a faint tick at each club change. */
export function SeasonChart({ points, u }: { points: SeasonPoint[]; u: LoadedUniverse }) {
  if (!points.length) return <p className="small muted pc-empty">No seasons in the data for this player.</p>
  const { min, max } = seasonScale(points)
  const L = 22
  const R = 12
  const T = 14
  const B = 18
  const n = points.length
  const x = (i: number) => (n === 1 ? (L + SW - R) / 2 : L + (i * (SW - L - R)) / (n - 1))
  const y = (v: number) => T + ((max - v) / (max - min)) * (SH - T - B)
  const grid: number[] = []
  for (let g = Math.ceil(min / 10) * 10; g <= 90; g += 10) grid.push(g)
  // Dense careers alternate the numbers above and below the line so they never overlap
  const dense = n > 12
  const step = Math.ceil(n / 6)
  return (
    <svg className="pc-chart" viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={`Rating by season: ${points.map((p) => `${p.label} ${p.overall}`).join(', ')}`} data-testid="season-chart" data-points={n}>
      {grid.map((g) => (
        <g key={g}>
          <line x1={L} x2={SW - R} y1={y(g)} y2={y(g)} className="pc-grid" />
          <text x={L - 4} y={y(g) + 3} className="pc-axis" textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        p.clubChange ? (
          <line key={`c${p.season}`} x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={T - 6} y2={SH - B} className="pc-club-tick">
            <title>{`Moved to ${clubName(u, p.clubId)}`}</title>
          </line>
        ) : null,
      )}
      {points.slice(1).map((p, i) => (
        <line key={`s${p.season}`} x1={x(i)} y1={y(points[i].overall)} x2={x(i + 1)} y2={y(p.overall)} className={`pc-line ${p.estimated || points[i].estimated ? 'est' : ''}`} />
      ))}
      {points.map((p, i) => {
        const below = dense && i % 2 === 1 && y(p.overall) + 12 < SH - B
        return (
          <g key={p.season}>
            <circle cx={x(i)} cy={y(p.overall)} r={p.peak ? 3.6 : 2.6} className={`pc-dot ${p.peak ? 'peak' : ''} ${p.estimated ? 'est' : ''}`}>
              <title>{`${p.label} · ${clubName(u, p.clubId)} · ${p.overall}${p.estimated ? ' · estimated' : ''}${p.peak ? ' · peak' : ''}`}</title>
            </circle>
            <text x={x(i)} y={below ? y(p.overall) + 12 : y(p.overall) - 6} className={`pc-chart-val ${p.peak ? 'peak' : ''}`} textAnchor="middle">
              {p.overall}
            </text>
            {(i === n - 1 || (i % step === 0 && n - 1 - i >= step)) && (
              <text x={x(i)} y={SH - 4} className="pc-axis" textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                {p.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Where each position sits on a small pitch, attacking to the right (left-sided players at the top). */
const SPOT: Record<Position, [number, number]> = {
  GK: [7, 32],
  CB: [24, 32],
  LB: [29, 11],
  RB: [29, 53],
  DM: [42, 32],
  CM: [55, 32],
  AM: [68, 32],
  LW: [79, 11],
  RW: [79, 53],
  ST: [88, 32],
}

const FIT_WORD: Record<MapSpot['fit'], string> = { natural: 'natural', cover: 'can cover', awkward: 'awkward', unsuited: 'unsuited' }

/** FM's position map: natural positions bright, cover dim, the rest faint, each with his rating there. */
export function PositionMap({ spots }: { spots: MapSpot[] }) {
  return (
    <svg className="pc-map" viewBox="0 0 100 64" role="img" aria-label={`Positions: ${spots.filter((s) => s.fit === 'natural' || s.fit === 'cover').map((s) => `${s.pos} ${s.rating} ${FIT_WORD[s.fit]}`).join(', ')}`} data-testid="position-map">
      <rect x="0.5" y="0.5" width="99" height="63" rx="2" className="pc-pitch" />
      <line x1="50" y1="0.5" x2="50" y2="63.5" className="pc-pitch-line" />
      <circle cx="50" cy="32" r="8" className="pc-pitch-line" />
      <rect x="0.5" y="16" width="13" height="32" className="pc-pitch-line" />
      <rect x="86.5" y="16" width="13" height="32" className="pc-pitch-line" />
      {spots.map((s) => {
        const [cx, cy] = SPOT[s.pos]
        const strong = s.fit === 'natural' || s.fit === 'cover'
        return (
          <g key={s.pos} className={`pc-spot ${s.fit}`} data-fit={s.fit} data-pos={s.pos}>
            <title>{`${POSITION_LABEL[s.pos]}: ${FIT_WORD[s.fit]}, ${s.rating}`}</title>
            <circle cx={cx} cy={cy} r={strong ? 5 : 3.4} />
            <text x={cx} y={cy + 1.5} textAnchor="middle" className="pc-spot-val">
              {s.rating}
            </text>
            <text x={cx} y={cy + (strong ? 9.6 : 7.8)} textAnchor="middle" className="pc-spot-pos">
              {s.pos}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

const FW = 280
const FH = 66

/** The last match ratings (the save keeps six) on a fixed 4 to 10 scale, dots by band, the season average dashed, the last one printed. */
export function FormGraph({ points, avg }: { points: FormPoint[]; avg: number | null }) {
  if (!points.length) return <p className="small muted pc-empty">No games yet.</p>
  const L = 16
  const R = 30
  const T = 8
  const B = 8
  const lo = 4
  const hi = 10
  const n = points.length
  const x = (i: number) => (n === 1 ? (L + FW - R) / 2 : L + (i * (FW - L - R)) / (n - 1))
  const y = (v: number) => T + ((hi - Math.max(lo, Math.min(hi, v))) / (hi - lo)) * (FH - T - B)
  const last = points[n - 1]
  return (
    <svg className="pc-form" viewBox={`0 0 ${FW} ${FH}`} role="img" aria-label={`Last ${n} ratings: ${points.map((p) => p.rating.toFixed(1)).join(', ')}`} data-testid="form-graph">
      {[6, 8].map((g) => (
        <g key={g}>
          <line x1={L} x2={FW - R} y1={y(g)} y2={y(g)} className="pc-grid" />
          <text x={L - 4} y={y(g) + 3} className="pc-axis" textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      {avg !== null && <line x1={L} x2={FW - R} y1={y(avg)} y2={y(avg)} className="pc-avg"><title>Season average {avg.toFixed(2)}</title></line>}
      {points.slice(1).map((p, i) => (
        <line key={i} x1={x(i)} y1={y(points[i].rating)} x2={x(i + 1)} y2={y(p.rating)} className="pc-line" />
      ))}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.rating)} r="3" className={`pc-form-dot ${p.band}`}>
          <title>{p.rating.toFixed(1)}</title>
        </circle>
      ))}
      <text x={x(n - 1) + 7} y={y(last.rating) + 3.5} className={`pc-form-last ${formBand(last.rating)}`}>
        {last.rating.toFixed(1)}
      </text>
    </svg>
  )
}

/** Form as coloured pills, oldest to newest. */
export function FormPills({ ratings }: { ratings: number[] }) {
  if (!ratings.length) return null
  return (
    <span className="form-pills" data-testid="form-pills">
      {ratings.map((r, i) => (
        <span key={i} className={`form-pill ${formBand(r)}`}>
          {r.toFixed(1)}
        </span>
      ))}
    </span>
  )
}
