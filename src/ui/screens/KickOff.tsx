import { useState } from 'react'
import { QUICK_CONTINENTAL_PLACES } from '@game/logic/quickCups'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { getFormation } from '@engine/formations'
import { ratingsHidden } from '@engine/draft'
import type { PlayerSeason } from '@engine/types'
import { Pitch } from '../components/Pitch'
import { PlayerRow } from '../components/PlayerRow'
import { QUICK_CHANGES, quickBenchRule } from '@game/logic/quickBench'
import { CaptainAndPenalties, TeamInstructions } from '../components/TacticsControls'
import { SquadComplete } from '../components/PreSeasonOdds'
import { clubName, seasonLabel } from '../format'

/**
 * The step between a quick draft (or the Daily) and its season, the way 38-0 shows a finished squad: the pre-season
 * odds and the XI's unit ratings, a big "Simulate season" button, and the tactics (the six team instructions, the
 * captain and the penalty taker) folded under it for a manager who wants to set them first. "Simulate with the
 * defaults" plays it with the default tactics instead.
 */
export function KickOff() {
  const { universe: u, game, setTactics, setCaptain, kickOff } = useStore()
  const [showTactics, setShowTactics] = useState(false)
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const formation = getFormation(game.tactics.formationId)
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const hide = ratingsHidden(game.settings.rules)
  const t = game.tactics
  const s = game.settings
  return (
    <div className="page">
      <div className="setup-flow" data-testid="kickoff">
        <div>
          <h1>Squad complete</h1>
          <p className="muted setup-sub">
            {s.teamName} as {clubName(u, s.hostClubId)}, {seasonLabel(s.leagueSeason)} · {formation.name}. Eleven in, and this is how the season shapes up.
          </p>
        </div>
        <SquadComplete game={game} u={u} hideRatings={hide}>
          <button className="btn primary big sc-go" onClick={() => kickOff()} data-testid="kickoff-go">
            Simulate season
          </button>
          <p className="help setup-line" data-testid="kickoff-line" style={{ margin: 0 }}>
            {s.january ? 'It pauses at the halfway mark for the January window.' : 'No January window: the XI plays all the way through.'}
            {s.mode === 'quick' ? ` After the league you can play the Cup, and the Continental Cup with a top-${QUICK_CONTINENTAL_PLACES} finish.` : ''}
          </p>
        </SquadComplete>
        <button type="button" className="fold-head" onClick={() => setShowTactics(!showTactics)} aria-expanded={showTactics} data-testid="kickoff-tactics-toggle">
          <b>Tactics, captain and penalties</b>
          <span className="small muted">{showTactics ? 'Hide ▴' : 'Set them first ▾'}</span>
        </button>
        {showTactics && (
        <div className="grid two" data-testid="kickoff-tactics">
          <div className="panel col">
            <h3>Your XI · {formation.name}</h3>
            <div inert>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={hide} />
            </div>
            {quickBenchRule(game) && game.bench.length > 0 && (
              <div className="col" style={{ gap: 4 }} data-testid="kickoff-bench">
                <b className="small">
                  Bench · {QUICK_CHANGES} changes this season
                </b>
                <div className="plist">
                  {game.bench.map((id) => {
                    const p = get(id)
                    return p ? <PlayerRow key={id} p={p} hideRatings={hide} showClub /> : null
                  })}
                </div>
                <span className="help">Bring one on between games as the season plays; an injured starter is covered from the bench without using a change.</span>
              </div>
            )}
            <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={t.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...t.setPieces, penalties: id } })} hideRatings={hide} />
          </div>
          <div className="panel col">
            <h3>Team instructions</h3>
            <TeamInstructions t={t} onChange={setTactics} />
          </div>
        </div>
        )}
        {showTactics && (
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary" onClick={() => kickOff()} data-testid="kickoff-go-tactics">
              Simulate season
            </button>
            <button className="btn ghost" onClick={() => kickOff(true)} data-testid="kickoff-skip" title="Play with the default tactics, no captain and the best penalty taker on the pitch">
              Simulate with the default tactics
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
