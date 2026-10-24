import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { continentalRun } from '@game/logic/week'
import { TIER_LABEL, USER_TEAM, computeTable } from '@engine/season'
import { shareText } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { Pitch } from '../components/Pitch'
import { TableView } from '../components/TableView'
import { ClubBadge, Rating, Stat } from '../components/bits'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, money, ordinal, seasonLabel } from '../format'
import { playerLookup, squadPlayers } from '@game/logic/players'
import type { TableRow } from '@engine/types'
import { downloadDataUrl, renderShareCard } from '../shareCard'

export function Summary() {
  const { universe: u, game, go, startGame, nextSeason, abandonGame, showToast, acceptJob } = useStore()
  const [copied, setCopied] = useState(false)
  if (!u || !game) return null
  const get = playerLookup(game, u)
  const q = game.quickResult
  const season = game.season
  const last = game.history.at(-1)
  const tier = game.tier ?? 'MID_TABLE'
  const record = q ? { won: q.won, drawn: q.drawn, lost: q.lost, points: q.points, position: q.position, goalsFor: q.goalsFor, goalsAgainst: q.goalsAgainst } : last ? { won: last.won, drawn: last.drawn, lost: last.lost, points: last.points, position: last.position, goalsFor: last.goalsFor, goalsAgainst: last.goalsAgainst } : null
  if (!record) return null
  const table: TableRow[] = useMemo(() => {
    if (q) return q.table.map((r) => ({ ...r, played: (q.table.length - 1) * 2, form: [] }))
    if (season) return computeTable(season.fixtures, [USER_TEAM, ...Object.keys(season.ai)])
    return []
  }, [q, season])
  const formation = getFormation(game.tactics.formationId)
  const row: TableRow = { teamId: USER_TEAM, played: 38, won: record.won, drawn: record.drawn, lost: record.lost, goalsFor: record.goalsFor, goalsAgainst: record.goalsAgainst, points: record.points, form: [] }
  const text = shareText({
    teamName: game.settings.teamName,
    tier,
    row,
    position: record.position,
    cupWon: season?.cupWon ?? false,
    continentalWon: season?.continental?.won ?? false,
    leagueSeason: game.settings.leagueSeason,
    hostClubName: clubName(u, game.settings.hostClubId),
    mode: game.settings.mode === 'quick' ? 'Quick Draft' : game.settings.mode === 'daily' ? `Daily ${game.settings.seed.replace('daily-', '')}` : game.settings.mode === 'season' ? 'Season' : `Dynasty Y${game.year}`,
    seed: game.settings.mode === 'daily' ? undefined : game.settings.seed,
    potsName: q ? get(q.pots?.playerSeasonId ?? '')?.name : game.awards?.playerOfTheSeason?.name,
    bootName: q ? get(q.topScorer?.playerSeasonId ?? '')?.name : game.awards?.goldenBoot?.name,
    bootGoals: q ? q.topScorer?.goals : game.awards?.goldenBoot ? Number(game.awards.goldenBoot.value.split(' ')[0]) : undefined,
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast('Could not copy. Select the text manually.')
    }
  }
  const squad = squadPlayers(game, u)
  const isManage = game.settings.mode === 'season' || game.settings.mode === 'dynasty'
  // How the club you replaced actually did that season, when a complete real table exists
  const realRow = useMemo(() => {
    const cs = u.clubSeasonByKey[`${game.settings.hostClubId}@${game.settings.leagueSeason}`]
    if (!cs?.complete) return null
    return u.tables[game.settings.leagueId]?.[game.settings.leagueSeason]?.find((r) => r.clubId === game.settings.hostClubId) ?? null
  }, [u, game.settings.hostClubId, game.settings.leagueSeason, game.settings.leagueId])
  const [cardUrl, setCardUrl] = useState<string | null>(null)
  const makeCard = () => {
    try {
      const url = renderShareCard({
        title: game.settings.teamName,
        subtitle: `as ${clubName(u, game.settings.hostClubId)} · ${u.leagues.find((l) => l.id === game.settings.leagueId)?.name ?? ''} ${seasonLabel(game.settings.leagueSeason)}`,
        tier,
        row,
        position: record.position,
        formation,
        lineup: game.lineup,
        getPlayer: get,
        footer: game.settings.mode === 'daily' ? `Daily challenge ${game.settings.seed.replace('daily-', '')}` : `Seed ${game.settings.seed}`,
      })
      setCardUrl(url)
      downloadDataUrl(url, `touchline-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast('Could not render the share card.')
    }
  }

  return (
    <div className="page">
      <div className="tier-banner">
        <div className="muted small">
          {game.settings.teamName} as {clubName(u, game.settings.hostClubId)} · {seasonLabel(game.settings.leagueSeason)} · {game.settings.mode === 'dynasty' ? `Dynasty year ${game.year}` : game.settings.mode === 'quick' ? 'Quick draft' : game.settings.mode === 'daily' ? 'Daily challenge' : 'Season'}
        </div>
        <div className={`tier ${tier}`}>{TIER_LABEL[tier]}</div>
        {season?.cupWon && <div className="chip gold" style={{ marginTop: 6 }}>🏆 Cup winners</div>}
        {season?.continental?.won && <div className="chip gold" style={{ marginTop: 6 }}>🌍 Continental champions</div>}
        {season?.continental && !season.continental.won && <div className="chip" style={{ marginTop: 6 }}>Continental Cup: {{ R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }[continentalRun(season) ?? 'R16']}</div>}
        {season?.sacked && <div className="chip bad" style={{ marginTop: 6 }}>Sacked</div>}
        <div className="record">
          <span className="w">{record.won}W</span>
          <span className="d">{record.drawn}D</span>
          <span className="l">{record.lost}L</span>
        </div>
        {realRow && (
          <div className="small muted" style={{ marginTop: 8 }}>
            The real {clubName(u, game.settings.hostClubId)} finished {ordinal(realRow.position)} with {realRow.points} points that season.{' '}
            {record.position < realRow.position ? `You beat them by ${realRow.position - record.position} place${realRow.position - record.position === 1 ? '' : 's'}.` : record.position === realRow.position ? 'Same place, different squad.' : `They did better, by ${record.position - realRow.position} place${record.position - realRow.position === 1 ? '' : 's'}.`}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', gap: 24, marginTop: 10 }}>
          <Stat label="Points" value={record.points} />
          <Stat label="Finished" value={ordinal(record.position)} />
          <Stat label="Goals" value={`${record.goalsFor}-${record.goalsAgainst}`} />
          {q && <Stat label="Team rating" value={q.strength.overall.toFixed(1)} />}
        </div>
        <div className="blocks" aria-hidden="true">
          {Array.from({ length: record.won }, (_, i) => (
            <span key={`w${i}`} style={{ background: 'var(--accent)' }} />
          ))}
          {Array.from({ length: record.drawn }, (_, i) => (
            <span key={`d${i}`} style={{ background: '#cfd8d2' }} />
          ))}
          {Array.from({ length: record.lost }, (_, i) => (
            <span key={`l${i}`} style={{ background: 'var(--danger)' }} />
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={copy}>
            {copied ? 'Copied!' : 'Copy result to share'}
          </button>
          <button className="btn" onClick={makeCard}>
            Download share card
          </button>
          {!isManage && (
            <button className="btn" onClick={() => startGame({ ...game.settings, seed: game.settings.mode === 'daily' ? game.settings.seed : Math.random().toString(36).slice(2, 10).toUpperCase() })} disabled={game.settings.mode === 'daily'}>
              Draft again
            </button>
          )}
          {game.settings.mode === 'dynasty' && !season?.sacked && (
            <button className="btn primary" onClick={() => nextSeason()}>
              {game.pendingMove ? `Join ${clubName(u, game.pendingMove.clubId)} →` : `Continue with ${clubName(u, game.settings.hostClubId)} →`}
            </button>
          )}
          {isManage && (
            <button className="btn" onClick={() => go('game')} disabled>
              Season complete
            </button>
          )}
          <button className="btn ghost" onClick={() => { abandonGame(); go('home') }}>
            New game
          </button>
        </div>
      </div>

      {game.jobOffers.length > 0 && (
        <div className="panel" style={{ marginTop: 14, borderColor: 'var(--gold)' }}>
          <div className="panel-head">
            <h3 style={{ color: 'var(--gold)' }}>Job offers</h3>
            <span className="small muted">Your work has been noticed. Stay, or take your squad somewhere new next season.</span>
          </div>
          <div className="grid three">
            {game.jobOffers.map((o, i) => {
              const chosen = game.pendingMove?.clubId === o.clubId
              return (
                <div key={o.clubId} className="card" style={chosen ? { borderColor: 'var(--accent)' } : undefined}>
                  <div className="row" style={{ gap: 10 }}>
                    <ClubBadge clubId={o.clubId} size={40} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{clubName(u, o.clubId)}</div>
                      <div className="small muted">{u.leagues.find((l) => l.id === o.leagueId)?.name ?? o.leagueId} · +{money(o.budgetBonus)} budget</div>
                    </div>
                  </div>
                  <p className="small" style={{ margin: '8px 0' }}>{o.pitch}</p>
                  <button className={`btn sm ${chosen ? '' : 'primary'}`} onClick={() => acceptJob(chosen ? null : i)}>
                    {chosen ? 'Change your mind' : 'Accept'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="col">
          <div className="panel">
            <h3>Your XI</h3>
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} showRoles={Object.fromEntries(formation.slots.map((s) => [s.id, s.position]))} />
            {q && (
              <div className="kv" style={{ marginTop: 10 }}>
                <dt>Goalkeeping</dt>
                <dd>{q.strength.goalkeeping.toFixed(0)}</dd>
                <dt>Defence</dt>
                <dd>{q.strength.defence.toFixed(0)}</dd>
                <dt>Midfield</dt>
                <dd>{q.strength.midfield.toFixed(0)}</dd>
                <dt>Attack</dt>
                <dd>{q.strength.attack.toFixed(0)}</dd>
                <dt>Balance</dt>
                <dd>{Math.round(q.strength.balance * 100)}%</dd>
                <dt>Chemistry</dt>
                <dd>{q.strength.chemistry >= 0 ? '+' : ''}{q.strength.chemistry}</dd>
              </div>
            )}
          </div>
          <div className="panel">
            <h3>Awards</h3>
            {q && (
              <div className="col">
                {q.pots && get(q.pots.playerSeasonId) && <PlayerRow p={get(q.pots.playerSeasonId)!} showClub right={<span className="chip gold">⭐ Player of the season · {q.pots.rating}</span>} />}
                {q.topScorer && get(q.topScorer.playerSeasonId) && <PlayerRow p={get(q.topScorer.playerSeasonId)!} showClub right={<span className="chip good">⚽ {q.topScorer.goals} goals</span>} />}
              </div>
            )}
            {game.awards && (
              <div className="col">
                {game.awards.playerOfTheSeason && get(game.awards.playerOfTheSeason.playerSeasonId) && <PlayerRow p={get(game.awards.playerOfTheSeason.playerSeasonId)!} showClub right={<span className="chip gold">⭐ Player of the season · {game.awards.playerOfTheSeason.value}</span>} />}
                {game.awards.goldenBoot && get(game.awards.goldenBoot.playerSeasonId) && <PlayerRow p={get(game.awards.goldenBoot.playerSeasonId)!} showClub right={<span className="chip good">👟 {game.awards.goldenBoot.value}</span>} />}
                {game.awards.playmaker && get(game.awards.playmaker.playerSeasonId) && <PlayerRow p={get(game.awards.playmaker.playerSeasonId)!} showClub right={<span className="chip">🎯 {game.awards.playmaker.value}</span>} />}
                {game.awards.goldenGlove && get(game.awards.goldenGlove.playerSeasonId) && <PlayerRow p={get(game.awards.goldenGlove.playerSeasonId)!} showClub right={<span className="chip">🧤 {game.awards.goldenGlove.value}</span>} />}
                {game.awards.youngPlayer && get(game.awards.youngPlayer.playerSeasonId) && <PlayerRow p={get(game.awards.youngPlayer.playerSeasonId)!} showClub right={<span className="chip">🌱 {game.awards.youngPlayer.value}</span>} />}
              </div>
            )}
          </div>
          {isManage && (
            <div className="panel">
              <h3>Squad statistics</h3>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Apps</th>
                    <th className="num">G</th>
                    <th className="num">A</th>
                    <th className="num">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {squad
                    .filter((x) => x.s.seasonStats.apps > 0)
                    .sort((a, b) => b.s.seasonStats.ratingSum / b.s.seasonStats.apps - a.s.seasonStats.ratingSum / a.s.seasonStats.apps)
                    .map((x) => (
                      <tr key={x.p.id}>
                        <td>
                          <span className="row" style={{ gap: 6 }}>
                            <Rating value={x.p.overall} /> {x.p.name}
                          </span>
                        </td>
                        <td className="num">{x.s.seasonStats.apps}</td>
                        <td className="num">{x.s.seasonStats.goals}</td>
                        <td className="num">{x.s.seasonStats.assists}</td>
                        <td className="num">{(x.s.seasonStats.ratingSum / x.s.seasonStats.apps).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="col">
          <div className="panel">
            <h3>Final table · {seasonLabel(game.settings.leagueSeason)}</h3>
            <TableView rows={table} teamName={game.settings.teamName} compact={!!q} highlightTop />
          </div>
          {isManage && (
            <div className="panel">
              <h3>Finances</h3>
              <div className="kv">
                <dt>Budget now</dt>
                <dd>{money(game.finances.budget)}</dd>
                <dt>Income</dt>
                <dd>{money(game.finances.income)}</dd>
                <dt>Spent on transfers</dt>
                <dd>{money(game.finances.spent)}</dd>
                <dt>Wages paid</dt>
                <dd>{money(game.finances.wagesPaid)}</dd>
              </div>
            </div>
          )}
          {game.history.length > 1 && (
            <div className="panel">
              <h3>Dynasty history</h3>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>League</th>
                    <th>As</th>
                    <th className="num">Pos</th>
                    <th className="num">Pts</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {game.history.map((h) => (
                    <tr key={h.year}>
                      <td>{h.year}</td>
                      <td>{seasonLabel(h.leagueSeason)}</td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          <ClubBadge clubId={h.hostClubId} size={20} />
                          {clubName(u, h.hostClubId)}
                        </span>
                      </td>
                      <td className="num">{ordinal(h.position)}</td>
                      <td className="num">{h.points}</td>
                      <td>
                        {TIER_LABEL[h.tier]}
                        {h.cupWon ? ' + Cup' : ''}
                        {h.continentalWon ? ' + Europe' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cardUrl && (
            <div className="panel">
              <h3>Share card</h3>
              <img src={cardUrl} alt="Share card" style={{ width: '100%', borderRadius: 10 }} />
            </div>
          )}
          <div className="panel">
            <h3>Share text</h3>
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-2)' }}>
              {text}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
