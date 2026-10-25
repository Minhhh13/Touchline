import { useMemo, useState } from 'react'
import { ArrowLeftRight, Bandage, ImageDown } from 'lucide-react'
import { useStore } from '@game/store'
import { Bar, ClubBadge, Rating, Tabs, Tip } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import type { PitchSide } from '../components/LivePitch'
import { MomentumBar, PossessionTerritory, ShotMap, TacticsOverlay } from '../components/MatchCharts'
import { RedCard, YellowCard } from '../components/icons'
import { kitColours, teamCode } from '../match/shirts'
import { downloadDataUrl, renderMatchCard } from '../shareCard'
import { clubName, clubShort, minuteLabel } from '../format'
import { playerLookup } from '@game/logic/players'
import type { Appearance, FullMatchResult } from '@engine/match'
import { feedFromResult } from '@engine/matchFeed'
import { statsSeries, xgStory } from '@engine/matchStats'
import type { MatchContext } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import type { PlayerMatchStats, Tactics } from '@engine/types'
import { MatchDashboard } from '../matchday/MatchDashboard'
import { cardSeries, reportFigures } from '../matchday/model'
import { XgStory } from '../matchday/panels/XgStory'

/** The competition's flag before a match heading: the league's, or the EU flag on a European night; none for a friendly. */
function CompetitionFlag({ ctx, leagueId }: { ctx: MatchContext; leagueId?: string }) {
  if (ctx.roundLabel === 'Friendly' || !leagueId) return null
  return (
    <>
      <LeagueFlag leagueId={ctx.competition === 'continental' ? 'europe' : leagueId} size={24} />{' '}
    </>
  )
}

function sidesFromResult(res: FullMatchResult, names: { home: string; away: string; homeShort: string; awayShort: string }, colours: { home: string; away: string }): { home: PitchSide; away: PitchSide } {
  return {
    home: { name: names.home, shortName: names.homeShort, colour: colours.home, tactics: res.homeReport.tactics, appearances: res.homeReport.appearances },
    away: { name: names.away, shortName: names.awayShort, colour: colours.away, tactics: res.awayReport.tactics, appearances: res.awayReport.appearances },
  }
}

/** A side's short name: the manager's own, or the club's. */
function shortNameOf(u: LoadedUniverse, userShort: string, teamId: string): string {
  return teamId === USER_TEAM ? userShort : clubShort(u, teamId.replace(/^friendly-/, ''))
}

/**
 * The whistle fires from the clock's effect, not a click: a save the browser refuses (storage
 * full) must not take the screen down with it. The game in memory is already complete.
 */
function safely(fn: () => void): void {
  try {
    fn()
  } catch (e) {
    console.error(e)
  }
}

export function MatchScreen() {
  const store = useStore()
  const { universe: u, game, matchView, setMatchView, closeMatch } = store
  const [which, setWhich] = useState<'league' | 'cup'>('league')
  /** When a cup tie follows the league match, hold it until the league result has been seen. */
  const [holdLive, setHoldLive] = useState(false)
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const live = game.live && !holdLive ? game.live : null

  // Live: the dashboard plays each segment the engine has decided, through both stops and the held last twenty minutes
  if (live) {
    return (
      <div className="page matchday-page">
        <MatchDashboard
          key={`${live.kind}-${live.ctx.matchweek}-${live.opponentId}-${live.mp.clock ?? 45}`}
          source={{ mode: 'live', live }}
          onAdvance={(changes) => store.advanceLive(changes, true)}
          onSimToEnd={(changes) => {
            // Straight to the whistle with the assistant; a cup tie that follows waits until this report has been seen
            setWhich(live.kind === 'cup' ? 'cup' : 'league')
            setHoldLive(true)
            safely(() => store.finishLiveNow(changes))
          }}
          onWhistle={() => {
            // Hold a cup tie that follows until this report has been seen; then write the report
            setWhich(live.kind === 'cup' ? 'cup' : 'league')
            setHoldLive(true)
            safely(store.completeLive)
            safely(() => setMatchView('report'))
          }}
        />
      </div>
    )
  }

  if (!game.lastMatch || !game.lastMatchContext) return null
  const res = which === 'cup' && game.lastCupMatch ? game.lastCupMatch : game.lastMatch
  const ctx = which === 'cup' && game.lastCupContext ? game.lastCupContext : game.lastMatchContext
  const homeName = res.homeTeamId === USER_TEAM ? game.settings.teamName : res.homeName ?? clubName(u, res.homeTeamId)
  const awayName = res.awayTeamId === USER_TEAM ? game.settings.teamName : res.awayName ?? clubName(u, res.awayTeamId)
  const userIsHome = res.homeTeamId === USER_TEAM
  const names = { home: homeName, away: awayName, homeShort: shortNameOf(u, game.settings.shortName, res.homeTeamId), awayShort: shortNameOf(u, game.settings.shortName, res.awayTeamId) }
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const outcome = gf > ga ? 'Win' : gf === ga ? 'Draw' : 'Defeat'
  const seasonOver = game.phase === 'summary' || !!game.seasonEnding
  const cupNext = !!game.live && holdLive
  const continueLabel = seasonOver ? 'Season summary →' : cupNext ? `Next: ${game.live!.ctx.roundLabel ?? 'cup tie'} →` : 'Continue →'
  const onContinue = () => {
    if (seasonOver) {
      // The final whistle has gone; closing the match closes the season
      if (game.seasonEnding) closeMatch()
      store.go('game')
      return
    }
    if (cupNext) {
      setHoldLive(false)
      // The assistant is back to the saved way to play, whatever was asked for the last match
      store.nextLiveMatch()
      return
    }
    closeMatch()
  }

  return (
    <div className={`page ${matchView === 'ticker' ? 'matchday-page' : ''}`}>
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div>
          <h2>
            <CompetitionFlag ctx={ctx} leagueId={game.season?.leagueId} />
            {ctx.roundLabel ?? (ctx.competition === 'cup' ? 'Cup' : `Matchweek ${ctx.matchweek}`)}
            {ctx.importanceLabel ? ` · ${ctx.importanceLabel}` : ''}
          </h2>
          <div className="small muted">
            {homeName} v {awayName}
          </div>
        </div>
        <div className="row">
          {game.lastCupMatch && !cupNext && (
            <div className="segmented">
              <button className={which === 'league' ? 'active' : ''} onClick={() => setWhich('league')}>
                League
              </button>
              <button className={which === 'cup' ? 'active' : ''} onClick={() => setWhich('cup')}>
                Cup
              </button>
            </div>
          )}
          <button className="btn primary" onClick={onContinue}>
            {continueLabel}
          </button>
        </div>
      </div>

      <Tabs value={matchView} onChange={setMatchView} tabs={[{ id: 'ticker' as const, label: 'Live' }, { id: 'report' as const, label: 'Report' }]} />

      {matchView === 'ticker' && <MatchDashboard key={`${res.homeTeamId}-${res.awayTeamId}-${ctx.matchweek}-${which}`} source={{ mode: 'replay', res, ctx }} onWhistle={() => safely(() => setMatchView('report'))} />}
      {matchView === 'report' && <Report res={res} ctx={ctx} names={names} outcome={outcome} get={get} colours={kitColours(u, game.settings.hostClubId, res.homeTeamId, res.awayTeamId)} />}
    </div>
  )
}

function Report({ res, ctx, names, outcome, get, colours }: { res: FullMatchResult; ctx: MatchContext; names: { home: string; away: string; homeShort: string; awayShort: string }; outcome: string; get: (id: string) => ReturnType<ReturnType<typeof playerLookup>>; colours: { home: string; away: string } }) {
  const u = useStore((s) => s.universe)
  const game = useStore((s) => s.game)
  const { home: homeName, away: awayName } = names
  const userIsHome = res.homeTeamId === USER_TEAM
  const ours = userIsHome ? res.homeReport : res.awayReport
  const theirs = userIsHome ? res.awayReport : res.homeReport
  const goals = useMemo(() => res.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal'), [res.events])
  const sides = sidesFromResult(res, names, colours)
  const hasShots = res.events.some((e) => e.position)
  const withShape = (s: PitchSide): s is PitchSide & { tactics: Tactics; appearances: Appearance[] } => !!s.tactics && !!s.appearances
  const showToast = useStore((s) => s.showToast)
  // The same feed and stats the dashboard shows at the whistle, so the report, the dashboard and the shot map agree
  const feed = useMemo(() => feedFromResult(res, `${res.homeTeamId}-${res.awayTeamId}-${ctx.matchweek}`, { home: names.homeShort, away: names.awayShort }), [res, ctx.matchweek, names.homeShort, names.awayShort])
  const series = useMemo(() => statsSeries(feed, get), [feed, get])
  const story = useMemo(() => xgStory(feed), [feed])
  const fig = reportFigures(series, feed.lastMinute)
  const codes = u && game ? { home: teamCode(u, res.homeTeamId, names.homeShort, game.settings.shortName), away: teamCode(u, res.awayTeamId, names.awayShort, game.settings.shortName) } : { home: names.homeShort, away: names.awayShort }
  const shareCard = async () => {
    try {
      const url = await renderMatchCard({
        title: ctx.roundLabel ?? (ctx.competition === 'cup' ? 'Cup' : `Matchweek ${ctx.matchweek}`),
        subtitle: `${homeName} v ${awayName}`,
        home: { name: names.homeShort, colour: colours.home, goals: res.homeGoals, xg: fig.home.xg },
        away: { name: names.awayShort, colour: colours.away, goals: res.awayGoals, xg: fig.away.xg },
        events: res.events,
        xgHome: cardSeries(story.perMinute.home),
        xgAway: cardSeries(story.perMinute.away),
        footer: `HT ${res.halfTimeScore.home}-${res.halfTimeScore.away} · ${fig.home.shots}-${fig.away.shots} shots`,
      })
      downloadDataUrl(url, `touchline-${names.homeShort}-${names.awayShort}.png`.replace(/\s+/g, '-').toLowerCase())
    } catch {
      showToast('Could not render the match card.')
    }
  }
  const ratingBar = (s: PlayerMatchStats) => <Bar value={s.rating - 4.5} max={5.5} colour={s.rating >= 7.5 ? 'var(--good)' : s.rating < 6 ? 'var(--danger)' : 'var(--text-3)'} />
  return (
    <div className="grid two">
      <div className="col">
        <div className="scoreboard report-board">
          <div className="team">
            {res.homeTeamId !== USER_TEAM && <ClubBadge clubId={res.homeTeamId.replace(/^friendly-/, '')} size={34} />}
            {homeName}
          </div>
          <div className="col" style={{ alignItems: 'center', gap: 2 }}>
            <div className="score">
              {res.homeGoals} - {res.awayGoals}
            </div>
            <div className="clock">
              {outcome.toUpperCase()} · HT {res.halfTimeScore.home}-{res.halfTimeScore.away}
            </div>
          </div>
          <div className="team away">
            {awayName}
            {res.awayTeamId !== USER_TEAM && <ClubBadge clubId={res.awayTeamId.replace(/^friendly-/, '')} size={34} />}
          </div>
        </div>
        <div className="panel">
          <h3>Goals</h3>
          {goals.length === 0 && <div className="muted small">No goals.</div>}
          {goals.length > 0 && (
            <ol className="goal-list">
              {goals.map((g, i) => (
                <li key={i} className={g.side}>
                  <span className="goal-who">
                    <b>{g.playerName}</b>
                    {g.type === 'penalty' ? ' (pen)' : g.type === 'own_goal' ? ' (og)' : ''}
                    {g.secondaryName ? <span className="muted"> · {g.secondaryName}</span> : null}
                  </span>
                  <span className="goal-min mono">{minuteLabel(g.minute)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {(res.momentum?.length ?? 0) > 0 && (
          <div className="panel" data-testid="report-charts">
            <h3>Momentum and expected goals</h3>
            <div className="col" style={{ gap: 10 }}>
              <MomentumBar momentum={res.momentum!} clock={95} events={res.events} home={sides.home} away={sides.away} />
              <XgStory story={story} events={feed.events} minute={feed.lastMinute} span={Math.max(95, feed.lastMinute)} home={{ code: codes.home, colour: colours.home }} away={{ code: codes.away, colour: colours.away }} />
            </div>
          </div>
        )}
        {hasShots && (
          <div className="panel">
            <div className="panel-head">
              <h3>Shot map</h3>
              <button className="btn sm" onClick={shareCard} data-testid="match-card">
                <ImageDown size={14} aria-hidden="true" /> Match card
              </button>
            </div>
            <ShotMap events={res.events} home={sides.home} away={sides.away} />
            <div className="small muted" style={{ marginTop: 6 }}>
              {sides.home.shortName} {fig.home.shots} shots ({fig.home.onTarget} on target, {fig.home.xg.toFixed(2)} xG) · {sides.away.shortName} {fig.away.shots} ({fig.away.onTarget}, {fig.away.xg.toFixed(2)} xG)
            </div>
          </div>
        )}
        <div className="panel">
          <h3>Possession and territory</h3>
          <PossessionTerritory res={res} home={sides.home} away={sides.away} possession={{ home: fig.home.possession, away: fig.away.possession }} />
        </div>
        <div className="panel">
          <h3>Match stats</h3>
          <table className="tbl match-stats">
            <tbody>
              <tr>
                <td className="num">{fig.home.xg.toFixed(2)}</td>
                <th style={{ textAlign: 'center' }}>Expected goals</th>
                <td>{fig.away.xg.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="num">{fig.home.possession}%</td>
                <th style={{ textAlign: 'center' }}>Possession</th>
                <td>{fig.away.possession}%</td>
              </tr>
              <tr>
                <td className="num">
                  {fig.home.shots} ({fig.home.onTarget})
                </td>
                <th style={{ textAlign: 'center' }}>Shots (on target)</th>
                <td>
                  {fig.away.shots} ({fig.away.onTarget})
                </td>
              </tr>
              <tr>
                <td className="num">{res.xg.home.toFixed(2)}</td>
                <th style={{ textAlign: 'center' }}>Expected before kick-off</th>
                <td>{res.xg.away.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="num">{res.homeReport.strength.overall.toFixed(1)}</td>
                <th style={{ textAlign: 'center' }}>Team rating</th>
                <td>{res.awayReport.strength.overall.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Tip id="report-first">xG is the chances each side created; the notes are the exact modifiers your instructions produced.</Tip>
        <div className="panel">
          <h3>Tactical notes</h3>
          <ul className="notes-list small">
            {ours.teamTalkEffect && <li>{ours.teamTalkEffect}</li>}
            {ours.lateEffect && <li>{ours.lateEffect}</li>}
            {ours.modifiers.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {theirs.modifiers.notes.length > 0 && <li className="muted">Opponent: {theirs.modifiers.notes.slice(0, 2).join('; ')}</li>}
          </ul>
          <div className="toolbar small" style={{ marginTop: 'var(--space-2)' }}>
            <span className="chip">Attack ×{ours.modifiers.attack.toFixed(2)}</span>
            <span className="chip">Their chances ×{ours.modifiers.defence.toFixed(2)}</span>
            <span className="chip">
              Fatigue {ours.modifiers.fatigue > 0 ? '+' : ''}
              {ours.modifiers.fatigue}
            </span>
          </div>
        </div>
      </div>
      <div className="col">
        <div className="panel">
          <h3>Player ratings</h3>
          <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num hide-phone">Min</th>
                <th className="num">G</th>
                <th className="num">A</th>
                <th className="num">Rating</th>
              </tr>
            </thead>
            <tbody>
              {(userIsHome ? res.homeStats : res.awayStats)
                .slice()
                .sort((a, b) => b.rating - a.rating)
                .map((s) => {
                  const p = get(s.playerSeasonId)
                  return (
                    <tr key={s.playerSeasonId}>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          {p && <Rating value={p.overall} />} {p?.name ?? s.playerSeasonId}
                          {s.yellow && <span title="Booked" aria-label="Booked"><YellowCard size={13} /></span>}
                          {s.red && <span title="Sent off" aria-label="Sent off"><RedCard size={13} /></span>}
                          {s.injured && <Bandage size={13} className="ic-injury" aria-label="Injured" />}
                          {res.motmId === s.playerSeasonId && <span className="chip gold">MOTM</span>}
                        </span>
                      </td>
                      <td className="num hide-phone">{s.minutes}</td>
                      <td className="num">{s.goals}</td>
                      <td className="num">{s.assists}</td>
                      <td className="num rating-cell" style={{ fontWeight: 700, color: s.rating >= 7.5 ? 'var(--good)' : s.rating < 6 ? 'var(--danger)' : undefined }}>
                        {s.rating.toFixed(1)}
                        {ratingBar(s)}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          </div>
          {ours.substitutions.length > 0 && (
            <div className="small muted icon-title" style={{ marginTop: 8, alignItems: 'flex-start' }}>
              <ArrowLeftRight size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} /> {ours.substitutions.map((s) => `${get(s.on)?.name} for ${get(s.off)?.name} (${s.minute}', ${s.reason})`).join('; ')}
            </div>
          )}
        </div>
        <div className="panel" data-testid="opponent-ratings">
          <h3>Their ratings</h3>
          <div className="col" style={{ gap: 4 }}>
            {(userIsHome ? res.awayStats : res.homeStats)
              .slice()
              .sort((a, b) => b.rating - a.rating)
              .map((s) => (
                <div key={s.playerSeasonId} className="rating-row small">
                  <span className="name">
                    {get(s.playerSeasonId)?.name ?? s.playerSeasonId}
                    {res.motmId === s.playerSeasonId && <span className="chip gold">MOTM</span>}
                  </span>
                  {ratingBar(s)}
                  <span className="mono num">{s.rating.toFixed(1)}</span>
                </div>
              ))}
          </div>
        </div>
        {withShape(sides.home) && withShape(sides.away) && (
          <div className="panel">
            <h3>Tactics</h3>
            <div className="col" style={{ gap: 12 }}>
              <TacticsOverlay side={userIsHome ? sides.home : sides.away} attack={userIsHome ? 'home' : 'away'} getPlayer={get} />
              <TacticsOverlay side={userIsHome ? sides.away : sides.home} attack={userIsHome ? 'away' : 'home'} getPlayer={get} />
            </div>
          </div>
        )}
        {game && u && ctx.competition === 'league' && ctx.roundLabel !== 'Friendly' && (
          <div className="panel">
            <h3>Opponent</h3>
            <div className="club-head">
              <ClubBadge clubId={ctx.opponentClubId} size={40} />
              <div>
                <div style={{ fontWeight: 600 }}>
                  {clubName(u, ctx.opponentClubId)} <span className="chip">{theirs.strength.overall.toFixed(1)}</span>
                </div>
                <span className="unit-strip" aria-label="Their unit ratings">
                  {(
                    [
                      ['GK', theirs.strength.goalkeeping],
                      ['DEF', theirs.strength.defence],
                      ['MID', theirs.strength.midfield],
                      ['ATT', theirs.strength.attack],
                    ] as const
                  ).map(([k, v]) => (
                    <span key={k}>
                      <i>{k}</i> {v.toFixed(0)}
                    </span>
                  ))}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
