import { useState } from 'react'
import { useStore } from '@game/store'
import { arenaShareText, arenaStepMark } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { ARENA_TIER_LABEL, clubIdOfKey } from '@engine/knockout'
import { randomSeed } from '@engine/rng'
import { USER_TEAM } from '@engine/season'
import { arenaClubName, arenaShareInput, arenaTier } from '@game/logic/arena'
import { arenaFormatLabel, shareCardFooter } from '@game/logic/modes'
import { playerLookup } from '@game/logic/players'
import { Pitch } from '../components/Pitch'
import { ClubBadge } from '../components/bits'
import { minuteLabel } from '../format'
import { downloadDataUrl, renderShareCard } from '../shareCard'

/** The end of an arena run: the banner, every match, the man of the match and scorers, the XI, the share text and card. */
export function ArenaSummary() {
  const { universe: u, game, startGame, go, showToast } = useStore()
  const [copied, setCopied] = useState(false)
  if (!u || !game?.arena) return null
  const a = game.arena
  const get = playerLookup(game, u)
  const tier = arenaTier(a)
  const input = arenaShareInput(game, u)
  const text = input ? arenaShareText(input) : ''
  const last = a.log[a.log.length - 1]
  const res = game.lastMatch
  const userHome = res?.homeTeamId === USER_TEAM
  const goals = (res?.events ?? []).filter((e) => (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') && (e.side === 'home') === userHome)
  const motm = last?.motmId ? (get(last.motmId)?.name ?? last.motmId) : null
  const formation = getFormation(game.tactics.formationId)
  const stepLine = (i: number) => {
    const s = a.log[i]
    return `${input?.steps[i]?.code ?? ''} ${arenaStepMark(s)} ${s.gf}-${s.ga} ${arenaClubName(u, s.opponent)}${s.pens ? ` (${s.pens.us}-${s.pens.them} pens)` : ''}`
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
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
        banner: { text: ARENA_TIER_LABEL[tier] },
        lines: [...a.log.map((_, i) => stepLine(i)), ...(motm ? [`⭐ ${motm}`] : [])],
      })
      downloadDataUrl(url, `touchline-final-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
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
          {a.won ? '🏆 ' : ''}
          {ARENA_TIER_LABEL[tier]}
        </div>
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
          <button className="btn ghost" onClick={() => go('setup', 'arena')}>
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
            {last?.pens && (
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
            <h3>Man of the match and scorers</h3>
            {motm && <div style={{ fontWeight: 600 }}>⭐ {motm}</div>}
            {goals.length === 0 && <div className="muted small">No goals for us.</div>}
            {goals.map((g, i) => (
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
    </div>
  )
}
