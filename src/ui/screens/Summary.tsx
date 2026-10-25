import { useMemo, useState } from 'react'
import { useStore } from '@game/store'
import { continentalRun } from '@game/logic/week'
import { TIER_LABEL, USER_TEAM, computeTable } from '@engine/season'
import { shareText } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { benchmarkSeason, hasRecordBook, realChampion, recordShareLine, type RecordMetric } from '@engine/records'
import { Pitch } from '../components/Pitch'
import { TWIST_INFO } from '../components/TwistCard'
import type { Twist } from '@engine/draft'
import { TableView } from '../components/TableView'
import { ClubBadge, Rating, Stat } from '../components/bits'
import { PlayerRow } from '../components/PlayerRow'
import { clubName, flag, money, nationName, ordinal, seasonLabel, tierName } from '../format'
import { playerLookup, squadPlayers } from '@game/logic/players'
import type { TableRow } from '@engine/types'
import { downloadDataUrl, renderShareCard } from '../shareCard'
import { APP_NAME } from '../brand'
import { challengeFromGame, claimOf, verdictLine } from '@game/logic/challenge'
import { cleanName } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { randomSeed } from '@engine/rng'
import { GameByGame, RunningStrip, useSeasonReplay } from '../components/GameByGame'
import { bestWinLine } from '@game/logic/gameByGame'
import { shareLink } from '../../online/api'
import { RankedStatus } from '../online/RankedStatus'

export function Summary() {
  const { universe: u, game, go, startGame, nextSeason, abandonGame, showToast, acceptJob, loadingLeagues, profile } = useStore()
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  // The long #c= link, offered beside a short one: it works offline and without the server
  const [longLink, setLongLink] = useState<string | null>(null)
  const [shortCode, setShortCode] = useState<string | null>(null)
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
  // Every game of a quick season, game by game; the replay is UI state only
  const results = q?.results ?? []
  const replay = useSeasonReplay(results.length)
  const formation = getFormation(game.tactics.formationId)
  const row: TableRow = { teamId: USER_TEAM, played: 38, won: record.won, drawn: record.drawn, lost: record.lost, goalsFor: record.goalsFor, goalsAgainst: record.goalsAgainst, points: record.points, form: [] }
  // Where this season sits against every complete real season of the league with the same number of matches
  const leagueName = u.leagues.find((l) => l.id === game.settings.leagueId)?.name ?? game.settings.leagueId
  const bench = useMemo(() => (season?.sacked ? null : benchmarkSeason(u, game.settings.leagueId, record)), [u, game.settings.leagueId, record.won, record.drawn, record.lost, record.points, record.goalsFor, record.goalsAgainst, season?.sacked])
  const inBooks = bench !== null && hasRecordBook(bench)
  const champion = realChampion(u, game.settings.leagueId, game.settings.leagueSeason)
  const extraLines: string[] = []
  if (game.settings.rules.onlyNation) extraLines.push(`One nation: ${flag(u, game.settings.rules.onlyNation)} ${nationName(u, game.settings.rules.onlyNation)}`)
  if (game.settings.rules.twists) {
    // The twists the picks actually went through, when the draft is still on the game (quick and daily keep it)
    const landed = (game.draft?.history ?? []).flatMap((h): Twist[] => (h.pickedId && h.twist ? [h.twist] : [])).map((t) => TWIST_INFO[t].icon)
    extraLines.push(landed.length ? `Twists ${landed.join(' ')}` : 'Twists 🎲')
  }
  const recordLine = bench && inBooks ? recordShareLine(bench, leagueName) : null
  if (recordLine) extraLines.push(recordLine)
  const bestLine = bestWinLine(q?.results, (id) => clubName(u, id))
  if (bestLine) extraLines.push(bestLine)
  // Head-to-head against the ghost this game was played against
  const challenge = game.settings.challenge
  const mine = claimOf(game)
  if (challenge && mine) extraLines.push(verdictLine(challenge, mine))
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
    extraLines: extraLines.length ? extraLines : undefined,
  }, APP_NAME)
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
  // Quick mode keeps the draft after the season, so this run can be packed into a link or replayed against itself
  const canChallenge = !isManage && !!game.draft && !!q
  const challengeName = cleanName(profile.managerName) || cleanName(game.settings.teamName) || 'A friend'
  const makeChallenge = async () => {
    const c = challengeFromGame(game, u, challengeName)
    if (!c) {
      showToast('This result cannot be packed into a challenge.')
      return
    }
    // A short #s= link when signed in and online; the long #c= link otherwise (it always works)
    const share = await shareLink(c)
    const url = share.url
    setLink(url)
    setShortCode(share.code)
    setLongLink(share.code ? share.longUrl : null)
    try {
      await navigator.clipboard.writeText(url)
      showToast(share.code ? `Short link ${share.code} copied. Send it to a friend.` : `Challenge link copied (${url.length} characters). Send it to a friend.`)
    } catch {
      showToast('Could not copy. The link is below.')
    }
  }
  const runItBack = () => {
    const d = game.draft
    if (!d || !mine) return
    startGame({
      ...game.settings,
      mode: 'quick',
      challenge: {
        name: 'your ghost',
        picks: d.history.map((h) => ({ id: h.pickedId, slotId: h.pickedId ? h.slotId : null, clubId: h.clubId, season: h.season })),
        claim: mine,
        verified: 'yes',
        data: u.generatedAt,
        engine: ENGINE_VERSION,
      },
    })
  }
  const ghostLineup = useMemo(() => Object.fromEntries((challenge?.picks ?? []).flatMap((p) => (p.id && p.slotId ? [[p.slotId, p.id] as [string, string]] : []))), [challenge])
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
        {replay.playing ? (
          <div className="tier" style={{ color: 'var(--text-3)' }} data-testid="tier-pending">
            Season in play…
          </div>
        ) : (
          <div className={`tier ${tier} ${replay.used ? 'pop' : ''}`} data-testid="tier">
            {tierName(tier)}
          </div>
        )}
        {replay.playing && <RunningStrip results={results} upTo={replay.revealed} />}
        {!replay.playing && season?.cupWon && <div className="chip gold" style={{ marginTop: 6 }}>🏆 Cup winners</div>}
        {season?.continental?.won && <div className="chip gold" style={{ marginTop: 6 }}>🌍 Continental champions</div>}
        {season?.continental && !season.continental.won && <div className="chip" style={{ marginTop: 6 }}>Continental Cup: {{ R16: 'round of 16', QF: 'quarter-finals', SF: 'semi-finals', F: 'final', W: 'winners' }[continentalRun(season) ?? 'R16']}</div>}
        {season?.sacked && <div className="chip bad" style={{ marginTop: 6 }}>Sacked</div>}
        {game.settings.rules.onlyNation && <div className="chip" style={{ marginTop: 6 }}>One nation: {flag(u, game.settings.rules.onlyNation)} {nationName(u, game.settings.rules.onlyNation)}</div>}
        {season?.objectives?.length ? <div className="chip" style={{ marginTop: 6 }}>Board objectives: {season.objectives.filter((o) => o.met).length} of {season.objectives.length} met</div> : null}
        {!replay.playing && (
          <div className="record">
            <span className="w">{record.won}W</span>
            <span className="d">{record.drawn}D</span>
            <span className="l">{record.lost}L</span>
          </div>
        )}
        {!replay.playing && realRow && (
          <div className="small muted" style={{ marginTop: 8 }}>
            The real {clubName(u, game.settings.hostClubId)} finished {ordinal(realRow.position)} with {realRow.points} points that season.{' '}
            {record.position < realRow.position ? `You beat them by ${realRow.position - record.position} place${realRow.position - record.position === 1 ? '' : 's'}.` : record.position === realRow.position ? 'Same place, different squad.' : `They did better, by ${record.position - realRow.position} place${record.position - realRow.position === 1 ? '' : 's'}.`}
          </div>
        )}
        {!replay.playing && (
        <div className="row" style={{ justifyContent: 'center', gap: 24, marginTop: 10 }}>
          <Stat label="Points" value={record.points} />
          <Stat label="Finished" value={ordinal(record.position)} />
          <Stat label="Goals" value={`${record.goalsFor}-${record.goalsAgainst}`} />
          {q && <Stat label="Team rating" value={q.strength.overall.toFixed(1)} />}
        </div>
        )}
        {!replay.playing && (
        <div className="blocks" aria-hidden="true">
          {Array.from({ length: record.won }, (_, i) => (
            <span key={`w${i}`} style={{ background: 'var(--good)' }} />
          ))}
          {Array.from({ length: record.drawn }, (_, i) => (
            <span key={`d${i}`} style={{ background: 'var(--draw)' }} />
          ))}
          {Array.from({ length: record.lost }, (_, i) => (
            <span key={`l${i}`} style={{ background: 'var(--danger)' }} />
          ))}
        </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={copy}>
            {copied ? 'Copied!' : 'Copy result to share'}
          </button>
          <button className="btn" onClick={makeCard}>
            Download share card
          </button>
          {!isManage && (
            <button className="btn" onClick={() => startGame({ ...game.settings, challenge: undefined, seed: game.settings.mode === 'daily' ? game.settings.seed : randomSeed() })} disabled={game.settings.mode === 'daily'}>
              Draft again
            </button>
          )}
          {canChallenge && (
            <button className="btn" onClick={() => void makeChallenge()} data-testid="challenge-friend">
              Challenge a friend
            </button>
          )}
          {canChallenge && (
            <button className="btn" onClick={runItBack} data-testid="run-it-back" title="Draft this wheel again against your own result">
              Run it back
            </button>
          )}
          {game.settings.mode === 'dynasty' && !season?.sacked && (
            <button className="btn primary" onClick={() => nextSeason()} disabled={loadingLeagues}>
              {loadingLeagues ? 'Loading league data…' : game.pendingMove ? `Join ${clubName(u, game.pendingMove.clubId)} →` : `Continue with ${clubName(u, game.settings.hostClubId)} →`}
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

      {!replay.playing && <RankedStatus game={game} />}

      {q && results.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <GameByGame results={results} opponent={(id) => ({ clubId: id, name: clubName(u, id) })} replay={replay} />
        </div>
      )}

      {link && (
        <div className="panel" style={{ marginTop: 14 }} data-testid="challenge-link">
          <div className="panel-head">
            <h3>Challenge link</h3>
            <span className="small muted">Whoever opens it drafts the same wheel as {challengeName}, sees your pick on every spin and plays the same season. Built on data {u.generatedAt}, engine {ENGINE_VERSION}.</span>
          </div>
          <input className="input mono small" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} data-testid="challenge-link-url" />
          {shortCode && <div className="small muted" style={{ marginTop: 6 }}>Code {shortCode}: it opens on any device with a connection, signed in or not.</div>}
          {longLink && (
            <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => void navigator.clipboard?.writeText(longLink).then(() => showToast('Long link copied.'), () => setLink(longLink))}>
              Copy the long link (works offline)
            </button>
          )}
        </div>
      )}

      {challenge && mine && (
        <div className="panel" style={{ marginTop: 14 }} data-testid="head-to-head">
          <div className="panel-head">
            <h3>Head-to-head · vs {challenge.name}</h3>
            <span className="small muted">
              Same seed, same wheel.{' '}
              {challenge.verified === 'yes' && `Verified: ${challenge.name}'s picks replay to ${challenge.claim.pts} points on this data.`}
              {challenge.verified === 'unverified' && `Unverified: ${challenge.reason ?? 'built on different data'}.`}
              {challenge.verified === 'no' && `Could not verify the claim: ${challenge.reason ?? 'the picks do not replay'}.`}
            </span>
          </div>
          <div className="grid two">
            <div className="col">
              <div className="row between wrap">
                <b>{challenge.name}</b>
                <span className={`chip ${challenge.claim.pts > mine.pts ? 'good' : ''}`}>
                  {challenge.claim.pts} pts · {TIER_LABEL[challenge.claim.t]} · {challenge.claim.w}-{challenge.claim.d}-{challenge.claim.l}
                </span>
              </div>
              {challenge.picks.length ? <Pitch formation={formation} lineup={ghostLineup} getPlayer={get} /> : <div className="muted small">{challenge.name}'s picks could not be resolved on this data.</div>}
            </div>
            <div className="col">
              <div className="row between wrap">
                <b>{game.settings.teamName}</b>
                <span className={`chip ${mine.pts > challenge.claim.pts ? 'good' : ''}`}>
                  {mine.pts} pts · {TIER_LABEL[mine.t]} · {mine.w}-{mine.d}-{mine.l}
                </span>
              </div>
              <Pitch formation={formation} lineup={game.lineup} getPlayer={get} />
            </div>
          </div>
          <div className="notice" style={{ marginTop: 10 }} data-testid="verdict">
            {verdictLine(challenge, mine)}
          </div>
        </div>
      )}

      {bench && inBooks && (
        <div className="panel" style={{ marginTop: 14 }} data-testid="record-books">
          <div className="panel-head">
            <h3>In the record books</h3>
            <span className="small muted">
              Against {bench.seasons} complete {leagueName} seasons of {bench.played} matches in the data
              {champion ? ` · the real champions in ${seasonLabel(game.settings.leagueSeason)} were ${clubName(u, champion)}` : ''}
            </span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Yours</th>
                <th>All-time</th>
              </tr>
            </thead>
            <tbody>
              {([bench.points, bench.wins, bench.goalsFor, bench.goalsAgainst, bench.defeats] as RecordMetric[]).map((m) => {
                const isRecord = bench.records.some((r) => r.key === m.key)
                return (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num">{m.value}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {isRecord ? (
                        <span className="chip gold">📜 League record</span>
                      ) : (
                        <span>
                          {m.rank === 1 ? 'Joint best' : `${ordinal(m.rank)} best`} <span className="muted small">of {m.of + 1}{m.equal > 0 && m.rank > 1 ? ` · level with ${m.equal}` : ''}</span>
                        </span>
                      )}
                      {m.better.length > 0 && <div className="small muted">Ahead: {m.better.map((b) => `${clubName(u, b.clubId)} ${b.value} (${seasonLabel(b.season)})`).join(', ')}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {game.settings.difficulty !== 'realistic' && (
            <div className="small muted" style={{ marginTop: 8 }}>
              Calibrated difficulty handicaps the AI clubs, so these are benchmarks rather than records. The Record Books achievement needs a points record on Realistic.
            </div>
          )}
        </div>
      )}

      {game.jobOffers.length > 0 && (
        <div className="panel" style={{ marginTop: 14, borderColor: 'var(--gold)' }}>
          <div className="panel-head">
            <h3 style={{ color: 'var(--gold-text)' }}>Job offers</h3>
            <span className="small muted">Your work has been noticed. Stay, or take your squad somewhere new next season.</span>
          </div>
          <div className="grid three">
            {game.jobOffers.map((o, i) => {
              const chosen = game.pendingMove?.clubId === o.clubId
              return (
                <div key={o.clubId} className="card" style={chosen ? { borderColor: 'var(--primary)' } : undefined}>
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
                    <th>Real champions</th>
                  </tr>
                </thead>
                <tbody>
                  {game.history.map((h) => {
                    const real = realChampion(u, h.leagueId, h.leagueSeason)
                    return (
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
                      <td>
                        {real ? (
                          <span className="row" style={{ gap: 6 }}>
                            <ClubBadge clubId={real} size={20} />
                            {clubName(u, real)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                    )
                  })}
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
