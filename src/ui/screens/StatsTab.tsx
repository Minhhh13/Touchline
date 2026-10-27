import { useMemo, useState } from 'react'
import { ChartBar } from 'lucide-react'
import { useStore } from '@game/store'
import { USER_TEAM } from '@engine/season'
import { playerLookup } from '@game/logic/players'
import { seasonRecords } from '@game/logic/seasonRecords'
import { analystPicks, ANALYST_INTERVAL, ANALYST_MIN_SHOTS, dataHubRows, dataHubTotals } from '@game/logic/dataHub'
import { ClubBadge, Info, Rating } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import type { SquadPlayer } from '@engine/types'
import { PlayerPeek } from '../components/PlayerPeek'
import type { Boxes } from '../components/Boxes'
import { Segmented } from '../components/bits'
import { PlayerStatsTable, TeamStats } from './StatsTables'

/** A signed figure to one decimal: "+1.4", "−0.8", "0.0". */
function signedOne(v: number): string {
  return `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`
}

type Stat = 'goals' | 'assists' | 'rating' | 'cleanSheets' | 'motm'

/**
 * The Stats tab, three boxes side by side: the season's records, league-wide player statistics (your squad and every
 * AI club's), and the data hub (your players' expected goals and assists, per 90, from `src/game/logic/dataHub.ts`).
 */
/** `boxes` is the Dugout's Boxes control for this tab. */
export function StatsTab({ boxes }: { boxes?: Boxes }) {
  const { universe: u, game } = useStore()
  const [view, setView] = useState<'overview' | 'players' | 'team'>('overview')
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
  const records = useMemo(() => (game?.season ? seasonRecords(game.season, (id) => u?.clubById[id]?.shortName ?? id) : null), [u, game])
  const hub = useMemo(() => (u && game?.season ? dataHubRows(game, u) : []), [u, game])
  if (!u || !game?.season) return null
  const totals = dataHubTotals(hub)
  const picks = analystPicks(hub)
  const on = (id: string) => boxes?.on(id) ?? true
  const switcher = (
    <div className="stats-switch">
      <Segmented value={view} onChange={setView} options={[{ value: 'overview', label: 'Overview', testId: 'stats-view-overview' }, { value: 'players', label: 'Players', testId: 'stats-view-players', hint: 'Every player in the league, sorted by any column' }, { value: 'team', label: 'Team', testId: 'stats-view-team', hint: 'Our numbers ranked against every side' }]} />
    </div>
  )
  if (view === 'players')
    return (
      <>
        {switcher}
        <div className="grid fill stats-one" data-testid="stats-tab">
          <PlayerStatsTable />
        </div>
      </>
    )
  if (view === 'team')
    return (
      <>
        {switcher}
        <TeamStats />
      </>
    )
  const grid = boxes?.grid([{ track: 'minmax(0, 0.8fr)', ids: ['records'] }, { track: 'minmax(0, 1.1fr)', ids: ['league-stats'] }, { track: 'minmax(0, 1.2fr)', ids: ['data-hub'] }]) ?? { className: '', style: undefined }
  return (
    <>
    {switcher}
    <div className={`grid three fill squad-views stats-grid ${grid.className}`} style={grid.style} data-testid="stats-tab">
      {!on('records') ? null : records ? (
        <div className="panel">
          <h3>Season records</h3>
          <dl className="kv">
            <dt>Biggest win</dt>
            <dd>{records.bigWin}</dd>
            <dt>Heaviest defeat</dt>
            <dd>{records.bigLoss}</dd>
            <dt>Longest unbeaten run</dt>
            <dd>
              {records.bestUnbeaten} match{records.bestUnbeaten === 1 ? '' : 'es'}
              {records.unbeatenNow >= 3 && records.unbeatenNow === records.bestUnbeaten ? ' (and counting)' : ''}
            </dd>
            <dt>Longest winning run</dt>
            <dd>
              {records.bestWinning} match{records.bestWinning === 1 ? '' : 'es'}
              {records.winningNow >= 3 && records.winningNow === records.bestWinning ? ' (and counting)' : ''}
            </dd>
            <dt>Clean sheets</dt>
            <dd>
              {records.cleanSheets} of {records.played}
            </dd>
            <dt>Scored in</dt>
            <dd>
              {records.scoredIn} of {records.played}
            </dd>
          </dl>
        </div>
      ) : (
        <div className="panel">
          <h3>Season records</h3>
          <div className="small muted">No matches played yet.</div>
        </div>
      )}
    {on('league-stats') && (
    <div className="panel">
      <div className="panel-head">
        <h3><LeagueFlag leagueId={game.season.leagueId} label={u.leagues.find((l) => l.id === game.season?.leagueId)?.name} /> League statistics</h3>
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
      <div className="tbl-wrap"><table className="tbl">
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
                  <Rating value={r.p!.overall} />{' '}
                  <PlayerPeek p={r.p} s={r.s}>
                    <span className="one-line">{r.p!.name}</span>
                  </PlayerPeek>
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
      </table></div>
    </div>
    )}
    {on('data-hub') && (
    <div className="panel" data-testid="data-hub">
      <div className="panel-head">
        <span className="head-title">
          <h3 className="icon-title">
            <ChartBar size={18} aria-hidden="true" /> Data hub
          </h3>
          <Info label="About the data hub">Expected goals (xG) is what every attempt was worth from where it was taken; xA credits the assister with the xG of the goal he set up. ± is goals minus xG: above zero he finishes better than his chances. Per 90 figures over the minutes played. The analyst writes in every {ANALYST_INTERVAL} matchweeks about anyone with {ANALYST_MIN_SHOTS} attempts or more.</Info>
        </span>
        <span className="small muted" data-testid="hub-totals">
          {totals.goals} G · {totals.xg.toFixed(1)} xG ({signedOne(totals.goals - totals.xg)})
        </span>
      </div>
      {(picks.over || picks.under) && (
        <div className="small" style={{ marginBottom: 'var(--space-2)' }}>
          {picks.over && (
            <div>
              <span className="good-text">Beating his numbers:</span> {picks.over.name} {signedOne(picks.over.finishing)}
            </div>
          )}
          {picks.under && (
            <div>
              <span className="bad-text">Behind his numbers:</span> {picks.under.name} {signedOne(picks.under.finishing)}
            </div>
          )}
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl hub">
          <thead>
            <tr>
              <th>Player</th>
              <th className="num" title="Minutes">Min</th>
              <th className="num" title="Goals">G</th>
              <th className="num" title="Expected goals">xG</th>
              <th className="num" title="Goals minus expected goals">±</th>
              <th className="num" title="Expected assists">xA</th>
              <th className="num" title="Goals and assists per 90 minutes">G+A/90</th>
            </tr>
          </thead>
          <tbody>
            {hub.map((r) => (
              <tr key={r.id}>
                <td className="name one-line" title={r.name}>{r.name}</td>
                <td className="num">{r.minutes}</td>
                <td className="num">{r.goals}</td>
                <td className="num">{r.xg.toFixed(1)}</td>
                <td className={`num ${r.finishing > 0.5 ? 'good-text' : r.finishing < -0.5 ? 'bad-text' : ''}`}>{signedOne(r.finishing)}</td>
                <td className="num">{r.xa.toFixed(1)}</td>
                <td className="num">{r.gaPer90.toFixed(2)}</td>
              </tr>
            ))}
            {hub.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No minutes played yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    )}
    </div>
    </>
  )
}
