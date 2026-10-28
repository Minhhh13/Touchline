import { useMemo, useState } from 'react'
import { USER_TEAM } from '@engine/season'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { playerStatRows, sortPlayerStats, sortTeamStats, teamRank, teamStatRows, type PlayerStatKey, type TeamStatKey } from '@game/logic/statsTables'
import { ClubBadge, Pos, Rating, Segmented } from '../components/bits'
import { PlayerPeek } from '../components/PlayerPeek'
import { ordinal } from '../format'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

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
  const { universe: u, game } = useStore()
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
        <h3>{t('stPlayersTitle')}</h3>
        <Segmented value={who} onChange={setWho} options={[{ value: 'all', label: t('stWholeLeague'), testId: 'stats-who-all' }, { value: 'mine', label: t('stOurSquad'), testId: 'stats-who-mine' }]} />
      </div>
      <div className="tbl-wrap">
        <table className="tbl sticky-head stats-tbl">
          <thead>
            <tr>
              <th>#</th>
              <SortHead k="name" label={t('stPlayer')} num={false} {...head} />
              <SortHead k="team" label={t('stClub')} num={false} {...head} />
              <SortHead k="position" label={t('stPos')} num={false} {...head} />
              <SortHead k="apps" label={t('stApps')} {...head} />
              <SortHead k="minutes" label={t('stMin')} title={t('stMinTip')} {...head} />
              <SortHead k="goals" label={t('stG')} title={t('stGTip')} {...head} />
              <SortHead k="assists" label={t('stA')} title={t('stATip')} {...head} />
              <SortHead k="ga" label={t('stGa')} title={t('stGaTip')} {...head} />
              <SortHead k="per90" label={t('stPer90')} title={t('stPer90Tip')} {...head} />
              <SortHead k="avg" label={t('stAvg')} title={t('stAvgTip')} {...head} />
              <SortHead k="motm" label={t('stMotm')} title={t('stMotmTip')} {...head} />
              <SortHead k="cleanSheets" label={t('stCs')} title={t('stCsKeepersTip')} {...head} />
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
                  {t('stNone')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE && (
        <button type="button" className="btn sm ghost" style={{ marginTop: 'var(--space-2)' }} onClick={() => setAll(!all)} data-testid="stats-show-all">
          {all ? t('stShowFirst', { n: PAGE }) : t('stShowAll', { n: sorted.length })}
        </button>
      )}
    </div>
  )
}

const RANKED: Array<{ key: TeamStatKey; label: () => string }> = [
  { key: 'points', label: () => t('stRankPoints') },
  { key: 'goalsFor', label: () => t('stRankGoalsFor') },
  { key: 'goalsAgainst', label: () => t('stRankGoalsAgainst') },
  { key: 'goalDiff', label: () => t('stRankGoalDiff') },
  { key: 'cleanSheets', label: () => t('stRankCleanSheets') },
  { key: 'failedToScore', label: () => t('stRankFailed') },
  { key: 'homePoints', label: () => t('stRankHome') },
  { key: 'awayPoints', label: () => t('stRankAway') },
]

export function TeamStats() {
  const { universe: u, game } = useStore()
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
          <p className="small muted">{t('stNoMatches')}</p>
        ) : (
          <>
            <div className="team-cards">
              {RANKED.map((m) => {
                const v = m.key === 'homePoints' ? 3 * me.home.won + me.home.drawn : m.key === 'awayPoints' ? 3 * me.away.won + me.away.drawn : me[m.key]
                const rank = teamRank(rows, USER_TEAM, m.key)
                return (
                  <div key={m.key} className={`team-card ${rank === 1 ? 'top' : ''}`} data-testid={`team-${m.key}`}>
                    <span className="eyebrow">{m.label()}</span>
                    <strong className="team-card-val">{m.key === 'goalDiff' && v > 0 ? `+${v}` : v}</strong>
                    <span className="small muted">{t('stRankOf', { rank: ordinal(rank), n: rows.length })}</span>
                  </div>
                )
              })}
            </div>
            <dl className="kv" style={{ marginTop: 'var(--space-3)' }}>
              <dt>{t('stRecord')}</dt>
              <dd>
                {t('stRecordLine', { record: `${me.won}-${me.drawn}-${me.lost}`, n: me.played })}
              </dd>
              <dt>{t('stAtHome')}</dt>
              <dd>
                {me.home.won}-{me.home.drawn}-{me.home.lost} · {me.home.goalsFor}-{me.home.goalsAgainst}
              </dd>
              <dt>{t('stAway')}</dt>
              <dd>
                {me.away.won}-{me.away.drawn}-{me.away.lost} · {me.away.goalsFor}-{me.away.goalsAgainst}
              </dd>
              <dt>{t('stGoalsAGame')}</dt>
              <dd>
                {t('stPerGameLine', { scored: me.forPerGame.toFixed(2), conceded: me.againstPerGame.toFixed(2) })}
              </dd>
              <dt>{t('stBiggestWin')}</dt>
              <dd>{me.biggestWin ? t('stByN', { n: me.biggestWin }) : '–'}</dd>
            </dl>
          </>
        )}
      </div>
      <div className="panel" data-testid="team-table">
        <h3>{t('stEverySide')}</h3>
        {game.season.carryIn && <p className="help" style={{ marginTop: 0 }}>{t('stSinceTakeover')}</p>}
        <div className="tbl-wrap">
          <table className="tbl sticky-head stats-tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('stTeam')}</th>
                <SortHead k="played" label={t('stP')} title={t('stPTip')} {...head} />
                <SortHead k="won" label={t('stW')} title={t('stWTip')} {...head} />
                <SortHead k="drawn" label={t('stD')} title={t('stDTip')} {...head} />
                <SortHead k="lost" label={t('stL')} title={t('stLTip')} {...head} />
                <SortHead k="goalsFor" label={t('stGf')} title={t('stRankGoalsFor')} {...head} />
                <SortHead k="goalsAgainst" label={t('stGaCol')} title={t('stRankGoalsAgainst')} {...head} />
                <SortHead k="goalDiff" label={t('stGd')} title={t('stRankGoalDiff')} {...head} />
                <SortHead k="cleanSheets" label={t('stCs')} title={t('stRankCleanSheets')} {...head} />
                <SortHead k="homePoints" label={t('stHome')} title={t('stHomeTip')} {...head} />
                <SortHead k="awayPoints" label={t('stAway')} title={t('stAwayTip')} {...head} />
                <SortHead k="points" label={t('stPts')} title={t('stRankPoints')} {...head} />
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
