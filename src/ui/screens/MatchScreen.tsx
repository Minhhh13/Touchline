import { useMemo, useState } from 'react'
import { ArrowLeftRight, Bandage, ImageDown } from 'lucide-react'
import { BoxesMenu, useBoxes, type Boxes } from '../components/Boxes'
import { REPORT } from '../boxSets'
import { useStore } from '@game/store'
import { useStorePick } from '../useStorePick'
import { Bar, ClubBadge, Rating, Tabs, TeamBadge, Tip } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import type { PitchSide } from '../components/LivePitch'
import { MomentumBar, PossessionTerritory, ShotMap, TacticsOverlay } from '../components/MatchCharts'
import { RedCard, YellowCard } from '../components/icons'
import { kitColours, teamCode } from '../match/shirts'
import { downloadDataUrl, renderMatchCard } from '../shareCard'
import { clubName, clubShort, minuteLabel, outcomeClass, signedValue, textColourFor, type Outcome } from '../format'
import { playerLookup } from '@game/logic/players'
import type { Appearance, FullMatchResult } from '@engine/match'
import { feedFromResult } from '@engine/matchFeed'
import { statsSeries, xgStory } from '@engine/matchStats'
import type { MatchContext } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import { USER_TEAM } from '@engine/season'
import type { PlayerMatchStats, Tactics } from '@engine/types'
import { arenaContinueLabel } from '@game/logic/arena'
import { ShootoutPanel } from '../components/ShootoutPanel'
import { knockoutOutcome } from '../arenaText'
import { shootoutKey, useShootoutRevealed } from '../shootoutReveal'
import { SeasonName } from '../components/SeasonName'
import { MatchDashboard } from '../matchday/MatchDashboard'
import { cardSeries, reportFigures } from '../matchday/model'
import { XgStory } from '../matchday/panels/XgStory'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'
import { logicLine } from '../i18n/logicText'

const t = translator(match)

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
  const store = useStorePick('universe', 'game', 'matchView', 'setMatchView', 'closeMatch', 'advanceLive', 'completeLive', 'finishLiveNow', 'go', 'nextLiveMatch')
  const { universe: u, game, matchView, setMatchView, closeMatch } = store
  const [which, setWhich] = useState<'league' | 'cup'>('league')
  /** When a cup tie follows the league match, hold it until the league result has been seen. */
  const [holdLive, setHoldLive] = useState(false)
  const reportBoxes = useBoxes(REPORT)
  // One lookup per game state: the report's stats series is memoised on it
  const get = useMemo(() => (u && game ? playerLookup(game, u) : null), [u, game])
  // An arena shoot-out revealing kick by kick on the report: the verdict and the Next button wait for its last kick
  const shootPens = game?.arena && !game.arena.pending ? game.arena.log.at(-1)?.pens : undefined
  const penKey = game?.arena && shootPens ? shootoutKey(game.id, game.arena.log.length, shootPens.kicks.length) : null
  const pensShown = useShootoutRevealed(penKey)
  if (!u || !game || !get) return null
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
  // An arena tie settled on penalties reads by its shoot-out ("Won on pens"), not as a draw
  const arenaPens = game.arena && !game.arena.pending && which === 'league' ? game.arena.log.at(-1)?.pens : undefined
  // Held while the kicks still reveal (the report only: the replay shows no shoot-out to wait for)
  const holdVerdict = !!arenaPens && !pensShown && matchView !== 'ticker'
  const verdict = holdVerdict ? { word: t('onPens'), outcome: 'D' as const } : knockoutOutcome(gf, ga, arenaPens)
  const outcome = verdict.word
  const seasonOver = game.phase === 'summary' || !!game.seasonEnding
  const cupNext = !!game.live && holdLive
  // The arena: penalties first, then the run's summary or its next match
  const arena = game.arena
  // A replay's button keeps the next step ("Next: Rung 2", "Run summary") to itself until the report: it would give the result away (playtest P4)
  const continueLabel = arena ? (holdVerdict || matchView === 'ticker' ? t('continue') : arenaContinueLabel(game)) : seasonOver ? t('seasonSummary') : cupNext ? t('nextTie', { round: game.live!.ctx.roundLabel ? logicLine(game.live!.ctx.roundLabel) : t('cupTie') }) : t('continue')
  const onContinue = () => {
    if (arena) {
      closeMatch()
      return
    }
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

  const tabs = <Tabs value={matchView} onChange={setMatchView} tabs={[{ id: 'ticker' as const, label: t('tabLive') }, { id: 'report' as const, label: t('tabReport') }]} />
  const replay = matchView === 'ticker'
  // An arena match level at the whistle: the shoot-out is the whole screen (a shell box that scrolls inside itself)
  if (arena?.pending) {
    return (
      <div className="page fit arena-shootout">
        <div className="fit-head">
          <div>
            <h2>
              <CompetitionFlag ctx={ctx} leagueId={game.season?.leagueId} />
              {ctx.roundLabel ? logicLine(ctx.roundLabel) : t('penalties')}
            </h2>
            <div className="small muted">
              {t('levelAt90', { home: homeName, away: awayName, score: `${res.homeGoals}-${res.awayGoals}` })}
            </div>
          </div>
          <button className="btn primary shootout-wait" disabled data-testid="match-continue">
            {continueLabel}
          </button>
        </div>
        <div className="fit-grid">
          <div className="fit-cell">
            <ShootoutPanel />
          </div>
        </div>
      </div>
    )
  }
  const buttons = (
    <div className="row">
      {game.lastCupMatch && !cupNext && (
        <div className="segmented">
          <button className={which === 'league' ? 'active' : ''} onClick={() => setWhich('league')}>
            {t('league')}
          </button>
          <button className={which === 'cup' ? 'active' : ''} onClick={() => setWhich('cup')}>
            {t('cup')}
          </button>
        </div>
      )}
      {!replay && <BoxesMenu groups={[reportBoxes]} />}
      <button className={`btn primary ${replay ? 'sm' : ''}`} onClick={onContinue} disabled={!!arena?.pending} data-testid="match-continue">
        {continueLabel}
      </button>
    </div>
  )
  return (
    <div className={`page ${replay ? 'matchday-page' : 'report-page'}`}>
      {/* The report's slim row: the match's name, the Live and Report tabs and the buttons; the replay folds the tabs and the buttons into the dashboard's competition line */}
      {!replay && (
        <div className="row between wrap match-head">
          <div className="match-title">
            <h2>
              <CompetitionFlag ctx={ctx} leagueId={game.season?.leagueId} />
              {ctx.roundLabel ? logicLine(ctx.roundLabel) : ctx.competition === 'cup' ? t('cup') : t('matchweek', { n: ctx.matchweek })}
              {ctx.importanceLabel ? ` · ${logicLine(ctx.importanceLabel)}` : ''}
            </h2>
            <div className="small muted">
              {t('versus', { home: homeName, away: awayName })}
            </div>
          </div>
          {tabs}
          {buttons}
        </div>
      )}

      {/* The shoot-out's kicks reveal on the report; the replay dashboard keeps its one-screen fit */}
      {arena && !replay && <ShootoutPanel />}

      {matchView === 'ticker' && <MatchDashboard key={`${res.homeTeamId}-${res.awayTeamId}-${ctx.matchweek}-${which}`} source={{ mode: 'replay', res, ctx }} onWhistle={() => safely(() => setMatchView('report'))} crumbEnd={<>
            {tabs}
            {buttons}
          </>} />}
      {matchView === 'report' && <Report boxes={reportBoxes} res={res} ctx={ctx} names={names} outcome={outcome} verdict={verdict.outcome} get={get} colours={kitColours(u, game.settings.hostClubId, res.homeTeamId, res.awayTeamId)} />}
    </div>
  )
}

type ChartTab = 'shots' | 'flow' | 'possession' | 'tactics'
type PeopleTab = 'ours' | 'theirs' | 'notes'

function Report({ boxes, res, ctx, names, outcome, verdict, get, colours }: { boxes: Boxes; res: FullMatchResult; ctx: MatchContext; names: { home: string; away: string; homeShort: string; awayShort: string }; outcome: string; verdict: Outcome; get: ReturnType<typeof playerLookup>; colours: { home: string; away: string } }) {
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
  // The centre and right boxes' tabs on a desktop (a phone shows every pane, stacked)
  const [chart, setChart] = useState<ChartTab>('shots')
  const [people, setPeople] = useState<PeopleTab>('ours')
  // The same feed and stats the dashboard shows at the whistle, so the report, the dashboard and the shot map agree
  const feed = useMemo(() => feedFromResult(res, `${res.homeTeamId}-${res.awayTeamId}-${ctx.matchweek}`, { home: names.homeShort, away: names.awayShort }), [res, ctx.matchweek, names.homeShort, names.awayShort])
  const series = useMemo(() => statsSeries(feed, get), [feed, get])
  const story = useMemo(() => xgStory(feed), [feed])
  const fig = reportFigures(series, feed.lastMinute)
  const codes = u && game ? { home: teamCode(u, res.homeTeamId, names.homeShort, game.settings.shortName), away: teamCode(u, res.awayTeamId, names.awayShort, game.settings.shortName) } : { home: names.homeShort, away: names.awayShort }
  const shareCard = async () => {
    try {
      const url = await renderMatchCard({
        title: ctx.roundLabel ?? (ctx.competition === 'cup' ? t('cup') : t('matchweek', { n: ctx.matchweek })),
        subtitle: t('versus', { home: homeName, away: awayName }),
        home: { name: names.homeShort, colour: colours.home, goals: res.homeGoals, xg: fig.home.xg },
        away: { name: names.awayShort, colour: colours.away, goals: res.awayGoals, xg: fig.away.xg },
        events: res.events,
        xgHome: cardSeries(story.perMinute.home),
        xgAway: cardSeries(story.perMinute.away),
        footer: t('cardFooter', { ht: `${res.halfTimeScore.home}-${res.halfTimeScore.away}`, shots: `${fig.home.shots}-${fig.away.shots}` }),
      })
      downloadDataUrl(url, `touchline-${names.homeShort}-${names.awayShort}.png`.replace(/\s+/g, '-').toLowerCase())
    } catch {
      showToast(t('cardFailed'))
    }
  }
  const ratingBar = (s: PlayerMatchStats) => <Bar value={s.rating - 4.5} max={5.5} colour={s.rating >= 7.5 ? 'var(--good)' : s.rating < 6 ? 'var(--danger)' : 'var(--text-3)'} />
  const hasFlow = (res.momentum?.length ?? 0) > 0
  const hasShape = withShape(sides.home) && withShape(sides.away)
  const chartTabs: Array<{ id: ChartTab; label: string }> = [...(hasShots ? [{ id: 'shots' as const, label: t('shotMap') }] : []), ...(hasFlow ? [{ id: 'flow' as const, label: t('momentum') }] : []), { id: 'possession', label: t('possession') }, ...(hasShape ? [{ id: 'tactics' as const, label: t('tactics') }] : [])]
  const chartOn = chartTabs.some((t) => t.id === chart) ? chart : chartTabs[0].id
  const motm = [...res.homeStats, ...res.awayStats].find((s) => s.playerSeasonId === res.motmId)
  const motmSide = motm ? (res.homeStats.includes(motm) ? names.homeShort : names.awayShort) : ''
  const opponentBox = !!game && !!u && ctx.competition === 'league' && ctx.roundLabel !== 'Friendly'
  // The Boxes control: the columns left take the freed width
  const grid = boxes.grid([
    { track: 'minmax(240px, 0.8fr)', ids: ['goals', 'stats'] },
    { track: 'minmax(0, 1.5fr)', ids: ['charts'] },
    { track: 'minmax(340px, 1.05fr)', ids: ['people'] },
  ])
  return (
    <div className="report-dash">
      <div className="scoreboard report-board">
        <div className="team">
          {res.homeTeamId !== USER_TEAM ? <ClubBadge clubId={res.homeTeamId.replace(/^friendly-/, '')} size={34} /> : <TeamBadge code={game?.settings.shortName} size={34} />}
          <SeasonName name={homeName} />
        </div>
        <div className="col" style={{ alignItems: 'center', gap: 2 }}>
          <div className="score">
            {res.homeGoals} - {res.awayGoals}
          </div>
          <div className="clock">
            <span className={`outcome-word ${outcomeClass(verdict)}`} data-testid="report-outcome">{outcome.toUpperCase()}</span> <span className="clock-ht">{t('halfTime', { score: `${res.halfTimeScore.home}-${res.halfTimeScore.away}` })}</span>
          </div>
        </div>
        <div className="team away">
          <SeasonName name={awayName} />
          {res.awayTeamId !== USER_TEAM ? <ClubBadge clubId={res.awayTeamId.replace(/^friendly-/, '')} size={34} /> : <TeamBadge code={game?.settings.shortName} size={34} />}
        </div>
      </div>

      {/* Three boxes side by side on a desktop: the goals and the numbers; the pictures (tabs); the ratings and the notes (tabs). A phone stacks every pane */}
      <div className={`report-grid ${grid.className}`} style={grid.style}>
        {(boxes.on('goals') || boxes.on('stats')) && (
        <div className="report-col">
          {boxes.on('goals') && (
          <div className="panel rp-goals">
            <h3>{t('goals')}</h3>
            {goals.length === 0 && <div className="muted small">{t('noGoals')}</div>}
            {goals.length > 0 && (
              <ol className="goal-list">
                {goals.map((g, i) => (
                  <li key={i} className={g.side}>
                    <span className="goal-who">
                      <span className="goal-side mono" style={{ background: colours[g.side], color: textColourFor(colours[g.side]) }}>{g.side === 'home' ? codes.home : codes.away}</span>
                      <b>{g.playerName}</b>
                      {g.type === 'penalty' ? <span className="goal-kind">{t('penMark')}</span> : g.type === 'own_goal' ? <span className="goal-kind">{t('ogMark')}</span> : ''}
                      {g.secondaryName ? (
                        <>
                          {' '}
                          <span className="muted">· {g.secondaryName}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="goal-min mono">{minuteLabel(g.minute)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          )}
          {boxes.on('stats') && (
          <div className="panel rp-stats">
            <h3>{t('matchStats')}</h3>
            <table className="tbl match-stats">
              <tbody>
                <tr>
                  <td className="num">{fig.home.xg.toFixed(2)}</td>
                  <th style={{ textAlign: 'center' }}>{t('expectedGoals')}</th>
                  <td>{fig.away.xg.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="num">{fig.home.possession}%</td>
                  <th style={{ textAlign: 'center' }}>{t('possession')}</th>
                  <td>{fig.away.possession}%</td>
                </tr>
                <tr>
                  <td className="num">
                    {fig.home.shots} ({fig.home.onTarget})
                  </td>
                  <th style={{ textAlign: 'center' }}>{t('shotsOnTarget')}</th>
                  <td>
                    {fig.away.shots} ({fig.away.onTarget})
                  </td>
                </tr>
                <tr>
                  <td className="num">{res.xg.home.toFixed(2)}</td>
                  <th style={{ textAlign: 'center' }}>{t('expectedBefore')}</th>
                  <td>{res.xg.away.toFixed(2)}</td>
                </tr>
                <tr>
                  <td className="num">{res.homeReport.strength.overall.toFixed(1)}</td>
                  <th style={{ textAlign: 'center' }}>{t('teamRating')}</th>
                  <td>{res.awayReport.strength.overall.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          )}
          <Tip id="report-first">{t('reportTip')}</Tip>
        </div>
        )}

        {boxes.on('charts') && (
        <div className="panel rp-box rp-charts">
          <div className="rp-box-head">
            <Tabs<ChartTab> value={chartOn} onChange={setChart} tabs={chartTabs} className="rp-tabs" testId="report-tab" />
            <button className="btn sm" onClick={shareCard} data-testid="match-card">
              <ImageDown size={14} aria-hidden="true" /> {t('matchCard')}
            </button>
          </div>
          {hasShots && (
            <div className={`rp-pane rp-shots ${chartOn === 'shots' ? 'on' : ''}`}>
              <h3 className="rp-pane-title">{t('shotMap')}</h3>
              <ShotMap events={res.events} home={sides.home} away={sides.away} />
              <div className="small muted rp-foot">
                {t('shotFoot', { home: sides.home.shortName, hs: fig.home.shots, ht: fig.home.onTarget, hx: fig.home.xg.toFixed(2), away: sides.away.shortName, as: fig.away.shots, at: fig.away.onTarget, ax: fig.away.xg.toFixed(2) })}
              </div>
            </div>
          )}
          {hasFlow && (
            <div className={`rp-pane rp-flow ${chartOn === 'flow' ? 'on' : ''}`} data-testid="report-charts">
              <h3 className="rp-pane-title">{t('momentumXg')}</h3>
              <MomentumBar momentum={res.momentum!} clock={95} events={res.events} home={sides.home} away={sides.away} />
              <XgStory story={story} events={feed.events} minute={feed.lastMinute} span={Math.max(95, feed.lastMinute)} home={{ code: codes.home, colour: colours.home }} away={{ code: codes.away, colour: colours.away }} />
            </div>
          )}
          <div className={`rp-pane rp-possession ${chartOn === 'possession' ? 'on' : ''}`}>
            <h3 className="rp-pane-title">{t('possessionTerritory')}</h3>
            <PossessionTerritory res={res} home={sides.home} away={sides.away} possession={{ home: fig.home.possession, away: fig.away.possession }} />
          </div>
          {withShape(sides.home) && withShape(sides.away) && (
            <div className={`rp-pane rp-tactics ${chartOn === 'tactics' ? 'on' : ''}`}>
              <h3 className="rp-pane-title">{t('tactics')}</h3>
              <div className="rp-tactics-grid">
                <TacticsOverlay side={userIsHome ? sides.home : sides.away} attack={userIsHome ? 'home' : 'away'} getPlayer={get} />
                <TacticsOverlay side={userIsHome ? sides.away : sides.home} attack={userIsHome ? 'away' : 'home'} getPlayer={get} />
              </div>
            </div>
          )}
        </div>
        )}

        {boxes.on('people') && (
        <div className="panel rp-box rp-people">
          {motm && (
            <div className="rp-motm" data-testid="report-motm">
              <span className="chip gold">{t('playerOfMatch')}</span>
              <b>{get(motm.playerSeasonId)?.name ?? motm.playerSeasonId}</b>
              <span className="muted small">{motmSide}</span>
              <span className="mono num">{motm.rating.toFixed(1)}</span>
            </div>
          )}
          <div className="rp-box-head">
            <Tabs<PeopleTab> value={people} onChange={setPeople} tabs={[{ id: 'ours', label: t('ourRatings') }, { id: 'theirs', label: t('theirRatings') }, { id: 'notes', label: t('notes') }]} className="rp-tabs" testId="report-tab" />
          </div>
          <div className={`rp-pane rp-ours ${people === 'ours' ? 'on' : ''}`}>
            <h3 className="rp-pane-title">{t('playerRatings')}</h3>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t('colPlayer')}</th>
                    <th className="num hide-phone">{t('colMin')}</th>
                    <th className="num">{t('colGoals')}</th>
                    <th className="num">{t('colAssists')}</th>
                    <th className="num">{t('colRating')}</th>
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
                              {s.yellow && <span title={t('booked')} role="img" aria-label={t('booked')}><YellowCard size={13} /></span>}
                              {s.red && <span title={t('sentOff')} role="img" aria-label={t('sentOff')}><RedCard size={13} /></span>}
                              {s.injured && <Bandage size={13} className="ic-injury" role="img" aria-label={t('injured')} />}
                              {res.motmId === s.playerSeasonId && <span className="chip gold">{t('motm')}</span>}
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
                <ArrowLeftRight size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} /> {ours.substitutions.map((s) => t('subLine', { on: get(s.on)?.name, off: get(s.off)?.name, minute: minuteLabel(s.minute), reason: s.reason })).join('; ')}
              </div>
            )}
          </div>
          <div className={`rp-pane rp-theirs ${people === 'theirs' ? 'on' : ''}`} data-testid="opponent-ratings">
            <h3 className="rp-pane-title">{t('theirRatings')}</h3>
            <div className="col" style={{ gap: 4 }}>
              {(userIsHome ? res.awayStats : res.homeStats)
                .slice()
                .sort((a, b) => b.rating - a.rating)
                .map((s) => (
                  <div key={s.playerSeasonId} className="rating-row small">
                    <span className="name">
                      {get(s.playerSeasonId)?.name ?? s.playerSeasonId}
                      {res.motmId === s.playerSeasonId && <span className="chip gold">{t('motm')}</span>}
                    </span>
                    {ratingBar(s)}
                    <span className="mono num">{s.rating.toFixed(1)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className={`rp-pane rp-notes ${people === 'notes' ? 'on' : ''}`}>
            <h3 className="rp-pane-title">{t('tacticalNotes')}</h3>
            <ul className="notes-list small">
              {ours.teamTalkEffect && <li>{ours.teamTalkEffect}</li>}
              {ours.lateEffect && <li>{ours.lateEffect}</li>}
              {ours.modifiers.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
              {theirs.modifiers.notes.length > 0 && <li className="muted">{t('opponentNotes', { notes: theirs.modifiers.notes.slice(0, 2).join('; ') })}</li>}
            </ul>
            <div className="toolbar small" style={{ marginTop: 'var(--space-2)' }}>
              <span className="chip">{t('attackMod', { x: ours.modifiers.attack.toFixed(2) })}</span>
              <span className="chip">{t('chancesMod', { x: ours.modifiers.defence.toFixed(2) })}</span>
              <span className="chip">
                {t('fatigueMod', { x: signedValue(ours.modifiers.fatigue) })}
              </span>
            </div>
            {opponentBox && u && (
              <div className="rp-opponent">
                <h3>{t('opponent')}</h3>
                <div className="club-head">
                  <ClubBadge clubId={ctx.opponentClubId} size={40} />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {clubName(u, ctx.opponentClubId)} <span className="chip">{theirs.strength.overall.toFixed(1)}</span>
                    </div>
                    <span className="unit-strip" role="group" aria-label={t('unitRatings')}>
                      {(
                        [
                          [t('unitGk'), theirs.strength.goalkeeping],
                          [t('unitDef'), theirs.strength.defence],
                          [t('unitMid'), theirs.strength.midfield],
                          [t('unitAtt'), theirs.strength.attack],
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
        )}
      </div>
    </div>
  )
}
