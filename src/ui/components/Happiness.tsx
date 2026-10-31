import type { ReactNode } from 'react'
import type { SquadPlayer } from '@engine/types'
import type { OfficePromise } from '@game/types'
import { happinessOf } from '@game/logic/happiness'
import { promiseLineKind } from '@game/logic/officeView'
import { meterValue, moraleWord } from '../format'
import { Info } from './bits'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'
import { office } from '../i18n/en/office'

const t = translator(dugout)
const tOffice = translator(office)

/** A morale value as a chip class: good from 70, warn under 55, bad under 40. */
export function moraleClass(m: number): string {
  return m >= 70 ? 'good' : m < 40 ? 'bad' : m < 55 ? 'warn' : ''
}

/** A signed change, one decimal at most: "+4.2", "−3". */
export function signed(d: number): string {
  const v = Math.round(d * 10) / 10
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`
}

/**
 * The player modal's Happiness card: why his morale moved, newest first. With the office's `promises` to him, a
 * promise kept or broken says what was promised; `extra` goes under the lines (the promises still running).
 */
export function HappinessCard({ s, promises, extra }: { s: SquadPlayer; promises?: OfficePromise[]; extra?: ReactNode }) {
  const h = happinessOf(s)
  // The lines are the log newest first, one for one
  const entries = [...(s.moraleLog ?? [])].reverse()
  const lineText = (i: number, text: string): string => {
    const e = entries[i]
    if (!promises?.length || e?.r !== 'promise') return text
    const kind = promiseLineKind(promises, e.w, e.n === 'kept')
    return kind ? tOffice(e.n === 'kept' ? 'happyKept' : 'happyBroken', { what: tOffice(`promiseKind_${kind}`) }) : text
  }
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
              <span className="why">{lineText(i, l.text)}</span>
              <span className={`delta ${l.delta > 0 ? 'up' : 'down'}`}>{signed(l.delta)}</span>
            </li>
          ))}
        </ul>
      )}
      {extra}
    </div>
  )
}
