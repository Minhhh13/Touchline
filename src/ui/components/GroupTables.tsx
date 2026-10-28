import type { ReactNode } from 'react'
import type { GroupView } from '@game/logic/bracket'
import { outcomeClass, outcomeOf } from '../format'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'

const t = translator(summary)

/** A played group match from your side: our goals first, and the W/D/L letter. */
function ourScore(m: GroupView['matches'][number], userId: string): { gf: number; ga: number } {
  const home = m.home === userId
  return { gf: home ? m.hg! : m.ag!, ga: home ? m.ag! : m.hg! }
}

/**
 * The Continental Cup's group stage (engine 7): a small table per group, the top two marked as the qualifying places
 * while it is open and through once it is complete, your group outlined and its fixtures listed under it (`fixtures`;
 * `weeks` names the matchweek each follows inside a league season). Data from `seasonGroupViews` or
 * `quickGroupViews` (`src/game/logic/bracket.ts`); this only draws it.
 */
export function GroupTables({ groups, nameOf, badge, userId, fixtures = true, weeks = true, testId = 'group-tables' }: { groups: GroupView[]; nameOf: (id: string) => string; badge: (id: string) => ReactNode; userId: string; fixtures?: boolean; weeks?: boolean; testId?: string }) {
  return (
    <div className="group-tables-wrap">
      <div className="group-tables" data-testid={testId}>
        {groups.map((g) => {
          const mine = g.rows.some((r) => r.teamId === userId)
          const ours = g.matches.filter((m) => m.home === userId || m.away === userId)
          return (
            <section key={g.name} className={`group-card ${mine ? 'mine' : ''} ${g.complete ? 'complete' : ''}`} data-testid={`group-${g.name}`} aria-label={t('groupName', { name: g.name })}>
              <h4>{t('groupName', { name: g.name })}</h4>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('groupClub')}</th>
                    <th className="num" title={t('groupPlayedTip')}>{t('groupPlayed')}</th>
                    <th className="num gt-record">{t('groupRecord')}</th>
                    <th className="num" title={t('groupGdTip')}>{t('groupGd')}</th>
                    <th className="num" title={t('groupPtsTip')}>{t('groupPts')}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const zone = !g.complete && r.place <= 2 && r.played > 0
                    const out = g.complete && !r.through
                    return (
                      <tr key={r.teamId} className={`${r.teamId === userId ? 'me' : ''} ${r.through ? 'through' : ''} ${zone ? 'zone' : ''} ${out ? 'out' : ''}`} data-through={r.through ? 'true' : undefined} title={r.through ? t('groupThrough') : zone ? t('groupZone') : out ? t('groupOut') : undefined}>
                        <td>{r.place}</td>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            {badge(r.teamId)}
                            <span className="gt-name" title={nameOf(r.teamId)}>
                              {nameOf(r.teamId)}
                            </span>
                          </span>
                        </td>
                        <td className="num">{r.played}</td>
                        <td className="num gt-record">
                          {r.won}-{r.drawn}-{r.lost}
                        </td>
                        <td className="num">
                          {r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}
                          {r.goalsFor - r.goalsAgainst}
                        </td>
                        <td className="num">
                          <b>{r.points}</b>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {fixtures && mine && (
                <ol className="group-fixtures" data-testid="group-fixtures">
                  {ours.map((m) => {
                    const played = m.hg !== undefined
                    const s = played ? ourScore(m, userId) : null
                    const o = s ? outcomeOf(s.gf, s.ga) : null
                    return (
                      <li key={`${m.matchday}-${m.home}`} className={played ? 'played' : ''}>
                        <span className="muted" title={t('groupMdTip', { n: m.matchday })}>
                          {t('groupMd', { n: m.matchday })}
                        </span>
                        <span className="gt-name">{t('groupAt', { home: m.home === userId ? 'home' : 'away', club: nameOf(m.home === userId ? m.away : m.home) })}</span>
                        {s && o ? (
                          <span className={`gt-score ${outcomeClass(o)}`}>
                            <span className="res-letter">{o}</span>
                            {s.gf}-{s.ga}
                          </span>
                        ) : (
                          <span className="muted">{weeks ? t('groupAfter', { n: m.matchweek }) : '–'}</span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          )
        })}
      </div>
      <p className="group-key small muted">
        <span className="group-key-mark" aria-hidden="true" /> {t('groupKey')}
      </p>
    </div>
  )
}
