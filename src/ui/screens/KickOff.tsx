import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { getFormation } from '@engine/formations'
import { ratingsHidden } from '@engine/draft'
import type { PlayerSeason } from '@engine/types'
import { Pitch } from '../components/Pitch'
import { CaptainAndPenalties, TeamInstructions } from '../components/TacticsControls'
import { clubName, seasonLabel } from '../format'

/**
 * The tactics step between a quick draft (or the Daily) and its season: the six team instructions, the captain and the
 * penalty taker for the drafted XI, then "Kick off the season", or "Skip" to play it with the defaults.
 */
export function KickOff() {
  const { universe: u, game, setTactics, setCaptain, kickOff } = useStore()
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
          <h1>Kick-off</h1>
          <p className="muted setup-sub">
            {s.teamName} as {clubName(u, s.hostClubId)}, {seasonLabel(s.leagueSeason)}. Set how the XI plays, then watch the season game by game.
          </p>
        </div>
        <div className="grid two">
          <div className="panel col">
            <h3>Your XI · {formation.name}</h3>
            <div inert>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={hide} />
            </div>
            <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={t.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...t.setPieces, penalties: id } })} hideRatings={hide} />
          </div>
          <div className="panel col">
            <h3>Team instructions</h3>
            <TeamInstructions t={t} onChange={setTactics} />
          </div>
        </div>
        <p className="help setup-line" data-testid="kickoff-line">
          {s.january ? 'The season stops after the halfway matchweek for a January window, where the tactics can change too.' : 'No January window: the XI plays all the way through.'}
          {s.continental ? ' A top-four finish earns a Continental Cup run.' : ''}
        </p>
        <div className="row wrap" style={{ gap: 10 }}>
          <button className="btn primary big" onClick={() => kickOff()} data-testid="kickoff-go">
            Kick off the season
          </button>
          <button className="btn ghost" onClick={() => kickOff(true)} data-testid="kickoff-skip" title="Play with the default tactics, no captain and the best penalty taker on the pitch">
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}
