import { useMemo, useState } from 'react'
import { USER_TEAM } from '@engine/season'
import { useStorePick } from '../useStorePick'
import { playerLookup } from '@game/logic/players'
import { playerStatRows, sortPlayerStats, sortTeamStats, teamRank, teamStatRows, type PlayerStatKey, type TeamStatKey } from '@game/logic/statsTables'
import { ClubBadge, Pos, Rating, Segmented } from '../components/bits'
import { PlayerPeek } from '../components/PlayerPeek'
import { ordinal } from '../format'
import { countPhrase } from '../screenText'

/**
 * The Stats tab's Players and Team views: every player's season numbers in a table sorted by any column, and every
 * side's numbers with ours ranked against the league. Display only (`src/game/logic/statsTables.ts`).
 */

/** A table renders this many rows until Show all; a league's few hundred men stay quick to sort. */
const PAGE = 60

/** A column head that sorts its table: pressed once for the column's natural order, again to reverse it. */
function SortHead<K extends string>({ k, label, title, sort, reverse, onSort, num = true }: { k: K; label: string; title?: string; sort: K; reverse: boolean; onSort: (k: K) => void; num?: boolean }) {
  const on = sort === k
  return (
    <th className={num ? 'num' : undefined} aria-sort={on ? (reverse ? 'ascending' : 'descending') : undefined} title={title}>
      <button type="button" className={`sort-head ${on ? 'on' : ''}`} onClick={() => onSort(k)} data-testid={`sort-${k}`}>
        {label}
        {on && <span aria-hidden="true">{reverse ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  )
}

export function PlayerStatsTable() {
  const { universe: u, game } = useStorePick('universe', 'game')
  const [sort, setSort] = useState<PlayerStatKey>('goals')
  const [reverse, setReverse] = useState(false)
  const [who, setWho] = useState<'all' | 'mine'>('all')
  const [all, setAll] = useState(false)
  const rows = useMemo(() => (u && game?.season ? playerStatRows(game.squad, game.season, playerLookup(game, u)) : []), [u, game])
  const teamName = (id: string) => (id === USER_TEAM ? (game?.settings.teamName ?? '') : (u?.clubById[id]?.shortName ?? id))
  const sorted = useMemo(() => sortPlayerStats(who === 'mine' ? rows.filter((r) => r.mine) : rows, sort, reverse, (id) => (id === USER_TEAM ? (game?.settings.teamName ?? '') : (u?.clubById[id]?.shortName ?? id))), [rows, who, sort, reverse, u, game])
  if (!u || !game?.season) return null
  const get = playerLookup(game, u)
  const onSort = (k: PlayerStatKey) => {
    if (k === sort) setReverse(!reverse)
    else {
      setSort(k)
      setReverse(false)
    }
  }
  const head = { sort, reverse, onSort }
  const shown = all ? sorted : sorted.slice(0, PAGE)
  return (
    <div className="panel stats-players" data-testid="stats-players">
      <div className="panel-head">
        <h3>Player statistics</h3>
        <Segmented value={who} onChange={setWho} options={[{ value: 'all', label: 'Whole league', testId: 'stats-who-all' }, { value: 'mine', label: 'Our squad', testId: 'stats-who-mine' }]} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl sticky-head stats-tbl">
          <thead>
            <tr>
              <th>#</th>
              <SortHead k="name" label="Player" num={false} {...head} />
              <SortHead k="team" label="Club" num={false} {...head} />
              <SortHead k="position" label="Pos" num={false} {...head} />
              <SortHead k="apps" label="Apps" {...head} />
              <SortHead k="minutes" label="Min" title="Minutes" {...head} />
              <SortHead k="goals" label="G" title="Goals" {...head} />
              <SortHead k="assists" label="A" title="Assists" {...head} />
              <SortHead k="ga" label="G+A" title="Goals and assists" {...head} />
              <SortHead k="per90" label="/90" title="Goals and assists per 90 minutes (90 minutes or more)" {...head} />
              <SortHead k="avg" label="Avg" title="Average match rating" {...head} />
              <SortHead k="motm" label="MOTM" title="Man of the match" {...head} />
              <SortHead k="cleanSheets" label="CS" title="Clean sheets (keepers)" {...head} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.teamId}:${r.id}`} className={r.mine ? 'me' : ''}>
                <td className="muted">{i + 1}</td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <Rating value={r.overall} />
                    <PlayerPeek p={get(r.id)} s={r.mine ? game.squad[r.id] : game.season!.ai[r.teamId]?.state[r.id]}>
                      <span className="one-line">{r.name}</span>
                    </PlayerPeek>
                  </span>
                </td>
                <td>
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    {r.mine ? <span className="one-line">{game.settings.teamName}</span> : <><ClubBadge clubId={r.teamId} size={16} /> <span className="one-line">{teamName(r.teamId)}</span></>}
                  </span>
                </td>
                <td>
                  <Pos p={r.position} />
                </td>
                <td className="num">{r.apps}</td>
                <td className="num">{r.minutes}</td>
                <td className="num">{r.goals}</td>
                <td className="num">{r.assists}</td>
                <td className="num strong">{r.ga}</td>
                <td className="num">{r.per90 === null ? '–' : r.per90.toFixed(2)}</td>
                <td className="num">{r.avg === null ? '–' : r.avg.toFixed(2)}</td>
                <td className="num">{r.motm}</td>
                <td className="num">{r.cleanSheets ?? '–'}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={13} className="muted">
                  No statistics yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE && (
        <button type="button" className="btn sm ghost" style={{ marginTop: 'var(--space-2)' }} onClick={() => setAll(!all)} data-testid="stats-show-all">
          {all ? `Show the first ${PAGE}` : `Show all ${countPhrase(sorted.length, 'players')}`}
        </button>
      )}
    </div>
  )
}

const RANKED: Array<{ key: TeamStatKey; label: string }> = [
  { key: 'points', label: 'Points' },
  { key: 'goalsFor', label: 'Goals scored' },
  { key: 'goalsAgainst', label: 'Goals conceded' },
  { key: 'goalDiff', label: 'Goal difference' },
  { key: 'cleanSheets', label: 'Clean sheets' },
  { key: 'failedToScore', label: 'Games without a goal' },
  { key: 'homePoints', label: 'Home points' },
  { key: 'awayPoints', label: 'Away points' },
]

export function TeamStats() {
  const { universe: u, game } = useStorePick('universe', 'game')
  const [sort, setSort] = useState<TeamStatKey>('points')
  const [reverse, setReverse] = useState(false)
  const rows = useMemo(() => (game?.season ? teamStatRows(game.season) : []), [game])
  const sorted = useMemo(() => sortTeamStats(rows, sort, reverse), [rows, sort, reverse])
  if (!u || !game?.season) return null
  const me = rows.find((r) => r.teamId === USER_TEAM)
  const name = (id: string) => (id === USER_TEAM ? game.settings.teamName : (u.clubById[id]?.shortName ?? id))
  const onSort = (k: TeamStatKey) => {
    if (k === sort) setReverse(!reverse)
    else {
      setSort(k)
      setReverse(false)
    }
  }
  const head = { sort, reverse, onSort }
  return (
    <div className="grid two fill stats-team" data-testid="stats-team">
      <div className="panel">
        <h3>{game.settings.teamName}</h3>
        {!me || me.played === 0 ? (
          <p className="small muted">No league matches played yet.</p>
        ) : (
          <>
            <div className="team-cards">
              {RANKED.map((m) => {
                const v = m.key === 'homePoints' ? 3 * me.home.won + me.home.drawn : m.key === 'awayPoints' ? 3 * me.away.won + me.away.drawn : me[m.key]
                const rank = teamRank(rows, USER_TEAM, m.key)
                return (
                  <div key={m.key} className={`team-card ${rank === 1 ? 'top' : ''}`} data-testid={`team-${m.key}`}>
                    <span className="eyebrow">{m.label}</span>
                    <strong className="team-card-val">{m.key === 'goalDiff' && v > 0 ? `+${v}` : v}</strong>
                    <span className="small muted">{ordinal(rank)} of {rows.length}</span>
                  </div>
                )
              })}
            </div>
            <dl className="kv" style={{ marginTop: 'var(--space-3)' }}>
              <dt>Record</dt>
              <dd>
                {me.won}-{me.drawn}-{me.lost} in {countPhrase(me.played, 'games')}
              </dd>
              <dt>At home</dt>
              <dd>
                {me.home.won}-{me.home.drawn}-{me.home.lost} · {me.home.goalsFor}-{me.home.goalsAgainst}
              </dd>
              <dt>Away</dt>
              <dd>
                {me.away.won}-{me.away.drawn}-{me.away.lost} · {me.away.goalsFor}-{me.away.goalsAgainst}
              </dd>
              <dt>Goals a game</dt>
              <dd>
                {me.forPerGame.toFixed(2)} scored · {me.againstPerGame.toFixed(2)} conceded
              </dd>
              <dt>Biggest win</dt>
              <dd>{me.biggestWin ? `by ${me.biggestWin}` : '–'}</dd>
            </dl>
          </>
        )}
      </div>
      <div className="panel" data-testid="team-table">
        <h3>Every side</h3>
        {game.season.carryIn && <p className="help" style={{ marginTop: 0 }}>Since the takeover: the games before it are not in the results.</p>}
        <div className="tbl-wrap">
          <table className="tbl sticky-head stats-tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <SortHead k="played" label="P" title="Played" {...head} />
                <SortHead k="won" label="W" title="Won" {...head} />
                <SortHead k="drawn" label="D" title="Drawn" {...head} />
                <SortHead k="lost" label="L" title="Lost" {...head} />
                <SortHead k="goalsFor" label="GF" title="Goals scored" {...head} />
                <SortHead k="goalsAgainst" label="GA" title="Goals conceded" {...head} />
                <SortHead k="goalDiff" label="GD" title="Goal difference" {...head} />
                <SortHead k="cleanSheets" label="CS" title="Clean sheets" {...head} />
                <SortHead k="homePoints" label="Home" title="Points at home" {...head} />
                <SortHead k="awayPoints" label="Away" title="Points away" {...head} />
                <SortHead k="points" label="Pts" title="Points" {...head} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.teamId} className={r.teamId === USER_TEAM ? 'me' : ''}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      {r.teamId !== USER_TEAM && <ClubBadge clubId={r.teamId} size={16} />}
                      <span className="one-line">{name(r.teamId)}</span>
                    </span>
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.won}</td>
                  <td className="num">{r.drawn}</td>
                  <td className="num">{r.lost}</td>
                  <td className="num">{r.goalsFor}</td>
                  <td className="num">{r.goalsAgainst}</td>
                  <td className="num">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                  <td className="num">{r.cleanSheets}</td>
                  <td className="num">{3 * r.home.won + r.home.drawn}</td>
                  <td className="num">{3 * r.away.won + r.away.drawn}</td>
                  <td className="num strong">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
