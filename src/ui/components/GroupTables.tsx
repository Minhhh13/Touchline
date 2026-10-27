import type { ReactNode } from 'react'
import type { GroupView } from '@game/logic/bracket'

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
          <section key={g.name} className={`group-card ${mine ? 'mine' : ''}`} data-testid={`group-${g.name}`} aria-label={`Group ${g.name}`}>
            <h4>Group {g.name}</h4>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Club</th>
                  <th className="num">P</th>
                  <th className="num">GD</th>
                  <th className="num">Pts</th>
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
                {ours.map((m) => (
                  <li key={`${m.matchday}-${m.home}`}>
                    <span className="muted">MD {m.matchday}</span>
                    <span className="gt-name">
                      {m.home === userId ? 'v' : 'at'} {nameOf(m.home === userId ? m.away : m.home)}
                    </span>
                    <span>{m.hg !== undefined ? `${m.hg}-${m.ag}` : weeks ? `after MW ${m.matchweek}` : '–'}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
