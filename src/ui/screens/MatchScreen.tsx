import { useState } from 'react'
import { useStore } from '@game/store'
import { MatchTicker } from '../components/MatchTicker'
import { ClubBadge, Rating, Tabs } from '../components/bits'
import { clubName, minuteLabel } from '../format'
import { playerLookup } from '@game/logic/players'
import type { FullMatchResult } from '@engine/match'
import type { MatchContext } from '@game/types'
import { USER_TEAM } from '@engine/season'

export function MatchScreen() {
  const store = useStore()
  const { universe: u, game, matchView, setMatchView, closeMatch } = store
  const [which, setWhich] = useState<'league' | 'cup'>('league')
  if (!u || !game || !game.lastMatch || !game.lastMatchContext) return null
  const get = playerLookup(game, u)
  const res = which === 'cup' && game.lastCupMatch ? game.lastCupMatch : game.lastMatch
  const ctx = which === 'cup' && game.lastCupContext ? game.lastCupContext : game.lastMatchContext
  const homeName = res.homeTeamId === USER_TEAM ? game.settings.teamName : res.homeName ?? clubName(u, res.homeTeamId)
  const awayName = res.awayTeamId === USER_TEAM ? game.settings.teamName : res.awayName ?? clubName(u, res.awayTeamId)
  const userIsHome = res.homeTeamId === USER_TEAM
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const outcome = gf > ga ? 'Win' : gf === ga ? 'Draw' : 'Defeat'
  const seasonOver = game.phase === 'summary'

  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <div>
          <h2>
            {ctx.roundLabel ?? (ctx.competition === 'cup' ? 'Cup' : `Matchweek ${ctx.matchweek}`)}
            {ctx.importanceLabel ? ` · ${ctx.importanceLabel}` : ''}
          </h2>
          <div className="small muted">
            {homeName} v {awayName}
          </div>
        </div>
        <div className="row">
          {game.lastCupMatch && (
            <div className="segmented">
              <button className={which === 'league' ? 'active' : ''} onClick={() => setWhich('league')}>
                League
              </button>
              <button className={which === 'cup' ? 'active' : ''} onClick={() => setWhich('cup')}>
                Cup
              </button>
            </div>
          )}
          <button className="btn primary" onClick={() => (seasonOver ? store.go('game') : closeMatch())}>
            {seasonOver ? 'Season summary →' : 'Continue →'}
          </button>
        </div>
      </div>

      <Tabs value={matchView} onChange={setMatchView} tabs={[{ id: 'ticker' as const, label: 'Live' }, { id: 'report' as const, label: 'Report' }]} />

      {matchView === 'ticker' && <MatchTicker key={res.homeTeamId + res.awayTeamId + ctx.matchweek + which} result={res} homeName={homeName} awayName={awayName} onDone={() => setMatchView('report')} />}
      {matchView === 'report' && <Report res={res} ctx={ctx} homeName={homeName} awayName={awayName} outcome={outcome} get={get} />}
    </div>
  )
}

function Report({ res, ctx, homeName, awayName, outcome, get }: { res: FullMatchResult; ctx: MatchContext; homeName: string; awayName: string; outcome: string; get: (id: string) => ReturnType<ReturnType<typeof playerLookup>> }) {
  const u = useStore((s) => s.universe)
  const game = useStore((s) => s.game)
  const userIsHome = res.homeTeamId === USER_TEAM
  const ours = userIsHome ? res.homeReport : res.awayReport
  const theirs = userIsHome ? res.awayReport : res.homeReport
  const goals = res.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')
  return (
    <div className="grid two">
      <div className="col">
        <div className="scoreboard">
          <div className="team">
            {res.homeTeamId !== USER_TEAM && <ClubBadge clubId={res.homeTeamId.replace(/^friendly-/, '')} size={34} />}
            {homeName}
          </div>
          <div className="col" style={{ alignItems: 'center', gap: 2 }}>
            <div className="score">
              {res.homeGoals} - {res.awayGoals}
            </div>
            <div className="clock">{outcome.toUpperCase()}</div>
          </div>
          <div className="team away">
            {awayName}
            {res.awayTeamId !== USER_TEAM && <ClubBadge clubId={res.awayTeamId.replace(/^friendly-/, '')} size={34} />}
          </div>
        </div>
        <div className="panel">
          <h3>Goals</h3>
          {goals.length === 0 && <div className="muted small">No goals.</div>}
          <div className="col" style={{ gap: 4 }}>
            {goals.map((g, i) => (
              <div key={i} className="row between small">
                <span>
                  {g.side === 'home' ? '⚽ ' : ''}
                  {g.playerName}
                  {g.type === 'penalty' ? ' (pen)' : g.type === 'own_goal' ? ' (og)' : ''}
                  {g.secondaryName ? <span className="muted"> · {g.secondaryName}</span> : null}
                  {g.side === 'away' ? ' ⚽' : ''}
                </span>
                <span className="mono muted">{minuteLabel(g.minute)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Match stats</h3>
          <table className="tbl">
            <tbody>
              <tr>
                <td className="num">{res.homeReport.xg.toFixed(2)}</td>
                <th style={{ textAlign: 'center' }}>Expected goals</th>
                <td>{res.awayReport.xg.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="num">{res.homeReport.possession}%</td>
                <th style={{ textAlign: 'center' }}>Possession</th>
                <td>{res.awayReport.possession}%</td>
              </tr>
              <tr>
                <td className="num">
                  {res.homeReport.shots} ({res.homeReport.shotsOnTarget})
                </td>
                <th style={{ textAlign: 'center' }}>Shots (on target)</th>
                <td>
                  {res.awayReport.shots} ({res.awayReport.shotsOnTarget})
                </td>
              </tr>
              <tr>
                <td className="num">{res.homeReport.strength.overall.toFixed(1)}</td>
                <th style={{ textAlign: 'center' }}>Team rating</th>
                <td>{res.awayReport.strength.overall.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Tactical notes</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {ours.teamTalkEffect && <li>{ours.teamTalkEffect}</li>}
            {ours.modifiers.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {theirs.modifiers.notes.length > 0 && <li className="muted">Opponent: {theirs.modifiers.notes.slice(0, 2).join('; ')}</li>}
          </ul>
          <div className="small muted" style={{ marginTop: 6 }}>
            Our attack ×{ours.modifiers.attack.toFixed(2)}, their chances ×{ours.modifiers.defence.toFixed(2)} from instructions. Extra fatigue {ours.modifiers.fatigue > 0 ? '+' : ''}
            {ours.modifiers.fatigue}.
          </div>
        </div>
      </div>
      <div className="col">
        <div className="panel">
          <h3>Player ratings</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Min</th>
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
                          {s.yellow && ' 🟨'}
                          {s.red && ' 🟥'}
                          {s.injured && ' 🩹'}
                          {res.motmId === s.playerSeasonId && <span className="chip gold">MOTM</span>}
                        </span>
                      </td>
                      <td className="num">{s.minutes}</td>
                      <td className="num">{s.goals}</td>
                      <td className="num">{s.assists}</td>
                      <td className="num" style={{ fontWeight: 700, color: s.rating >= 7.5 ? 'var(--accent)' : s.rating < 6 ? 'var(--danger)' : undefined }}>
                        {s.rating.toFixed(1)}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
          {ours.substitutions.length > 0 && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Subs: {ours.substitutions.map((s) => `${get(s.on)?.name} for ${get(s.off)?.name} (${s.minute}', ${s.reason})`).join('; ')}
            </div>
          )}
        </div>
        {game && u && ctx.competition === 'league' && (
          <div className="panel">
            <h3>Opponent</h3>
            <div className="row" style={{ gap: 10 }}>
              <ClubBadge clubId={ctx.opponentClubId} size={40} />
              <div>
                <div style={{ fontWeight: 600 }}>{clubName(u, ctx.opponentClubId)}</div>
                <div className="small muted">
                  Team rating {theirs.strength.overall.toFixed(1)} · GK {theirs.strength.goalkeeping.toFixed(0)} DEF {theirs.strength.defence.toFixed(0)} MID {theirs.strength.midfield.toFixed(0)} ATT {theirs.strength.attack.toFixed(0)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
