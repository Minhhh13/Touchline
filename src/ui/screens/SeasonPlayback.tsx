import { useState } from 'react'
import { useStore } from '@game/store'
import type { Game, QuickJanuary } from '@game/types'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import { getFormation } from '@engine/formations'
import { ratingsHidden } from '@engine/draft'
import { ratingAt } from '@engine/positions'
import { playerLookup } from '@game/logic/players'
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '@game/logic/gameByGame'
import { GameByGame, GameCard, RunningStrip, useSeasonPlayback } from '../components/GameByGame'
import { PlayerRow } from '../components/PlayerRow'
import { Pos, Segmented } from '../components/bits'
import { CaptainAndPenalties, TeamInstructions } from '../components/TacticsControls'
import { clubName, money, ordinal, seasonLabel } from '../format'

/**
 * The quick season, game by game, after kick-off. In phase `january` it plays the first half and stops on the January
 * window; once the season is done it plays the rest and offers the summary. Only the reveal is paced: every result was
 * simulated before the first game is shown.
 */
export function SeasonPlayback() {
  const { universe: u, game, playback, endPlayback } = useStore()
  const j = game?.phase === 'january' ? game.quickJanuary ?? null : null
  const results = j ? j.firstHalf : game?.quickResult?.results ?? []
  // A reload during the first half lands on the window; after the season the playback carries on where the window left it
  const from = playback?.from ?? results.length
  const pb = useSeasonPlayback(results.length, from)
  if (!u || !game) return null
  const opponent = (id: string) => ({ clubId: id, name: clubName(u, id) })
  const s = game.settings
  const latest = pb.revealed ? results[pb.revealed - 1] : null
  const total = game.quickResult?.results?.length ?? (j ? j.afterMatchweek * 2 : results.length)
  return (
    <div className="page">
      <div className="setup-flow" data-testid="season-playback">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1>{j && pb.done ? 'January' : 'The season'}</h1>
            <p className="muted setup-sub">
              {s.teamName} as {clubName(u, s.hostClubId)} · {seasonLabel(s.leagueSeason)} · game {pb.revealed} of {total}
            </p>
          </div>
          {!pb.done && (
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn sm" onClick={pb.toggle} data-testid="playback-pause">
                {pb.playing ? 'Pause' : 'Play'}
              </button>
              <Segmented<string> value={String(pb.speed)} onChange={(v) => pb.setSpeed(Number(v) as PlaybackSpeed)} options={PLAYBACK_SPEEDS.map((x) => ({ value: String(x), label: `${x}x` }))} />
              <button className="btn sm ghost" onClick={pb.skip} data-testid="playback-skip">
                {j ? 'Skip to January' : 'Skip to the end'}
              </button>
            </div>
          )}
        </div>
        <RunningStrip results={results} upTo={pb.revealed} />
        {latest && !(j && pb.done) && <GameCard r={latest} opponent={opponent(latest.opponentId)} />}
        {j && pb.done && <JanuaryWindow game={game} u={u} j={j} />}
        {!j && pb.done && (
          <div className="panel col" data-testid="playback-end">
            <b>Full time on the season: {ordinal(game.quickResult?.position ?? 0)}, {game.quickResult?.points ?? 0} points.</b>
            <button className="btn primary big" onClick={endPlayback} data-testid="playback-summary">
              See the summary
            </button>
          </div>
        )}
        <GameByGame results={results} opponent={opponent} replay={pb} compact strip={false} title="Game by game" />
      </div>
    </div>
  )
}

/** The January window card: the budget, three to five listings, one deal or a pass, and the tactics for the second half. */
function JanuaryWindow({ game, u, j }: { game: Game; u: LoadedUniverse; j: QuickJanuary }) {
  const { closeJanuary, setTactics, setCaptain } = useStore()
  const [chosen, setChosen] = useState<number | null>(null)
  const [tactics, setShowTactics] = useState(false)
  const get = playerLookup(game, u)
  const hide = ratingsHidden(game.settings.rules)
  const formation = getFormation(game.tactics.formationId)
  const slotOf = (slotId: string) => formation.slots.find((x) => x.id === slotId)
  const xi = Object.values(game.lineup)
    .map((id) => get(id))
    .filter((p): p is PlayerSeason => !!p)
  const pick = chosen === null ? null : j.listings[chosen]
  return (
    <div className="panel col" data-testid="january-window">
      <div className="panel-head">
        <h3>January window</h3>
        <span className="chip">Budget {money(j.budget)}</span>
      </div>
      <p className="help" style={{ margin: 0 }}>
        {ordinal(j.position)} after {j.afterMatchweek} games. The board backs one deal: sign a player with the budget, swap one of your XI for him, or pass. It can help or hurt, and there is no undo.
      </p>
      {j.listings.length === 0 && <div className="notice">Nobody fits this wheel's rules this January.</div>}
      <div className="col" style={{ gap: 6 }}>
        {j.listings.map((l, i) => {
          const incoming = get(l.playerSeasonId)
          const out = get(l.outId)
          const slot = slotOf(l.slotId)
          if (!incoming || !out || !slot) return null
          const gain = Math.round(ratingAt(incoming, slot.position) - ratingAt(out, slot.position))
          return (
            <div key={`${l.playerSeasonId}-${l.slotId}`} className={`jw-deal ${chosen === i ? 'selected' : ''}`} data-testid="january-listing">
              <PlayerRow p={incoming} showClub hideRatings={hide} selected={chosen === i} onClick={() => setChosen(chosen === i ? null : i)} right={<span className={`chip ${l.kind === 'sign' ? '' : 'gold'}`}>{l.kind === 'sign' ? money(l.fee) : 'Swap'}</span>} />
              <div className="small muted jw-out">
                <Pos p={slot.position} /> {l.kind === 'sign' ? 'Replaces' : 'In exchange for'} {out.name}
                {!hide && ` · ${gain >= 0 ? '+' : ''}${gain} in that slot`}
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className="fold-head" onClick={() => setShowTactics(!tactics)} aria-expanded={tactics} data-testid="january-tactics-toggle">
        <b>Second-half tactics</b>
        <span className="small muted">{tactics ? 'Hide ▴' : 'Change ▾'}</span>
      </button>
      {tactics && (
        <div className="col">
          <TeamInstructions t={game.tactics} onChange={setTactics} />
          <CaptainAndPenalties xi={xi} captainId={game.captainId} penalties={game.tactics.setPieces?.penalties} onCaptain={(id) => setCaptain(id ?? '')} onPenalties={(id) => setTactics({ setPieces: { ...game.tactics.setPieces, penalties: id } })} hideRatings={hide} />
        </div>
      )}
      <div className="row wrap" style={{ gap: 10 }}>
        <button className="btn primary" disabled={!pick} onClick={() => chosen !== null && closeJanuary(chosen)} data-testid="january-deal">
          {pick ? (pick.kind === 'sign' ? `Sign ${get(pick.playerSeasonId)?.name ?? ''} and play on` : `Do the swap and play on`) : 'Choose a deal'}
        </button>
        <button className="btn" onClick={() => closeJanuary(null)} data-testid="january-pass">
          Pass and play on
        </button>
      </div>
    </div>
  )
}
