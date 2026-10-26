import { useState } from 'react'
import { Crown, Hourglass, Link2, Shuffle, TrendingDown } from 'lucide-react'
import { QUICK_CONTINENTAL_PLACES } from '@game/logic/quickCups'
import { useStore } from '@game/store'
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
import { edgeHint, edgeLine, managerEdge } from '@game/logic/managerEdge'
import { squadReport, VETERAN_AGE, type ReportMan } from '@game/logic/squadReport'
import { countPhrase } from '../screenText'
import { ManagerChip, ManagerPick } from '../components/ManagerPick'
import { MANAGER_STYLE_HELP } from '@engine/managers'
import { caseIconIn, kickoffStep } from '@game/logic/endCase'
import { ManagerSpin } from '../components/ManagerSpin'
import { EndCase } from '../components/EndCase'

/**
 * The step between a quick draft (or the Daily) and its season, the way 38-0 shows a finished squad: the goal (win
 * every game), the pundits' prediction and the XI's unit ratings, a big "Simulate season" button, and the tactics (the six team instructions, the
 * captain and the penalty taker) folded under it for a manager who wants to set them first. "Simulate with the
 * defaults" plays it with the default tactics instead.
 */
export function KickOff() {
  const { universe: u, game, setTactics, setCaptain, kickOff, pickManager } = useStore()
  const [showTactics, setShowTactics] = useState(false)
  const [showManagers, setShowManagers] = useState(false)
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
  const t = game.tactics
  const s = game.settings
  const report = squadReport(formation, game.lineup, get, hide)
  const edge = game.manager ? managerEdge(game, game.manager.style, get) : null
  const hint = game.manager && edge ? edgeHint(game.manager.style, edge) : null
  return (
    <div className="page fit" data-testid="kickoff">
      <div className="fit-head screen-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Squad complete</h1>
          <QuickTeamLine game={game} u={u}>
            <span className="small muted">{formation.name}</span>
            {caseIconIn(game) && (
              <span className="chip case-icon-chip" data-tier="icons" data-testid="kickoff-case-icon" title="An Icon from the end-of-draft case is in the XI: a non-standard season">
                ★ Case Icon
              </span>
            )}
          </QuickTeamLine>
        </div>
        <div className="chase perfect goal" data-testid="kickoff-goal">
          <b>Win every game</b>
          <span className="small">The goal: {perfectTarget(quickSeasonGames(u, s))}, the perfect season</span>
        </div>
      </div>
      <div className="fit-grid c3">
        <div className="fit-cell">
          <SquadComplete game={game} u={u} hideRatings={hide}>
            <div className="col sc-foot" style={{ gap: 8 }}>
              <button className="btn primary big sc-go" onClick={() => kickOff()} data-testid="kickoff-go">
                Simulate season
              </button>
              <p className="help setup-line" data-testid="kickoff-line" style={{ margin: 0 }}>
                {s.january ? 'It pauses at the halfway mark for the January window.' : 'No January window: the XI plays all the way through.'}
                {isSuperLeague(s) ? ` ${SUPER_LEAGUE_LINE}. A top-${QUICK_CONTINENTAL_PLACES} finish earns the Continental Cup against the next best.` : s.mode === 'quick' ? ` After the league you can play the Cup, and the Continental Cup with a top-${QUICK_CONTINENTAL_PLACES} finish.` : ''}
              </p>
            </div>
          </SquadComplete>
        </div>
        <div className="panel col fit-cell">
          <h3>Your XI · {formation.name}</h3>
          <div inert className="pitch-fit" data-testid="kickoff-pitch">
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={hide} />
          </div>
          {quickBenchRule(game) && game.bench.length > 0 && (
            <div className="col" style={{ gap: 4 }} data-testid="kickoff-bench">
              <b className="small">Bench · {QUICK_CHANGES} changes this season</b>
              <div className="plist">
                {game.bench.map((id) => {
                  const p = get(id)
                  return p ? <PlayerRow key={id} p={p} hideRatings={hide} showClub /> : null
                })}
              </div>
              <span className="help">Bring one on between games as the season plays; an injured starter is covered from the bench without using a change.</span>
            </div>
          )}
        </div>
        <div className="panel col fit-cell">
          {game.manager && (
            <div className="col" data-testid="kickoff-manager" style={{ gap: 8 }}>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div className="col" style={{ gap: 4 }}>
                  <span className="sc-kicker">In the dugout</span>
                  <ManagerChip manager={game.manager} />
                  <span className="help">{MANAGER_STYLE_HELP[game.manager.style]}</span>
                  {edge && (
                    <span className="small" data-testid="kickoff-manager-edge">
                      On your XI: <b>{edgeLine(edge)}</b>
                      {hint ? ` · ${hint}` : ''}
                    </span>
                  )}
                </div>
                <button type="button" className="btn sm ghost" onClick={() => setShowManagers(!showManagers)} aria-expanded={showManagers} data-testid="kickoff-manager-change">
                  {showManagers ? 'Done' : 'Change manager'}
                </button>
              </div>
              {showManagers && <ManagerPick options={quickManagerOptions(game)} picked={game.manager.id} onPick={pickManager} />}
            </div>
          )}
          <button type="button" className="fold-head" onClick={() => setShowTactics(!showTactics)} aria-expanded={showTactics} data-testid="kickoff-tactics-toggle">
            <b>Tactics, captain and penalties</b>
            <span className="small muted">{showTactics ? 'Hide ▴' : 'Set them first ▾'}</span>
          </button>
          {showTactics && (
            <div className="col" data-testid="kickoff-tactics">
              <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={t.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...t.setPieces, penalties: id } })} hideRatings={hide} />
              <h3>Team instructions</h3>
              <TeamInstructions t={t} onChange={setTactics} />
              <div className="row wrap" style={{ gap: 10 }}>
                <button className="btn primary" onClick={() => kickOff()} data-testid="kickoff-go-tactics">
                  Simulate season
                </button>
                <button className="btn ghost" onClick={() => kickOff(true)} data-testid="kickoff-skip" title="Play with the default tactics, no captain and the best penalty taker on the pitch">
                  Simulate with the default tactics
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

const FIT_WORD = { natural: 'natural', accomplished: 'accomplished', awkward: 'awkward', unsuited: 'out of his depth' } as const

/** A man and his number in his slot: "K. De Bruyne, 91 at CM". */
function manLine(m: ReportMan): string {
  return `${m.name}, ${m.rating === null ? '' : `${m.rating} `}at ${m.position}`
}

/** The third box's scouting report on the XI (`squadReport`): key man, weak link, out of position, age, links. Display only. */
function ScoutingReport({ r }: { r: NonNullable<ReturnType<typeof squadReport>> }) {
  const odd = r.outOfPosition
  return (
    <div className="col sc-report" data-testid="kickoff-report">
      <span className="sc-kicker">Scouting report</span>
      <ul className="sc-report-list">
        {r.key && (
          <li data-testid="report-key">
            <Crown size={16} aria-hidden="true" className="good" />
            <span>
              <b>Key man</b> {manLine(r.key)}
            </span>
          </li>
        )}
        {r.weak && (
          <li data-testid="report-weak">
            <TrendingDown size={16} aria-hidden="true" className="warn" />
            <span>
              <b>Weak link</b> {manLine(r.weak)}
              {r.weak.fit !== 'natural' ? `, ${FIT_WORD[r.weak.fit]} there` : ''}
            </span>
          </li>
        )}
        <li data-testid="report-position">
          <Shuffle size={16} aria-hidden="true" className={odd.length ? 'warn' : 'good'} />
          <span>
            <b>Out of position</b>{' '}
            {odd.length
              ? `${odd
                  .slice(0, 3)
                  .map((m) => `${m.name} (${m.position}, ${FIT_WORD[m.fit]})`)
                  .join(', ')}${odd.length > 3 ? ` and ${odd.length - 3} more` : ''}`
              : 'nobody: every man in a position he plays'}
          </span>
        </li>
        <li data-testid="report-age">
          <Hourglass size={16} aria-hidden="true" />
          <span>
            <b>Age</b> {r.meanAge.toFixed(1)} on average · {r.young ? countPhrase(r.young, 'starters') : 'nobody'} 23 or under · {r.veterans || 'nobody'} {VETERAN_AGE} or over
          </span>
        </li>
        <li data-testid="report-links">
          <Link2 size={16} aria-hidden="true" />
          <span>
            <b>Know each other</b> {r.links ? countPhrase(r.links, 'pairs from the same club-season') : 'no two from the same club-season'} · {countPhrase(r.clubs, 'clubs')}, {countPhrase(r.nations, 'nations')}
          </span>
        </li>
      </ul>
    </div>
  )
}
