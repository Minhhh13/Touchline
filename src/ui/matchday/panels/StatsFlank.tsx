/** One side's stats beside the pitch, filling minute by minute; "View stats" opens the full table in slot B. */
import { statsAt } from '@engine/matchStats'
import { flankRows } from '../model'
import type { PanelProps } from '../types'

export function StatsFlank({ d, side }: PanelProps & { side: 'home' | 'away' }) {
  const at = statsAt(d.series, d.minute)
  const line = side === 'home' ? at.home : at.away
  const view = side === 'home' ? d.home : d.away
  return (
    <aside className={`md-flank ${side}`} aria-label={`${view.name} stats`}>
      <div className="md-flank-head" style={{ borderColor: view.colour }}>
        {view.code}
      </div>
      <dl>
        {flankRows(line).map((r) => (
          <div key={r.key} className="md-flank-row" data-stat={r.key}>
            <dt>{r.label}</dt>
            <dd className="mono">{r.value}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="btn sm md-view-stats" onClick={() => d.show('B', 'match-stats')}>
        View stats
      </button>
    </aside>
  )
}
