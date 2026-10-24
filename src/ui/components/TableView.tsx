import type { TableRow } from '@engine/types'
import { USER_TEAM } from '@engine/season'
import { ClubBadge, FormDots } from './bits'
import { useStore } from '@game/store'

export function TableView({ rows, teamName, compact, highlightTop }: { rows: TableRow[]; teamName: string; compact?: boolean; highlightTop?: boolean }) {
  const u = useStore((s) => s.universe)
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>#</th>
          <th>Club</th>
          <th className="num">P</th>
          {!compact && <th className="num">W</th>}
          {!compact && <th className="num">D</th>}
          {!compact && <th className="num">L</th>}
          <th className="num">GD</th>
          <th className="num">Pts</th>
          {!compact && <th>Form</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const me = r.teamId === USER_TEAM
          const name = me ? teamName : u?.clubById[r.teamId]?.name ?? r.teamId
          return (
            <tr key={r.teamId} className={me ? 'me' : ''} style={highlightTop && i === 0 ? { fontWeight: 700 } : undefined}>
              <td>{i + 1}</td>
              <td>
                <span className="row" style={{ gap: 8 }}>
                  {me ? <span className="badge" style={{ width: 22, height: 22, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 9 }}>YOU</span> : <ClubBadge clubId={r.teamId} size={22} />}
                  {name}
                </span>
              </td>
              <td className="num">{r.played}</td>
              {!compact && <td className="num">{r.won}</td>}
              {!compact && <td className="num">{r.drawn}</td>}
              {!compact && <td className="num">{r.lost}</td>}
              <td className="num">{r.goalsFor - r.goalsAgainst > 0 ? '+' : ''}{r.goalsFor - r.goalsAgainst}</td>
              <td className="num" style={{ fontWeight: 700 }}>{r.points}</td>
              {!compact && (
                <td>
                  <FormDots form={r.form} />
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
