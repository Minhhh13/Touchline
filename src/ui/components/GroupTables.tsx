import type { ReactNode } from 'react'
import type { GroupView } from '@game/logic/bracket'
import { translator } from '../i18n'
import { summary } from '../i18n/en/summary'

const t = translator(summary)

/** A played group match from your side, its result first: "W 3-0", "L 1-2"; `result` the letter for the words. */
function ourScore(m: GroupView['matches'][number], userId: string): { text: string; result: 'W' | 'D' | 'L'; gf: number; ga: number } {
  const home = m.home === userId
  const gf = home ? m.hg! : m.ag!
  const ga = home ? m.ag! : m.hg!
  const result = gf > ga ? 'W' : gf < ga ? 'L' : 'D'
  return { text: `${result} ${gf}-${ga}`, result, gf, ga }
}

/** A short column head read in full: "P" is "Played" to a screen reader. */
function Abbr({ short, full }: { short: string; full: string }) {
  return (
    <>
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{full}</span>
    </>
  )
}

/**
 * The Continental Cup's group stage (engine 7): a small table per group, the top two marked through once the group is
 * complete, your group outlined and its fixtures listed under it (`fixtures`; `weeks` names the matchweek each follows
 * inside a league season). Data from `seasonGroupViews` or
 * `quickGroupViews` (`src/game/logic/bracket.ts`); this only draws it.
 */
export function GroupTables({ groups, nameOf, badge, userId, fixtures = true, weeks = true, testId = 'group-tables' }: { groups: GroupView[]; nameOf: (id: string) => string; badge: (id: string) => ReactNode; userId: string; fixtures?: boolean; weeks?: boolean; testId?: string }) {
  return (
    <div className="group-tables" data-testid={testId}>
      {groups.map((g) => {
        const mine = g.rows.some((r) => r.teamId === userId)
        const ours = g.matches.filter((m) => m.home === userId || m.away === userId)
        return (
          <section key={g.name} className={`group-card ${mine ? 'mine' : ''}`} data-testid={`group-${g.name}`} aria-label={t('groupName', { name: g.name })}>
            <h4>{t('groupName', { name: g.name })}</h4>
            <table className="tbl">
              <thead>
                <tr>
                  <th>
                    <Abbr short="#" full={t('groupPlace')} />
                  </th>
                  <th>{t('groupClub')}</th>
                  <th className="num">
                    <Abbr short={t('groupPlayed')} full={t('groupPlayedFull')} />
                  </th>
                  <th className="num">
                    <Abbr short={t('groupGd')} full={t('groupGdFull')} />
                  </th>
                  <th className="num">
                    <Abbr short={t('groupPts')} full={t('groupPtsFull')} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.teamId} className={`${r.teamId === userId ? 'me' : ''} ${r.through ? 'through' : ''}`} data-through={r.through ? 'true' : undefined}>
                    <td>{r.place}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {badge(r.teamId)}
                        <span className="gt-name" title={nameOf(r.teamId)}>
                          {nameOf(r.teamId)}
                        </span>
                        {/* The green edge and the outline in words (round 4) */}
                        {r.teamId === userId && <span className="sr-only">, {t('groupYou')}</span>}
                        {r.through && <span className="sr-only">, {t('groupThrough')}</span>}
                      </span>
                    </td>
                    <td className="num">{r.played}</td>
                    <td className="num">
                      {r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}
                      {r.goalsFor - r.goalsAgainst}
                    </td>
                    <td className="num">
                      <b>{r.points}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fixtures && mine && (
              <ol className="group-fixtures" data-testid="group-fixtures">
                {ours.map((m) => {
                  const score = m.hg !== undefined ? ourScore(m, userId) : null
                  return (
                    <li key={`${m.matchday}-${m.home}`}>
                      <span className="muted">
                        <Abbr short={t('groupMd', { n: m.matchday })} full={t('groupMdFull', { n: m.matchday })} />
                      </span>
                      <span className="gt-name">{t(m.home === userId ? 'groupHome' : 'groupAway', { club: nameOf(m.home === userId ? m.away : m.home) })}</span>
                      <span>{score ? <Abbr short={score.text} full={t('groupResult', { result: score.result, gf: score.gf, ga: score.ga })} /> : weeks ? <Abbr short={t('groupAfter', { n: m.matchweek })} full={t('groupAfterFull', { n: m.matchweek })} /> : <Abbr short="–" full={t('groupNotYet')} />}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
