/** Small form read-outs for squad rows: the form arrow, the last-five sparkline and the player-of-the-match star. */
import { Star } from 'lucide-react'
import type { SquadPlayer } from '@engine/types'
import { formTitle, formTrend, sparkPoints } from '@game/logic/squadDisplay'

const ARROW = { up: '▲', flat: '▶', down: '▼' } as const

/** ▲, ▶ or ▼: the last three ratings against the season average (nothing before his third rating). */
export function FormArrow({ s }: { s: Pick<SquadPlayer, 'recentRatings' | 'seasonStats'> }) {
  const t = formTrend(s)
  if (!t) return null
  const title = formTitle(t)
  return (
    <span className={`form-arrow ${t.dir}`} title={title} role="img" aria-label={title} data-testid="form-arrow" data-dir={t.dir}>
      {ARROW[t.dir]}
    </span>
  )
}

/** The last five match ratings as a 40 by 14 line, the dots coloured by band, on a fixed 5 to 9 scale. */
export function Sparkline({ ratings, w = 40, h = 14 }: { ratings: number[]; w?: number; h?: number }) {
  const pts = sparkPoints(ratings, w, h)
  if (pts.length < 2) return null
  const label = `Last ${pts.length} ratings: ${pts.map((p) => p.r.toFixed(1)).join(', ')}`
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" className="spark-line" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 2 : 1.5} className={`spark-dot ${p.band}`} />
      ))}
    </svg>
  )
}

/** A small gold star with his player-of-the-match count this season. */
export function MotmStar({ count }: { count: number }) {
  if (count <= 0) return null
  const title = `Player of the match ${count} time${count === 1 ? '' : 's'} this season`
  return (
    <span className="chip gold icon-chip motm-chip" title={title} role="img" aria-label={title} data-testid="motm-star">
      <Star size={11} aria-hidden="true" /> {count}
    </span>
  )
}
