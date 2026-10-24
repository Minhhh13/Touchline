import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { USER_TEAM } from '@engine/season'
import { playerLookup } from '@game/logic/players'
import { ClubBadge, Rating } from '../components/bits'
import type { SquadPlayer } from '@engine/types'

type Stat = 'goals' | 'assists' | 'rating' | 'cleanSheets' | 'motm'

/** League-wide player statistics: your squad and every AI club's. */
export function StatsTab() {
  const { universe: u, game } = useStore()
  const [stat, setStat] = useState<Stat>('goals')
  const rows = useMemo(() => {
    if (!u || !game?.season) return []
    const get = playerLookup(game, u)
    const out: Array<{ id: string; teamId: string; s: SquadPlayer }> = []
    for (const [id, s] of Object.entries(game.squad)) out.push({ id, teamId: USER_TEAM, s })
    for (const club of Object.values(game.season.ai)) for (const [id, s] of Object.entries(club.state)) if (s.seasonStats.apps > 0) out.push({ id, teamId: club.id, s })
    const value = (s: SquadPlayer) => {
      switch (stat) {
        case 'goals':
          return s.seasonStats.goals
        case 'assists':
          return s.seasonStats.assists
        case 'rating':
          return s.seasonStats.apps >= 5 ? s.seasonStats.ratingSum / s.seasonStats.apps : -1
        case 'cleanSheets':
          return get(s.playerSeasonId)?.positions[0] === 'GK' ? s.seasonStats.cleanSheets : -1
        case 'motm':
          return s.seasonStats.motm
      }
    }
    return out
      .map((r) => ({ ...r, v: value(r.s), p: get(r.id) }))
      .filter((r) => r.p && r.v > 0)
      .sort((a, b) => b.v - a.v || b.s.seasonStats.apps - a.s.seasonStats.apps)
      .slice(0, 25)
  }, [u, game, stat])
  if (!u || !game?.season) return null
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>League statistics</h3>
        <div className="segmented">
          {(
            [
              ['goals', 'Golden Boot'],
              ['assists', 'Playmaker'],
              ['rating', 'Best rated'],
              ['cleanSheets', 'Golden Glove'],
              ['motm', 'Man of the match'],
            ] as Array<[Stat, string]>
          ).map(([k, label]) => (
            <button key={k} className={stat === k ? 'active' : ''} onClick={() => setStat(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Club</th>
            <th className="num">Apps</th>
            <th className="num">{stat === 'rating' ? 'Avg' : stat === 'cleanSheets' ? 'CS' : stat === 'motm' ? 'MOTM' : stat === 'assists' ? 'A' : 'G'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.teamId === USER_TEAM ? 'me' : ''}>
              <td>{i + 1}</td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  <Rating value={r.p!.overall} /> {r.p!.name}
                </span>
              </td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  {r.teamId === USER_TEAM ? game.settings.teamName : <><ClubBadge clubId={r.teamId} size={18} /> {u.clubById[r.teamId]?.shortName ?? r.teamId}</>}
                </span>
              </td>
              <td className="num">{r.s.seasonStats.apps}</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {stat === 'rating' ? r.v.toFixed(2) : r.v}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No statistics yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
