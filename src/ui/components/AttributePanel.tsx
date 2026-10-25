import type { AttributeKey, PlayerSeason } from '@engine/types'
import { attributeColumns, type AttrRow } from '@game/logic/playerCard'
import { Bar } from './bits'

/**
 * Football Manager-style attributes in three even columns (Technical, Physical, Mental). Every row
 * is the same grid, label | bar | value, so every bar track starts and ends at the same x: numbers,
 * the hidden traits' words and the injury risk all sit in the one value cell.
 */
export function AttributePanel({ p }: { p: PlayerSeason }) {
  const cols = attributeColumns(p)
  return (
    <div className="attr-panel" data-testid="attribute-panel">
      {cols.map((c) => (
        <section key={c.title} className="attr-group">
          <h4>{c.title}</h4>
          {c.rows.map((r) => (
            <Row key={r.key} r={r} />
          ))}
          {c.rows.map((r) =>
            r.kind === 'risk' ? (
              <p key="note" className="attr-note" data-testid="injury-note">
                Injury risk {r.level}/5: {r.note}
              </p>
            ) : null,
          )}
        </section>
      ))}
    </div>
  )
}

function band(v: number): string {
  return v >= 80 ? 'var(--good)' : v >= 65 ? 'var(--meter-mid)' : 'var(--text-3)'
}

function Row({ r }: { r: AttrRow }) {
  if (r.kind === 'attr')
    return (
      <div className="attr-row">
        <span className="attr-label">{r.label}</span>
        <Bar value={r.value} colour={band(r.value)} />
        <span className="attr-value mono">{r.value}</span>
      </div>
    )
  if (r.kind === 'trait')
    // Hidden traits are a bar and a word, never a number
    return (
      <div className="attr-row" title={`${r.label}: ${r.word === 'Avg' ? 'average' : r.word.toLowerCase()} (a hidden trait)`}>
        <span className="attr-label">{r.label}</span>
        <Bar value={Math.round(r.value * 100)} colour={r.word === 'High' ? 'var(--good)' : r.word === 'Avg' ? 'var(--meter-mid)' : 'var(--text-3)'} />
        <span className="attr-value">
          <span className={`attr-badge ${r.word === 'High' ? 'good' : r.word === 'Low' ? 'low' : ''}`}>{r.word}</span>
        </span>
      </div>
    )
  return (
    <div className="attr-row" title={`Injury risk ${r.level} of 5: ${r.note}`}>
      <span className="attr-label">{r.label}</span>
      <Bar value={r.level * 20} colour={r.level >= 4 ? 'var(--bad)' : r.level === 3 ? 'var(--meter-mid)' : 'var(--good)'} />
      <span className="attr-value" data-testid="injury-risk" data-level={r.level}>
        <span className={`attr-badge ${r.level >= 4 ? 'bad' : r.level <= 2 ? 'good' : ''}`}>{r.word}</span>
      </span>
    </div>
  )
}

/** Attribute keys a squad list can show as an extra column. */
export const SQUAD_COLUMNS: Array<{ key: AttributeKey; label: string; short: string }> = [{ key: 'stamina', label: 'Stamina', short: 'Sta' }]
