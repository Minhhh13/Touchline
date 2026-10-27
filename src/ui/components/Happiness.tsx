import type { SquadPlayer } from '@engine/types'
import { happinessOf } from '@game/logic/happiness'
import { meterValue, moraleWord } from '../format'
import { Info } from './bits'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

/** A morale value as a chip class: good from 70, warn under 55, bad under 40. */
export function moraleClass(m: number): string {
  return m >= 70 ? 'good' : m < 40 ? 'bad' : m < 55 ? 'warn' : ''
}

/** A signed change, one decimal at most: "+4.2", "−3". */
export function signed(d: number): string {
  const v = Math.round(d * 10) / 10
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`
}

/** The player modal's Happiness card: why his morale moved, newest first. */
export function HappinessCard({ s }: { s: SquadPlayer }) {
  const h = happinessOf(s)
  return (
    <div className="card happiness" data-testid="happiness">
      <div className="row between wrap" style={{ gap: 'var(--space-2)' }}>
        <span className="head-title">
          <b>{t('happiness')}</b>
          <Info label={t('aboutHappiness')}>{t('happinessCardInfo')}</Info>
        </span>
        <span className={`chip ${moraleClass(h.morale)}`}>
          {moraleWord(h.morale)} · {meterValue(h.morale)}
        </span>
      </div>
      {h.lines.length === 0 ? (
        <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{t('nothingMoved')}</div>
      ) : (
        <ul className="mood-lines">
          {h.lines.map((l, i) => (
            <li key={i}>
              <span className="mw">{l.week ? t('mwShort', { week: l.week }) : t('pre')}</span>
              <span className="why">{l.text}</span>
              <span className={`delta ${l.delta > 0 ? 'up' : 'down'}`}>{signed(l.delta)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
