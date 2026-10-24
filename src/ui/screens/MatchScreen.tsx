import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { MatchTicker } from '../components/MatchTicker'
import { ClubBadge, Pos, Rating, Segmented, Tabs } from '../components/bits'
import { clubName, minuteLabel } from '../format'
import { playerLookup } from '@game/logic/players'
import { onPitch, type FullMatchResult, type TeamTalk } from '@engine/match'
import type { MatchContext } from '@game/types'
import { USER_TEAM } from '@engine/season'
import type { Tactics } from '@engine/types'
import { LINE_HELP, MENTALITY_HELP, PRESSING_HELP, TEMPO_HELP } from '@engine/tactics'
import { isAvailable } from '@game/logic/players'

export function MatchScreen() {
  const store = useStore()
  const { universe: u, game, matchView, setMatchView, closeMatch } = store
  const [which, setWhich] = useState<'league' | 'cup'>('league')
  /** After the second half is played, the ticker resumes from 46'. */
  const [resumeFrom, setResumeFrom] = useState(0)
  /** When a cup tie follows the league match, hold it until the league result has been seen. */
  const [holdLive, setHoldLive] = useState(false)
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const live = game.live && !holdLive ? game.live : null

  // Live (first half) view
  if (live) {
    const mp = live.mp
    const homeName = mp.home.teamName
    const awayName = mp.away.teamName
    return (
      <div className="page">
        <div className="row between wrap" style={{ marginBottom: 10 }}>
          <div>
            <h2>
              {live.ctx.roundLabel ?? (live.ctx.competition === 'cup' ? 'Cup' : `Matchweek ${live.ctx.matchweek}`)}
              {live.ctx.importanceLabel ? ` · ${live.ctx.importanceLabel}` : ''}
            </h2>
            <div className="small muted">
              {homeName} v {awayName} · live
            </div>
          </div>
        </div>
        <LiveFirstHalf key={`${live.kind}-${live.ctx.matchweek}-${live.opponentId}`} homeName={homeName} awayName={awayName} onPlayed={() => { setResumeFrom(46); setHoldLive(true); setMatchView('ticker') }} />
      </div>
    )
  }

  if (!game.lastMatch || !game.lastMatchContext) return null
  const res = which === 'cup' && game.lastCupMatch ? game.lastCupMatch : game.lastMatch
  const ctx = which === 'cup' && game.lastCupContext ? game.lastCupContext : game.lastMatchContext
  const homeName = res.homeTeamId === USER_TEAM ? game.settings.teamName : res.homeName ?? clubName(u, res.homeTeamId)
  const awayName = res.awayTeamId === USER_TEAM ? game.settings.teamName : res.awayName ?? clubName(u, res.awayTeamId)
  const userIsHome = res.homeTeamId === USER_TEAM
  const gf = userIsHome ? res.homeGoals : res.awayGoals
  const ga = userIsHome ? res.awayGoals : res.homeGoals
  const outcome = gf > ga ? 'Win' : gf === ga ? 'Draw' : 'Defeat'
  const seasonOver = game.phase === 'summary'
  const cupNext = !!game.live && holdLive
  const continueLabel = seasonOver ? 'Season summary →' : cupNext ? `Next: ${game.live!.ctx.roundLabel ?? 'cup tie'} →` : 'Continue →'
  const onContinue = () => {
    if (seasonOver) {
      store.go('game')
      return
    }
    if (cupNext) {
      setHoldLive(false)
      setResumeFrom(0)
      setMatchView('ticker')
      return
    }
    setResumeFrom(0)
    closeMatch()
  }

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

      {matchView === 'ticker' && <MatchTicker key={res.homeTeamId + res.awayTeamId + ctx.matchweek + which + resumeFrom} events={res.events} homeName={homeName} awayName={awayName} startClock={resumeFrom} onDone={() => setMatchView('report')} />}
      {matchView === 'report' && <Report res={res} ctx={ctx} homeName={homeName} awayName={awayName} outcome={outcome} get={get} />}
    </div>
  )
}

function LiveFirstHalf({ homeName, awayName, onPlayed }: { homeName: string; awayName: string; onPlayed: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [atHalfTime, setAtHalfTime] = useState(false)
  const [talk, setTalk] = useState<TeamTalk>('encourage')
  const [tactics, setTactics] = useState<Tactics | null>(null)
  const [subs, setSubs] = useState<Array<{ off: string; on: string }>>([])
  const [subbingOff, setSubbingOff] = useState<string | null>(null)
  if (!u || !game?.live) return null
  const live = game.live
  const mp = live.mp
  const get = playerLookup(game, u)
  const side: 'home' | 'away' = live.userIsHome ? 'home' : 'away'
  const us = live.userIsHome ? mp.halfTimeScore.home : mp.halfTimeScore.away
  const them = live.userIsHome ? mp.halfTimeScore.away : mp.halfTimeScore.home
  const t = tactics ?? game.tactics
  const pitch = onPitch(mp, side)
  const subbedOn = new Set(subs.map((s) => s.on))
  const subbedOff = new Set(subs.map((s) => s.off))
  const benchOptions = game.bench.filter((id) => !pitch.some((p) => p.psId === id) && !subbedOn.has(id) && isAvailable(game.squad[id]))
  const play = () => {
    store.finishLive({ talk, tactics: tactics ?? undefined, substitutions: subs })
    onPlayed()
  }
  return (
    <div className="col">
      <MatchTicker events={mp.events} homeName={homeName} awayName={awayName} stopAt={45} onHalfTime={() => setAtHalfTime(true)} />
      {atHalfTime && (
        <div className="panel" style={{ borderColor: 'var(--accent)' }}>
          <div className="panel-head">
            <h2>Half time: {us > them ? 'ahead' : us < them ? 'behind' : 'level'}</h2>
            <span className="small muted">Make your changes, then play the second half.</span>
          </div>
          <div className="grid two">
            <div className="col">
              <div className="field">
                Team talk
                <Segmented<TeamTalk>
                  value={talk}
                  onChange={setTalk}
                  options={[
                    { value: 'calm', label: 'Calm', hint: 'Protects a lead' },
                    { value: 'encourage', label: 'Encourage', hint: 'Safe lift' },
                    { value: 'demand', label: 'Demand', hint: 'Sharpens a level game, risky when behind' },
                    { value: 'fire-up', label: 'Fire up', hint: 'Best when behind, risky when ahead' },
                  ]}
                />
              </div>
              <div className="field">
                Mentality <span className="help">{MENTALITY_HELP[t.mentality]}</span>
                <Segmented value={t.mentality} onChange={(v) => setTactics({ ...t, mentality: v })} options={[{ value: 'defensive', label: 'Defensive' }, { value: 'balanced', label: 'Balanced' }, { value: 'attacking', label: 'Attacking' }]} />
              </div>
              <div className="field">
                Pressing <span className="help">{PRESSING_HELP[t.pressing]}</span>
                <Segmented value={t.pressing} onChange={(v) => setTactics({ ...t, pressing: v })} options={[{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }]} />
              </div>
              <div className="field">
                Defensive line <span className="help">{LINE_HELP[t.defensiveLine]}</span>
                <Segmented value={t.defensiveLine} onChange={(v) => setTactics({ ...t, defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
              </div>
              <div className="field">
                Tempo <span className="help">{TEMPO_HELP[t.tempo]}</span>
                <Segmented value={t.tempo} onChange={(v) => setTactics({ ...t, tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
              </div>
            </div>
            <div className="col">
              <div className="row between">
                <span style={{ fontWeight: 600 }}>Substitutions ({subs.length}/3 at the break)</span>
                {subbingOff && (
                  <button className="btn sm" onClick={() => setSubbingOff(null)}>
                    Cancel
                  </button>
                )}
              </div>
              {subbingOff ? (
                <div className="plist">
                  <div className="small muted">Bring on for {get(subbingOff)?.name}:</div>
                  {benchOptions.map((id) => {
                    const p = get(id)
                    if (!p) return null
                    return (
                      <button key={id} className="prow" onClick={() => { setSubs([...subs, { off: subbingOff, on: id }]); setSubbingOff(null) }}>
                        <Rating value={p.overall} />
                        <span className="name">
                          {p.name}{' '}
                          {p.positions.map((x) => (
                            <Pos key={x} p={x} />
                          ))}
                          <span className="muted small">condition {game.squad[id]?.condition}</span>
                        </span>
                        <span className="btn sm primary">On</span>
                      </button>
                    )
                  })}
                  {benchOptions.length === 0 && <div className="muted small">Nobody available on the bench.</div>}
                </div>
              ) : (
                <div className="plist">
                  {pitch
                    .filter((p) => !subbedOff.has(p.psId))
                    .map((p) => {
                      const ps = get(p.psId)
                      const sub = subs.find((s) => s.on === p.psId)
                      return (
                        <div key={p.psId} className="prow" style={{ cursor: 'default' }}>
                          {ps ? <Rating value={ps.overall} /> : <span />}
                          <span className="name">
                            <Pos p={p.position} /> {ps?.name}
                            {p.yellow && ' 🟨'}
                            {p.goals > 0 && ` ⚽${p.goals > 1 ? p.goals : ''}`}
                            {sub && <span className="chip good">on at HT</span>}
                            <span className="muted small">cond {game.squad[p.psId]?.condition ?? '–'}</span>
                          </span>
                          {subs.length < 3 && !sub && (
                            <button className="btn sm" onClick={() => setSubbingOff(p.psId)}>
                              Off
                            </button>
                          )}
                        </div>
                      )
                    })}
                  {subs.map((s) => (
                    <div key={s.on} className="small muted">
                      {get(s.on)?.name} replaces {get(s.off)?.name}{' '}
                      <button className="btn sm ghost" onClick={() => setSubs(subs.filter((x) => x !== s))}>
                        undo
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary big" onClick={play}>
              Play the second half
            </button>
            <button className="btn ghost" onClick={() => { setTactics(null); setSubs([]); store.finishLive({ talk: 'none' }); onPlayed() }}>
              No changes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Report({ res, ctx, homeName, awayName, outcome, get }: { res: FullMatchResult; ctx: MatchContext; homeName: string; awayName: string; outcome: string; get: (id: string) => ReturnType<ReturnType<typeof playerLookup>> }) {
  const u = useStore((s) => s.universe)
  const game = useStore((s) => s.game)
  const userIsHome = res.homeTeamId === USER_TEAM
  const ours = userIsHome ? res.homeReport : res.awayReport
  const theirs = userIsHome ? res.awayReport : res.homeReport
  const goals = useMemo(() => res.events.filter((e) => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal'), [res.events])
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
        {game && u && ctx.competition === 'league' && ctx.roundLabel !== 'Friendly' && (
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
