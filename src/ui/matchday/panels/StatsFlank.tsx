/** One side's stats beside the pitch, filling minute by minute; "View stats" opens the full table in slot B. */
import { statsAt } from '@engine/matchStats'
import { flankRows, sinceMinute } from '../model'
import type { PanelProps } from '../types'

export function StatsFlank({ d, side }: PanelProps & { side: 'home' | 'away' }) {
  const at = statsAt(d.series, d.minute)
  const line = side === 'home' ? at.home : at.away
  const view = side === 'home' ? d.home : d.away
  // After our shout at 70: what each side has made of the last twenty minutes so far (honest feedback, from the decided feed)
  const shouted = !!d.userSide && !!d.feed[d.userSide].lateText
  const since = shouted ? sinceMinute(d.series, 70, d.minute) : null
  const mine = since ? (side === 'home' ? since.home : since.away) : null
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
      {mine && (
        <div className="md-since small muted" data-testid="since-shout" title="Since the 70th-minute shout: expected goals and shots for this side">
          Since 70': xG {mine.xg.toFixed(2)} · {mine.shots} shot{mine.shots === 1 ? '' : 's'}
        </div>
      )}
      <button type="button" className="btn sm md-view-stats" onClick={() => d.show('B', 'match-stats')}>
        View stats
      </button>
    </aside>
  )
}
