import { useEffect, useState } from 'react'
import { Crown, Hourglass, Link2, Shuffle, TrendingDown } from 'lucide-react'
import { QUICK_CONTINENTAL_PLACES } from '@game/logic/quickCups'
import { useStorePick } from '../useStorePick'
import { playerLookup } from '@game/logic/players'
import { getFormation } from '@engine/formations'
import { ratingHidden } from '@game/logic/ratingVisibility'
import type { PlayerSeason } from '@engine/types'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { QUICK_CHANGES, quickBenchRule } from '@game/logic/quickBench'
import { CaptainAndPenalties, TeamInstructions } from '../components/TacticsControls'
import { SquadComplete } from '../components/PreSeasonOdds'
import { QuickTeamLine } from '../components/QuickTeamLine'
import { perfectTarget } from '@game/logic/perfect'
import { quickSeasonGames } from '@game/logic/quick'
import { isSuperLeague, SUPER_LEAGUE_LINE } from '@game/logic/superLeague'
import { quickManagerOptions } from '@game/logic/managers'
import { managerEdge } from '@game/logic/managerEdge'
import { squadReport, VETERAN_AGE, type ReportMan } from '@game/logic/squadReport'
import { ManagerChip, ManagerPick } from '../components/ManagerPick'
import { caseIconIn, kickoffStep } from '@game/logic/endCase'
import { ManagerSpin } from '../components/ManagerSpin'
import { EndCase } from '../components/EndCase'
import { translator } from '../i18n'
import { season } from '../i18n/en/season'
import { B, rich } from '../i18n/rich'
import { edgeHintText, edgeText, styleHelp } from '../i18n/engineText'

const t = translator(season)

/**
 * The step between a quick draft (or the Daily) and its season, the way 38-0 shows a finished squad: the goal (win
 * every game), the pundits' prediction and the XI's unit ratings, a big "Simulate season" button, and the tactics (the six team instructions, the
 * captain and the penalty taker) folded under it for a manager who wants to set them first. "Simulate with the
 * defaults" plays it with the default tactics instead.
 */
export function KickOff() {
  const { universe: u, game, setTactics, setCaptain, kickOffSoon, kickingOff: kicking, warmKickOff, pickManager } = useStorePick('universe', 'game', 'setTactics', 'setCaptain', 'kickOffSoon', 'kickingOff', 'warmKickOff', 'pickManager')
  const [showTactics, setShowTactics] = useState(false)
  const [showManagers, setShowManagers] = useState(false)
  // The season plays in a worker (the store's kickOffSoon), "Simulating" on the button meanwhile; its packs load now,
  // and the worker goes with the screen
  useEffect(() => warmKickOff(), [warmKickOff])
  if (!u || !game) return null
  // A Quick Draft with the manager spin or the end-of-draft case shows those first, in that order
  const step = kickoffStep(game)
  if (step === 'managers') return <ManagerSpin u={u} game={game} />
  if (step === 'case') return <EndCase u={u} game={game} />
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const hide = ratingHidden(game.settings.rules, 'squad')
  const tac = game.tactics
  const s = game.settings
  const report = squadReport(formation, game.lineup, get, hide)
  const edge = game.manager ? managerEdge(game, game.manager.style, get) : null
  const hint = game.manager && edge ? edgeHintText(game.manager.style, edge) : null
  return (
    <div className="page fit kickoff" data-testid="kickoff">
      <div className="fit-head screen-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>{t('squadComplete')}</h1>
          <QuickTeamLine game={game} u={u}>
            <span className="small muted">{formation.name}</span>
            {caseIconIn(game) && (
              <span className="chip case-icon-chip" data-tier="icons" data-testid="kickoff-case-icon" title={t('caseIconTip')}>
                {t('caseIcon')}
              </span>
            )}
          </QuickTeamLine>
        </div>
        <div className="chase perfect goal" data-testid="kickoff-goal">
          <b>{t('winEvery')}</b>
          <span className="small">{t('theGoal', { target: perfectTarget(quickSeasonGames(u, s)) })}</span>
        </div>
      </div>
      <div className="fit-grid c3">
        <div className="fit-cell">
          <SquadComplete game={game} u={u} hideRatings={hide}>
            <div className="col sc-foot" style={{ gap: 8 }}>
              <button className="btn primary big sc-go" onClick={() => void kickOffSoon()} disabled={kicking} aria-busy={kicking || undefined} data-testid="kickoff-go">
                {t(kicking ? 'simulating' : 'simulateSeason')}
              </button>
              <p className="help setup-line" data-testid="kickoff-line" style={{ margin: 0 }}>
                {t(s.january ? 'pausesJanuary' : 'noJanuary')}
                {isSuperLeague(s) ? t('superCups', { line: SUPER_LEAGUE_LINE, n: QUICK_CONTINENTAL_PLACES }) : s.mode === 'quick' ? t('afterLeagueCups', { n: QUICK_CONTINENTAL_PLACES }) : ''}
              </p>
            </div>
          </SquadComplete>
        </div>
        <div className="panel col fit-cell">
          <h3>{t('yourXi', { formation: formation.name })}</h3>
          <div inert className="pitch-fit" data-testid="kickoff-pitch">
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={hide} />
          </div>
          {quickBenchRule(game) && game.bench.length > 0 && (
            <div className="col" style={{ gap: 4 }} data-testid="kickoff-bench">
              <b className="small">{t('benchChanges', { n: QUICK_CHANGES })}</b>
              <div className="plist">
                {game.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hide} showClub /> : null
                })}
              </div>
              <span className="help">{t('benchHelp')}</span>
            </div>
          )}
        </div>
        <div className="panel col fit-cell">
          {game.manager && (
            <div className="col" data-testid="kickoff-manager" style={{ gap: 8 }}>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div className="col" style={{ gap: 4 }}>
                  <span className="sc-kicker">{t('inTheDugout')}</span>
                  <ManagerChip manager={game.manager} />
                  <span className="help">{styleHelp(game.manager.style)}</span>
                  {edge && (
                    <span className="small" data-testid="kickoff-manager-edge">
                      {rich(t('onYourXi', { edge: edgeText(edge) }), B)}
                      {hint ? ` · ${hint}` : ''}
                    </span>
                  )}
                </div>
                <button type="button" className="btn sm ghost" onClick={() => setShowManagers(!showManagers)} aria-expanded={showManagers} data-testid="kickoff-manager-change">
                  {t(showManagers ? 'done' : 'changeManager')}
                </button>
              </div>
              {showManagers && <ManagerPick options={quickManagerOptions(game)} picked={game.manager.id} onPick={pickManager} />}
            </div>
          )}
          <button type="button" className="fold-head" onClick={() => setShowTactics(!showTactics)} aria-expanded={showTactics} data-testid="kickoff-tactics-toggle">
            <b>{t('tacticsFold')}</b>
            <span className="small muted">{t(showTactics ? 'hideFold' : 'setFirst')}</span>
          </button>
          {showTactics && (
            <div className="col" data-testid="kickoff-tactics">
              <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={tac.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...tac.setPieces, penalties: id } })} hideRatings={hide} />
              <h3>{t('teamInstructions')}</h3>
              <TeamInstructions t={tac} onChange={setTactics} />
              <div className="row wrap" style={{ gap: 10 }}>
                <button className="btn primary" onClick={() => void kickOffSoon()} disabled={kicking} aria-busy={kicking || undefined} data-testid="kickoff-go-tactics">
                  {t(kicking ? 'simulating' : 'simulateTactics')}
                </button>
                <button className="btn ghost" onClick={() => void kickOffSoon(true)} disabled={kicking} data-testid="kickoff-skip" title={t('defaultsTip')}>
                  {t('simulateDefaults')}
                </button>
              </div>
            </div>
          )}
          {report && <ScoutingReport r={report} />}
        </div>
      </div>
    </div>
  )
}

const fitWord = (f: ReportMan['fit']) => t(`fit_${f}`)

/** A man and his number in his slot: "K. De Bruyne, 91 at CM". */
function manLine(m: ReportMan): string {
  return m.rating === null ? t('manAt', { name: m.name, position: m.position }) : t('manRatedAt', { name: m.name, rating: m.rating, position: m.position })
}

/** The third box's scouting report on the XI (`squadReport`): key man, weak link, out of position, age, links. Display only. */
function ScoutingReport({ r }: { r: NonNullable<ReturnType<typeof squadReport>> }) {
  const odd = r.outOfPosition
  return (
    <div className="col sc-report" data-testid="kickoff-report">
      <span className="sc-kicker">{t('scoutingReport')}</span>
      <ul className="sc-report-list">
        {r.key && (
          <li data-testid="report-key">
            <Crown size={16} aria-hidden="true" className="good" />
            <span>
              <b>{t('keyMan')}</b> {manLine(r.key)}
            </span>
          </li>
        )}
        {r.weak && (
          <li data-testid="report-weak">
            <TrendingDown size={16} aria-hidden="true" className="warn" />
            <span>
              <b>{t('weakLink')}</b> {manLine(r.weak)}
              {r.weak.fit !== 'natural' ? t('fitThere', { fit: fitWord(r.weak.fit) }) : ''}
            </span>
          </li>
        )}
        <li data-testid="report-position">
          <Shuffle size={16} aria-hidden="true" className={odd.length ? 'warn' : 'good'} />
          <span>
            <b>{t('outOfPosition')}</b>{' '}
            {odd.length
              ? `${odd
                  .slice(0, 3)
                  .map((m) => t('oddMan', { name: m.name, position: m.position, fit: fitWord(m.fit) }))
                  .join(', ')}${odd.length > 3 ? t('andMore', { n: odd.length - 3 }) : ''}`
              : t('nobodyOut')}
          </span>
        </li>
        <li data-testid="report-age">
          <Hourglass size={16} aria-hidden="true" />
          <span>
            <b>{t('age')}</b> {t('ageLine', { mean: r.meanAge.toFixed(1), young: r.young, veterans: r.veterans, vet: VETERAN_AGE })}
          </span>
        </li>
        <li data-testid="report-links">
          <Link2 size={16} aria-hidden="true" />
          <span>
            <b>{t('knowEachOther')}</b> {t('linksLine', { links: r.links, clubs: r.clubs, nations: r.nations })}
          </span>
        </li>
      </ul>
    </div>
  )
}
