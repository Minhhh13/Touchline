import type { AttributeKey, PlayerSeason } from '@engine/types'
import type { MaskedView } from '@game/logic/scouting'
import { attributeColumns, type AttrRow } from '@game/logic/playerCard'
import { Bar } from './bits'
import { translator } from '../i18n'
import { explore } from '../i18n/en/explore'

const t = translator(explore)

/**
 * Football Manager-style attributes in three even columns (Technical, Physical, Mental). Every row
 * is the same grid, label | bar | value, so every bar track starts and ends at the same x: numbers,
 * the hidden traits' words and the injury risk all sit in the one value cell. With a masked `view`
 * (a player the club has not scouted) each attribute is a range and the hidden traits and the
 * injury risk read "Unknown" until he is scouted.
 */
export function AttributePanel({ p, view }: { p: PlayerSeason; view?: MaskedView }) {
  const cols = attributeColumns(p)
  const masked = !!view && !view.exact
  const hidden = masked && !view!.scouted
  return (
    <div className="attr-panel" data-testid="attribute-panel">
      {cols.map((c) => (
        <section key={c.title} className="attr-group">
          <h4>{c.title}</h4>
          {c.rows.map((r) => (
            <Row key={r.key} r={r} range={masked && r.kind === 'attr' ? view!.attrs[r.key as AttributeKey] : undefined} unknown={hidden && r.kind !== 'attr'} />
          ))}
          {c.rows.map((r) =>
            r.kind === 'risk' && !hidden ? (
              <p key="note" className="attr-note" data-testid="injury-note">
                {t('injuryNote', { level: r.level, note: r.note })}
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

function Row({ r, range, unknown }: { r: AttrRow; range?: { lo: number; hi: number }; unknown?: boolean }) {
  if (unknown)
    // A hidden trait or the injury risk before the scout has watched him
    return (
      <div className="attr-row" title={t('scoutToFind', { label: r.label })}>
        <span className="attr-label">{r.label}</span>
        <span className="bar" />
        <span className="attr-value">
          <span className="attr-badge low">{t('unknown')}</span>
        </span>
      </div>
    )
  if (range)
    // An attribute the club can only see as a range: the bar spans it, the figure reads "62–70"
    return (
      <div className="attr-row" title={t('rangeTip', { label: r.label, lo: range.lo, hi: range.hi })}>
        <span className="attr-label">{r.label}</span>
        <span className="bar range-bar">
          <span className="range-span" style={{ left: `${range.lo}%`, width: `${Math.max(2, range.hi - range.lo)}%`, background: band((range.lo + range.hi) / 2) }} />
        </span>
        <span className="attr-value mono range-value">
          {range.lo}–{range.hi}
        </span>
      </div>
    )
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
      <div className="attr-row" title={t('traitTip', { label: r.label, word: r.word === 'Avg' ? t('average') : r.word.toLowerCase() })}>
        <span className="attr-label">{r.label}</span>
        <Bar value={Math.round(r.value * 100)} colour={r.word === 'High' ? 'var(--good)' : r.word === 'Avg' ? 'var(--meter-mid)' : 'var(--text-3)'} />
        <span className="attr-value">
          <span className={`attr-badge ${r.word === 'High' ? 'good' : r.word === 'Low' ? 'low' : ''}`}>{r.word}</span>
        </span>
      </div>
    )
  return (
    <div className="attr-row" title={t('riskTip', { level: r.level, note: r.note })}>
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
