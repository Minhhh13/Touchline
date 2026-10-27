import { CalendarCheck, Flame, History, Sparkles } from 'lucide-react'
import type { WeeklyThemeId } from '@game/logic/weeklyThemes'
import type { WeeklyRecord } from '@game/logic/weeklyRecord'
import { tierName } from '../format'
import { translator } from '../i18n'
import { setup } from '../i18n/en/setup'

const t = translator(setup)

/**
 * The Weekly setup's record (the right box was one notice over an empty panel): why the theme is worth a week, this
 * week's counted result and best replay, the streak, last week and the weeks before. Display only (`weeklyRecord`).
 */
export function WeeklyRecordBox({ theme, record: r }: { theme: WeeklyThemeId; record: WeeklyRecord }) {
  return (
    <div className="weekly-record" data-testid="weekly-record">
      <p className="small muted weekly-story">{t(`themeStory_${theme}`)}</p>
      <div className="recap-card" data-testid="weekly-this-week">
        <span className={`recap-icon${r.counted ? ' good' : ''}`} aria-hidden>
          <CalendarCheck size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">{t('thisWeek')}</span>
          <b>{r.counted ? t('ptsTier', { points: r.counted.points, tier: tierName(r.counted.tier) }) : t('notPlayedYet')}</b>
          <span className="small muted">
            {r.counted ? t('countedRun', { record: r.counted.record ? t('recordComma', { record: r.counted.record }) : '' }) : t('firstRunCounts')}
            {r.best ? t('bestReplay', { points: r.best.points, record: r.best.record }) : ''}
          </span>
        </div>
      </div>
      <div className="recap-card" data-testid="weekly-streak">
        <span className={`recap-icon${r.streak ? ' warn' : ''}`} aria-hidden>
          <Flame size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">{t('weeklyStreak')}</span>
          <b>{r.streak ? t('weeksInRow', { n: r.streak }) : t('noStreak')}</b>
          <span className="small muted">{t(r.streakAtRisk ? 'keepStreak' : r.streak ? 'countedThisWeek' : 'buildStreak')}</span>
        </div>
      </div>
      <div className="recap-card" data-testid="weekly-last">
        <span className="recap-icon" aria-hidden>
          {r.lastWeek ? <History size={18} /> : <Sparkles size={18} />}
        </span>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{t('lastWeek')}</span>
          <b>{r.lastWeek ? t('ptsTier', { points: r.lastWeek.points, tier: tierName(r.lastWeek.tier) }) : t('notPlayed')}</b>
          <div className="row wrap" style={{ gap: 4 }} role="group" aria-label={t('fourWeeks')}>
            {r.recent.map((w) => (
              <span key={w.week} className={`chip${w.points === null ? '' : ' info'}`} title={w.week}>
                {w.week.slice(5)} {w.points === null ? '–' : w.points}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
