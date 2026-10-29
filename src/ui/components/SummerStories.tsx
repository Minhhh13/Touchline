import type { SummerStories as Stories } from '@game/logic/dynastyHistory'
import { translator } from '../i18n'
import { history as historyText } from '../i18n/en/history'
import { rich, B } from '../i18n/rich'

const t = translator(historyText)

/** The summer modal's player stories (Dynasty, round 9): the farewells, the youngsters who grew and the milestones passed. */
export function SummerStories({ stories }: { stories: Stories }) {
  const { farewells, breakthroughs, milestones } = stories
  if (!farewells.length && !breakthroughs.length && !milestones.length) return null
  return (
    <div className="col" style={{ gap: 'var(--space-2)' }} data-testid="summer-stories">
      {farewells.length > 0 && (
        <div className="col" style={{ gap: 'var(--space-1)' }} data-testid="summer-farewells">
          <b>{t('summerFarewells')}</b>
          {farewells.map((f) => (
            <p key={f.name} className="small">
              {rich(t(f.captain ? 'farewellCaptain' : 'farewell', { name: f.name, age: f.age, seasons: f.seasons, apps: f.apps, goals: f.goals, titles: f.titles }), B)}
            </p>
          ))}
        </div>
      )}
      {breakthroughs.length > 0 && (
        <div className="summer-moves" data-testid="summer-breakthroughs">
          <b>{t('summerBreakthroughs')}</b>
          {breakthroughs.map((x) => (
            <span key={x.name} className="chip good">
              {rich(x.joined !== undefined ? t('breakthroughJoined', { name: x.name, age: x.age, from: x.from, to: x.to, joined: x.joined }) : t('breakthrough', { name: x.name, age: x.age, from: x.from, to: x.to }), B)}
            </span>
          ))}
        </div>
      )}
      {milestones.length > 0 && (
        <div className="col" style={{ gap: 'var(--space-1)' }} data-testid="summer-milestones">
          <b>{t('summerMilestones')}</b>
          {milestones.map((m) => (
            <p key={`${m.name}-${m.kind}`} className="small">
              {rich(t(m.kind === 'apps' ? 'milestoneApps' : 'milestoneGoals', { name: m.name, mark: m.mark }), B)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
