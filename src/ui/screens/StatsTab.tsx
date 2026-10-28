import { useMemo, useState } from 'react'
import { ChartBar } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { USER_TEAM } from '@engine/season'
import { playerLookup } from '@game/logic/players'
import { seasonRecords } from '@game/logic/seasonRecords'
import { analystPicks, ANALYST_INTERVAL, ANALYST_MIN_SHOTS, dataHubRows, dataHubTotals } from '@game/logic/dataHub'
import { ClubBadge, Info, Rating } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { statLeaders, type LeaderStat } from '@game/logic/statsTables'
import { PlayerPeek } from '../components/PlayerPeek'
import type { Boxes } from '../components/Boxes'
import { Segmented } from '../components/bits'
import { PlayerStatsTable, TeamStats } from './StatsTables'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'
import { rich } from '../i18n/rich'

const t = translator(dugout)

/** A signed figure to one decimal: "+1.4", "−0.8", "0.0". */
function signedOne(v: number): string {
  return `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`
}

type Stat = LeaderStat

/**
 * The Stats tab, three boxes side by side: the season's records, league-wide player statistics (your squad and every
 * AI club's), and the data hub (your players' expected goals and assists, per 90, from `src/game/logic/dataHub.ts`).
 */
/** `boxes` is the Dugout's Boxes control for this tab. */
export function StatsTab({ boxes }: { boxes?: Boxes }) {
  const { universe: u, game } = useStorePick('universe', 'game')
  const [view, setView] = useState<'overview' | 'players' | 'team'>('overview')
  const [stat, setStat] = useState<Stat>('goals')
  const rows = useMemo(() => (u && game?.season ? statLeaders(game.squad, game.season, playerLookup(game, u), stat) : []), [u, game, stat])
  const records = useMemo(() => (game?.season ? seasonRecords(game.season, (id) => u?.clubById[id]?.shortName ?? id) : null), [u, game])
  const hub = useMemo(() => (u && game?.season ? dataHubRows(game, u) : []), [u, game])
  if (!u || !game?.season) return null
  const totals = dataHubTotals(hub)
  const picks = analystPicks(hub)
  const on = (id: string) => boxes?.on(id) ?? true
  const switcher = (
    <div className="stats-switch">
      <Segmented value={view} onChange={setView} options={[{ value: 'overview', label: t('statsOverview'), testId: 'stats-view-overview' }, { value: 'players', label: t('statsPlayers'), testId: 'stats-view-players', hint: t('statsPlayersHint') }, { value: 'team', label: t('statsTeam'), testId: 'stats-view-team', hint: t('statsTeamHint') }]} />
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
          <h3>{t('seasonRecords')}</h3>
          <dl className="kv">
            <dt>{t('biggestWin')}</dt>
            <dd>{records.bigWin}</dd>
            <dt>{t('heaviestDefeat')}</dt>
            <dd>{records.bigLoss}</dd>
            <dt>{t('longestUnbeaten')}</dt>
            <dd>
              {t('matchesN', { n: records.bestUnbeaten })}
              {records.unbeatenNow >= 3 && records.unbeatenNow === records.bestUnbeaten ? t('andCounting') : ''}
            </dd>
            <dt>{t('longestWinning')}</dt>
            <dd>
              {t('matchesN', { n: records.bestWinning })}
              {records.winningNow >= 3 && records.winningNow === records.bestWinning ? t('andCounting') : ''}
            </dd>
            <dt>{t('cleanSheets')}</dt>
            <dd>
              {t('nOfM', { n: records.cleanSheets, m: records.played })}
            </dd>
            <dt>{t('scoredIn')}</dt>
            <dd>
              {t('nOfM', { n: records.scoredIn, m: records.played })}
            </dd>
          </dl>
        </div>
      ) : (
        <div className="panel">
          <h3>{t('seasonRecords')}</h3>
          <div className="small muted">{t('noMatches')}</div>
        </div>
      )}
    {on('league-stats') && (
    <div className="panel">
      <div className="panel-head">
        <h3><LeagueFlag leagueId={game.season.leagueId} label={u.leagues.find((l) => l.id === game.season?.leagueId)?.name} /> {t('leagueStats')}</h3>
        <div className="segmented">
          {(['goals', 'assists', 'rating', 'cleanSheets', 'motm'] as Stat[]).map((k) => (
            <button key={k} className={stat === k ? 'active' : ''} onClick={() => setStat(k)}>
              {t(`stat_${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('player')}</th>
            <th>{t('club')}</th>
            <th className="num">{t('appsCol')}</th>
            <th className="num">{t(`col_${stat}`)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.teamId === USER_TEAM ? 'me' : ''}>
              <td>{i + 1}</td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  <Rating value={r.p.overall} />{' '}
                  <PlayerPeek p={r.p} s={r.s}>
                    <span className="one-line">{r.p.name}</span>
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
                {t('noStats')}
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
            <ChartBar size={18} aria-hidden="true" /> {t('dataHub')}
          </h3>
          <Info label={t('aboutHub')}>{t('hubInfo', { interval: ANALYST_INTERVAL, shots: ANALYST_MIN_SHOTS })}</Info>
        </span>
        <span className="small muted" data-testid="hub-totals">
          {t('hubTotals', { goals: totals.goals, xg: totals.xg.toFixed(1), diff: signedOne(totals.goals - totals.xg) })}
        </span>
      </div>
      {(picks.over || picks.under) && (
        <div className="small" style={{ marginBottom: 'var(--space-2)' }}>
          {picks.over && (
            <div>
              {rich(t('beating', { name: picks.over.name, v: signedOne(picks.over.finishing) }), { good: (c) => <span className="good-text">{c}</span> })}
            </div>
          )}
          {picks.under && (
            <div>
              {rich(t('behindNumbers', { name: picks.under.name, v: signedOne(picks.under.finishing) }), { bad: (c) => <span className="bad-text">{c}</span> })}
            </div>
          )}
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl hub">
          <thead>
            <tr>
              <th>{t('player')}</th>
              <th className="num" title={t('minutesTip')}>{t('min')}</th>
              <th className="num" title={t('goalsTip')}>{t('g')}</th>
              <th className="num" title={t('xgTip')}>{t('xg')}</th>
              <th className="num" title={t('xgDiffTip')}>{t('pm')}</th>
              <th className="num" title={t('xaTip')}>{t('xa')}</th>
              <th className="num" title={t('ga90Tip')}>{t('ga90')}</th>
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
                  {t('noMinutesPlayed')}
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
