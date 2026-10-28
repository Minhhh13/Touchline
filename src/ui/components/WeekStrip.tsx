import { useMemo } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '@game/types'
import { weekChanges } from '@game/logic/seasonPlay'
import { clubShort, ordinal, outcomeClass, outcomeOf } from '../format'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

/**
 * The Dugout's "last week" strip (r8): the result, the league position before and after, the week's injuries and bans,
 * and its cup lines, read from the season by `weekChanges`. Display only; the Inbox button opens the week's news.
 */
export function WeekStrip({ game, u, onInbox }: { game: Game; u: LoadedUniverse; onInbox: () => void }) {
  const w = useMemo(() => weekChanges(game), [game])
  if (!w) return null
  const o = w.result ? outcomeOf(w.result.gf, w.result.ga) : null
  const moved = w.positionFrom ? w.positionFrom - w.positionTo : 0
  return (
    <div className="club-sub week-strip" data-testid="week-strip" role="group" aria-label={t('lastWeekLabel', { week: w.matchweek })}>
      <span className="small muted">{t('lastWeek')}</span>
      {w.result && o ? (
        <span className={`chip ${outcomeClass(o)}`} data-testid="week-result">
          {t('weekResult', { o, gf: w.result.gf, ga: w.result.ga, home: w.result.home ? 'home' : 'away', club: clubShort(u, w.result.opponentId) })}
        </span>
      ) : (
        <span className="chip">{t('weekFree')}</span>
      )}
      <span className="chip" data-testid="week-position">{moved ? t('weekMoved', { dir: moved > 0 ? 'up' : 'down', n: Math.abs(moved), pos: ordinal(w.positionTo) }) : t('weekStayed', { pos: ordinal(w.positionTo) })}</span>
      {w.injuries > 0 && <span className="chip warn">{t('weekInjuries', { n: w.injuries })}</span>}
      {w.suspensions > 0 && <span className="chip warn">{t('weekBans', { n: w.suspensions })}</span>}
      {w.cup.slice(-2).map((line) => (
        <span key={line} className="chip">{line}</span>
      ))}
      {w.posted > 0 && (
        <button type="button" className="chip-btn" onClick={onInbox} data-testid="week-inbox">
          {t('weekNews', { n: w.posted })}
        </button>
      )}
    </div>
  )
}
