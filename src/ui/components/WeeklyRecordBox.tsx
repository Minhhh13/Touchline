import { CalendarCheck, Flame, History, Sparkles } from 'lucide-react'
import type { WeeklyThemeId } from '@game/logic/weeklyThemes'
import type { WeeklyRecord } from '@game/logic/weeklyRecord'
import { tierName } from '../format'
import { countPhrase } from '../screenText'

/** Why each theme is worth a week: one line under its rules. */
const THEME_STORY: Record<WeeklyThemeId, string> = {
  'european-nights': 'Seven leagues on one wheel: a Bundesliga keeper behind a Serie A back four is fair game.',
  early: 'Back to the first seasons in the data, before the money moved: old names, thinner squads.',
  modern: 'Only the last few seasons: deep squads, so the wheel rarely lands on a weak side.',
  hard: 'No numbers while you draft: pick on names and memory, the grades come at the end.',
  realistic: 'The league plays at its real strength, so a title side has to be built, not bought.',
  'park-the-bus': 'Five at the back against a league at full strength: clean sheets win this one.',
  'one-nation': 'One country on every pick: the depth of its pool is the puzzle.',
  moneyball: 'Every man has a price: spend the cap where the points are.',
  'teammate-chain': 'Each pick must have shared a dressing room with the last: plan the chain, not just the man.',
}

/**
 * The Weekly setup's record (the right box was one notice over an empty panel): why the theme is worth a week, this
 * week's counted result and best replay, the streak, last week and the weeks before. Display only (`weeklyRecord`).
 */
export function WeeklyRecordBox({ theme, record: r }: { theme: WeeklyThemeId; record: WeeklyRecord }) {
  return (
    <div className="weekly-record" data-testid="weekly-record">
      <p className="small muted weekly-story">{THEME_STORY[theme]}</p>
      <div className="recap-card" data-testid="weekly-this-week">
        <span className={`recap-icon${r.counted ? ' good' : ''}`} aria-hidden>
          <CalendarCheck size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">This week</span>
          <b>{r.counted ? `${r.counted.points} pts · ${tierName(r.counted.tier)}` : 'Not played yet'}</b>
          <span className="small muted">
            {r.counted ? `${r.counted.record ? `${r.counted.record}, ` : ''}your first run, the one the streak counts` : 'Your first run this week is the one that counts'}
            {r.best ? ` · best replay ${r.best.points} pts (${r.best.record})` : ''}
          </span>
        </div>
      </div>
      <div className="recap-card" data-testid="weekly-streak">
        <span className={`recap-icon${r.streak ? ' warn' : ''}`} aria-hidden>
          <Flame size={18} />
        </span>
        <div className="col" style={{ gap: 2, minWidth: 0 }}>
          <span className="eyebrow">Weekly streak</span>
          <b>{r.streak ? countPhrase(r.streak, 'weeks in a row') : 'No streak yet'}</b>
          <span className="small muted">{r.streakAtRisk ? 'Play by Sunday (UTC) to keep it' : r.streak ? 'Counted this week' : 'Play a weekly each week to build one'}</span>
        </div>
      </div>
      <div className="recap-card" data-testid="weekly-last">
        <span className="recap-icon" aria-hidden>
          {r.lastWeek ? <History size={18} /> : <Sparkles size={18} />}
        </span>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">Last week</span>
          <b>{r.lastWeek ? `${r.lastWeek.points} pts · ${tierName(r.lastWeek.tier)}` : 'Not played'}</b>
          <div className="row wrap" style={{ gap: 4 }} aria-label="The four weeks before this one">
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
