import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { arenaShareText, arenaStepMark } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { clubIdOfKey } from '@engine/knockout'
import { randomSeed } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import { arenaBanner, arenaClubName, arenaClubShortName, arenaShareInput, cupWinnerName, gauntletLines, isBigCup, rungMark } from '@game/logic/arena'
import { cupRoundCount, cupRoundName } from '@engine/cup'
import { Bracket } from '../components/Bracket'
import { arenaFormatLabel, shareCardFooter } from '@game/logic/modes'
import { playerLookup } from '@game/logic/players'
import { Pitch } from '../components/Pitch'
import { ClubBadge } from '../components/bits'
import { GauntletLadder } from '../components/GauntletLadder'
import { minuteLabel } from '../format'
import { downloadDataUrl, renderShareCard } from '../shareCard'

/** The end of an arena run: the banner, every match, the man of the match and scorers, the XI, the share text and card. */
export function ArenaSummary() {
  const { universe: u, game, startGame, openArenaSetup, showToast } = useStore()
  const [copied, setCopied] = useState(false)
  // The "Copied!" label goes back after a moment; the timer is cleared if the summary closes first
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  if (!u || !game?.arena) return null
  const a = game.arena
  const get = playerLookup(game, u)
  const gauntlet = a.format === 'gauntlet'
  const cup = isBigCup(a)
  const size = a.size ?? 2
  const inFinal = !cup || a.log.length === cupRoundCount(size)
  const winner = cup && !a.won ? cupWinnerName(game, u) : null
  // The Gauntlet and the Cup list the run's scorers; a final its own
  const runLong = gauntlet || cup
  const banner = arenaBanner(a)
  const input = arenaShareInput(game, u)
  const text = input ? arenaShareText(input) : ''
  const last = a.log[a.log.length - 1]
  const res = game.lastMatch
  const userHome = res?.homeTeamId === USER_TEAM
  // The Gauntlet's scorers are the run's; a final's are the match's
  const runScorers = Object.entries(game.squad)
    .filter(([, s]) => s.seasonStats.goals > 0)
    .sort(([x, sx], [y, sy]) => sy.seasonStats.goals - sx.seasonStats.goals || (x < y ? -1 : 1))
  const goals = (res?.events ?? []).filter((e) => (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') && (e.side === 'home') === userHome)
  const motm = gauntlet || !inFinal ? null : last?.motmId ? (get(last.motmId)?.name ?? last.motmId) : null
  const formation = getFormation(game.tactics.formationId)
  const stepLine = (i: number) => {
    const s = a.log[i]
    return `${input?.steps[i]?.code ?? ''} ${arenaStepMark(s)} ${s.gf}-${s.ga} ${arenaClubName(u, s.opponent)}${s.pens ? ` (${s.pens.us}-${s.pens.them} pens)` : ''}`
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      showToast('Could not copy. Select the text manually.')
    }
  }
  const card = () => {
    try {
      const url = renderShareCard({
        title: game.settings.teamName,
        subtitle: `${arenaFormatLabel(game.settings.arena)} · ${input?.wheel ?? ''}`,
        tier: a.won ? 'CHAMPIONS' : 'MID_TABLE',
        row: { won: a.log.filter((s) => s.gf > s.ga).length, drawn: a.log.filter((s) => s.gf === s.ga).length, lost: a.log.filter((s) => s.gf < s.ga).length, points: 0 },
        position: a.won ? 1 : 2,
        formation,
        lineup: game.lineup,
        getPlayer: get,
        footer: shareCardFooter(game),
        hideRatings: game.settings.rules.hardMode,
        banner: { text: banner },
        lines: gauntlet ? [a.log.map(rungMark).join(''), ...gauntletLines(game, u)] : [...a.log.map((_, i) => stepLine(i)), ...(winner && !inFinal ? [`🏆 Won by ${winner}`] : []), ...(motm ? [`⭐ ${cup ? 'Final MOTM: ' : ''}${motm}`] : [])],
      })
      downloadDataUrl(url, `touchline-${gauntlet ? 'gauntlet' : cup ? 'cup' : 'final'}-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast('Could not render the share card.')
    }
  }

  return (
    <div className="page">
      <div className="tier-banner" data-testid="arena-banner">
        <div className="muted small">
          {game.settings.teamName} · {arenaFormatLabel(game.settings.arena)}
        </div>
        <div className={`tier ${a.won ? 'CHAMPIONS' : ''}`} data-testid="tier">
          {a.won ? (gauntlet ? '🏔️ ' : '🏆 ') : gauntlet ? '🪜 ' : ''}
          {banner}
        </div>
        {winner && (
          <div className="muted" style={{ marginTop: 6 }} data-testid="cup-winner">
            🏆 Won by {winner}
          </div>
        )}
        {gauntlet && (
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
            <GauntletLadder u={u} a={a} />
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => void copy()} data-testid="arena-copy">
            {copied ? 'Copied!' : 'Copy result to share'}
          </button>
          <button className="btn" onClick={card} data-testid="arena-card">
            Download share card
          </button>
          <button className="btn" onClick={() => startGame({ ...game.settings, seed: randomSeed() })} data-testid="arena-again">
            Play again
          </button>
          <button className="btn ghost" onClick={() => openArenaSetup(gauntlet ? 'gauntlet' : 'cup')}>
            New game
          </button>
        </div>
      </div>

      <div className="grid two">
        <div className="col">
          <div className="panel" data-testid="arena-log">
            <h3>The run</h3>
            <div className="col" style={{ gap: 8 }}>
              {a.log.map((s, i) => (
                <div key={i} className="row between wrap">
                  <span className="row" style={{ gap: 8 }}>
                    <ClubBadge clubId={clubIdOfKey(s.opponent)} size={26} />
                    <span>
                      <div style={{ fontWeight: 600 }}>
                        {s.label} v {arenaClubName(u, s.opponent)}
                      </div>
                      <div className="small muted">
                        {s.neutral ? 'Neutral ground' : s.home ? 'Home' : 'Away'} · real strength {s.realStrength.toFixed(1)}
                        {s.offset > 0 ? `, played at ${(s.realStrength - s.offset).toFixed(1)}` : ''} · {s.live ? 'managed live' : 'the assistant'}
                      </div>
                    </span>
                  </span>
                  <span className={`chip ${s.gf > s.ga || (s.pens && s.pens.us > s.pens.them) ? 'good' : 'bad'}`} style={{ fontFamily: 'var(--font-display)', fontSize: 16 }}>
                    {s.gf}-{s.ga}
                    {s.pens ? ` (${s.pens.us}-${s.pens.them} pens)` : ''}
                  </span>
                </div>
              ))}
            </div>
            {!gauntlet && last?.pens && (
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {last.pens.kicks.map((k, i) => (
                  <span key={i} className={`chip ${k.scored ? 'good' : 'bad'}`}>
                    {k.us ? '' : '⇢ '}
                    {(k.us ? get(k.takerId)?.name : u.index[k.takerId]?.name) ?? k.takerId} {k.scored ? '✓' : '✗'}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="panel">
            <h3>{runLong ? 'The run’s scorers' : 'Man of the match and scorers'}</h3>
            {motm && <div style={{ fontWeight: 600 }}>⭐ {cup ? 'Final man of the match: ' : ''}{motm}</div>}
            {runLong && runScorers.length === 0 && <div className="muted small">No goals for us.</div>}
            {runLong &&
              runScorers.map(([id, s]) => (
                <div key={id} className="row between small">
                  <span>
                    ⚽ {get(id)?.name ?? id}
                    {s.seasonStats.motm > 0 ? ` · ⭐ ${s.seasonStats.motm}` : ''}
                  </span>
                  <span className="mono muted">{s.seasonStats.goals}</span>
                </div>
              ))}
            {!runLong && goals.length === 0 && <div className="muted small">No goals for us.</div>}
            {!runLong && goals.map((g, i) => (
              <div key={i} className="row between small">
                <span>
                  ⚽ {g.playerName}
                  {g.type === 'penalty' ? ' (pen)' : g.type === 'own_goal' ? ' (og)' : ''}
                </span>
                <span className="mono muted">{minuteLabel(g.minute)}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>Share</h3>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-testid="arena-share-text">
              {text}
            </pre>
          </div>
        </div>
        <div className="panel">
          <h3>The XI · {formation.name}</h3>
          <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={game.settings.rules.hardMode} />
        </div>
      </div>
      {cup && a.bracket && (
        <div className="panel" style={{ marginTop: 12 }} data-testid="arena-bracket">
          <h3>The draw · {size} clubs</h3>
          <Bracket
            rounds={Array.from({ length: cupRoundCount(size) }, (_, r) => cupRoundName(size, r).name)}
            ties={a.bracket.rounds}
            nameOf={(k) => (k === USER_TEAM ? game.settings.teamName : arenaClubShortName(u, k))}
            badgeOf={(k) => (k === USER_TEAM ? game.settings.hostClubId : clubIdOfKey(k))}
            userId={USER_TEAM}
            seeds={a.bracket.seeds}
          />
        </div>
      )}
    </div>
  )
}
