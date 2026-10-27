import { useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { arenaShareText, arenaStepMark } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { clubIdOfKey } from '@engine/knockout'
import { randomSeed } from '@engine/rng'
import { arenaAgainSettings } from '@game/logic/arenaDaily'
import { USER_TEAM } from '@engine/season'
import { arenaBanner, arenaClubName, arenaClubShortName, arenaShareInput, cupWinnerName, gauntletLines, isBigCup, rungMark } from '@game/logic/arena'
import { cupRoundCount } from '@engine/cup'
import { Bracket } from '../components/Bracket'
import { arenaBracketView } from '@game/logic/bracket'
import { modeLabel, shareCardFooter } from '@game/logic/modes'
import { playerLookup } from '@game/logic/players'
import { Pitch } from '../components/Pitch'
import { ClubBadge, Info, Stat, TeamBadge } from '../components/bits'
import { Check, Copy, Dices, ImageDown, Plus, RotateCcw, Send } from 'lucide-react'
import { GauntletLadder } from '../components/GauntletLadder'
import { minuteLabel } from '../format'
import { downloadDataUrl, renderShareCard } from '../shareCard'
import { arenaChallengeFromGame, arenaVerifiedLine, challengeLink, runItBackArena } from '@game/logic/challenge'
import { arenaVerdictOf, ghostStepLine } from '@game/logic/arenaClaim'
import { cleanName } from '@engine/challenge'
import { ENGINE_VERSION } from '@engine/version'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'

/** Seconds before an arena win's fanfare: after the last rung's bell or the final's whistle has had its moment. */
const ARENA_FANFARE_DELAY = 0.6

/** The end of an arena run: the banner, every match, the man of the match and scorers, the XI, the share text and card. */
export function ArenaSummary() {
  const { universe: u, game, startGame, openArenaSetup, showToast, profile } = useStore()
  const [copied, setCopied] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  // The "Copied!" label goes back after a moment; the timer is cleared if the summary closes first
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  // A run won: the Cup's fanfare, the first time its summary shows in this visit (the trophy's own sound, so the master alone governs it)
  const runWon = !!game?.arena?.won
  const first = useFirstReveal(`arena-won:${game?.id}`, false)
  useEffect(() => {
    if (runWon && first) playSound({ id: 'fanfare', treble: false, reduced: prefersReducedMotion() }, ARENA_FANFARE_DELAY)
  }, [runWon, first])
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
  // The final's man of the match can be theirs (a lost final): the summary names his side then
  const motmName = gauntlet || !inFinal ? null : last?.motmId ? (get(last.motmId)?.name ?? last.motmId) : null
  const motm = motmName && last?.motmId && !game.squad[last.motmId] ? `${motmName} (${u.clubById[clubIdOfKey(last.opponent)]?.shortName ?? arenaClubShortName(u, last.opponent)})` : motmName
  const formation = getFormation(game.tactics.formationId)
  const stepLine = (i: number) => {
    const s = a.log[i]
    return `${input?.steps[i]?.code ?? ''} ${arenaStepMark(s)} ${s.gf}-${s.ga} ${arenaClubName(u, s.opponent)}${s.pens ? ` (${s.pens.us}-${s.pens.them} pens)` : ''}`
  }
  const challenge = game.settings.challenge?.arena ? game.settings.challenge : undefined
  const verdict = arenaVerdictOf(game)
  const challengeName = cleanName(profile.managerName) || cleanName(game.settings.teamName) || 'A friend'
  const makeChallenge = async () => {
    const c = arenaChallengeFromGame(game, u, challengeName)
    if (!c) {
      showToast('This run cannot be packed into a challenge.')
      return
    }
    const url = challengeLink(c, location.origin, location.pathname)
    setLink(url)
    try {
      await navigator.clipboard.writeText(url)
      showToast(`Challenge link copied (${url.length} characters). Send it to a friend.`)
    } catch {
      showToast('Could not copy. The link is below.')
    }
  }
  const runItBack = () => {
    const s = runItBackArena(game, u)
    if (s) startGame(s)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      showToast('Could not copy. Select the text manually.')
    }
  }
  const card = async () => {
    try {
      const url = await renderShareCard({
        title: game.settings.teamName,
        subtitle: `${modeLabel(game, 'short')} · ${input?.wheel ?? ''}`,
        tier: a.won ? 'CHAMPIONS' : 'MID_TABLE',
        row: { won: a.log.filter((s) => s.gf > s.ga).length, drawn: a.log.filter((s) => s.gf === s.ga).length, lost: a.log.filter((s) => s.gf < s.ga).length, points: 0 },
        position: a.won ? 1 : 2,
        formation,
        lineup: game.lineup,
        getPlayer: get,
        footer: shareCardFooter(game),
        hideRatings: ratingHidden(game.settings.rules, 'squad'),
        banner: { text: banner },
        lines: [...(gauntlet ? [a.log.map(rungMark).join(''), ...gauntletLines(game, u)] : [...a.log.map((_, i) => stepLine(i)), ...(winner && !inFinal ? [`🏆 Won by ${winner}`] : []), ...(motm ? [`⭐ ${cup ? 'Final MOTM: ' : ''}${motm}`] : [])]), ...(verdict ? [verdict] : [])],
      })
      downloadDataUrl(url, `touchline-${gauntlet ? 'gauntlet' : cup ? 'cup' : 'final'}-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast('Could not make the share card. Try again.')
    }
  }

  const won = (s: (typeof a.log)[number]) => s.gf > s.ga || (!!s.pens && s.pens.us > s.pens.them)
  return (
    // Main's summary layout: the result box on the left, everything else in a box beside it that scrolls inside itself
    <div className="page summary arena-summary" data-testid="summary">
      <div className="tier-banner result-banner" data-testid="arena-banner">
        <div className="banner-meta">
          <span className="bm-team">
            <TeamBadge code={game.settings.shortName} size={22} />
            {game.settings.teamName}
          </span>
          <span className="bm-rest">{modeLabel(game, 'short')}</span>
        </div>
        <div className="tier-wrap">
          <div className={`tier ${a.won ? 'CHAMPIONS' : ''}`} data-testid="tier">
            {banner}
          </div>
        </div>
        {winner && (
          <p className="tier-blurb" data-testid="cup-winner">
            Won by {winner}
          </p>
        )}
        <div className="banner-stats">
          <Stat label={gauntlet ? 'Rungs' : 'Won'} value={a.log.filter(won).length} />
          <Stat label="Played" value={a.log.length} />
          <Stat label="Goals" value={`${a.log.reduce((x, s) => x + s.gf, 0)}-${a.log.reduce((x, s) => x + s.ga, 0)}`} />
        </div>
        {/* The Gauntlet's ladder below marks every rung, so its blocks would say the same thing twice */}
        {!gauntlet && (
          <div className="blocks" aria-hidden="true">
            {a.log.map((s, i) => (
              <span key={i} style={{ background: won(s) ? 'var(--good)' : 'var(--bad)' }} />
            ))}
          </div>
        )}
        {gauntlet && (
          <div className="row banner-ladder" style={{ justifyContent: 'center' }}>
            <GauntletLadder u={u} a={a} />
          </div>
        )}
        <div className="banner-actions">
          <button className="btn primary" onClick={() => void copy()} data-testid="arena-copy">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy result'}
          </button>
          <button className="btn" onClick={card} data-testid="arena-card">
            <ImageDown size={16} aria-hidden="true" /> Download share card
          </button>
          <button className="btn" onClick={() => startGame(arenaAgainSettings(game.settings, randomSeed()))} data-testid="arena-again">
            <Dices size={16} aria-hidden="true" /> Play again
          </button>
          <button className="btn" onClick={() => void makeChallenge()} data-testid="arena-challenge-friend" title={a.handManaged ? 'Managed by hand: your friend sees the draft and the ladder replay, and your scores as your word' : 'Played by the assistant: your friend’s build replays and verifies it'}>
            <Send size={16} aria-hidden="true" /> Challenge a friend
          </button>
          <button className="btn" onClick={runItBack} data-testid="arena-run-it-back" title="The same seed again, against your own run">
            <RotateCcw size={16} aria-hidden="true" /> Run it back
          </button>
          <button className="btn ghost" onClick={() => openArenaSetup(gauntlet ? 'gauntlet' : 'cup')}>
            <Plus size={16} aria-hidden="true" /> New game
          </button>
        </div>
      </div>

      <div className="summary-body fill" data-testid="summary-body">
        {link && (
          <div className="panel" data-testid="arena-challenge-link">
            <div className="panel-head">
              <span className="head-title">
                <h3>Challenge link</h3>
                <Info label="About the link">
                  Whoever opens it drafts the same wheel as {challengeName} and {gauntlet ? 'climbs the same ladder' : 'faces the same draw'}, with your result on every step. {a.handManaged ? 'You managed this run by hand, so it shows as your word, never as verified.' : 'The assistant played every match, so it verifies on the same data and engine.'} Built on data {u.generatedAt}, engine {ENGINE_VERSION}.
                </Info>
              </span>
            </div>
            <input className="input mono small" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
          </div>
        )}

        {challenge?.arena && (
          <div className="panel" data-testid="arena-h2h">
            <div className="panel-head">
              <span className="head-title">
                <h3>Head-to-head · vs {challenge.name}</h3>
                <Info label="About the claim">{arenaVerifiedLine(challenge, a.format)}</Info>
              </span>
            </div>
            <div style={{ fontWeight: 700 }} data-testid="arena-verdict">
              {verdict}
            </div>
          </div>
        )}

        <div className="grid two">
          <div className="col">
            <div className="panel" data-testid="arena-log">
              <h3>The run</h3>
              <div className="plist lined">
                {a.log.map((s, i) => (
                  <div key={i} className="row between" style={{ gap: 8, padding: '6px 0' }}>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <ClubBadge clubId={clubIdOfKey(s.opponent)} size={26} />
                      <span style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {s.label} v {arenaClubName(u, s.opponent)}
                        </div>
                        <div className="small muted">
                          {s.neutral ? 'Neutral ground' : s.home ? 'Home' : 'Away'} · real {s.realStrength.toFixed(1)}
                          {s.offset > 0 ? `, played at ${(s.realStrength - s.offset).toFixed(1)}` : ''} · {s.live ? 'managed live' : 'simmed'}
                        </div>
                      </span>
                    </span>
                    <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
                      <span className={`chip ${won(s) ? 'good' : 'bad'}`} style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--fs-base) + 2px)' }}>
                        {s.gf}-{s.ga}
                        {s.pens ? ` (${s.pens.us}-${s.pens.them} pens)` : ''}
                      </span>
                      {challenge && <span className="small muted" data-testid="ghost-step">{ghostStepLine(challenge, i)}</span>}
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
              {motm && <div style={{ fontWeight: 600 }}>{cup ? 'Final man of the match: ' : 'Man of the match: '}{motm}</div>}
              {runLong && runScorers.length === 0 && <div className="muted small">No goals for us.</div>}
              {runLong &&
                runScorers.map(([id, s]) => (
                  <div key={id} className="row between small">
                    <span>
                      ⚽ {get(id)?.name ?? id}
                      {s.seasonStats.motm > 0 ? ` · MOTM ${s.seasonStats.motm}` : ''}
                    </span>
                    <span className="mono muted">{s.seasonStats.goals}</span>
                  </div>
                ))}
              {!runLong && goals.length === 0 && <div className="muted small">No goals for us.</div>}
              {!runLong &&
                goals.map((g, i) => (
                  <div key={i} className="row between small">
                    <span>
                      ⚽ {g.playerName}
                      {g.type === 'penalty' ? ' (pen)' : g.type === 'own_goal' ? ' (og)' : ''}
                    </span>
                    <span className="mono muted">{minuteLabel(g.minute)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="panel">
            <h3>The XI · {formation.name}</h3>
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={ratingHidden(game.settings.rules, 'squad')} />
          </div>
        </div>
        {cup && a.bracket && (
          <div className="panel" data-testid="arena-bracket">
            <h3>The draw · {size} clubs</h3>
            <Bracket
              view={arenaBracketView(size, a.bracket.rounds)}
              nameOf={(k) => (k === USER_TEAM ? game.settings.teamName : arenaClubShortName(u, k))}
              badge={(k) => (k === USER_TEAM ? <TeamBadge code={game.settings.shortName} size={18} /> : <ClubBadge clubId={clubIdOfKey(k)} size={18} />)}
              userId={USER_TEAM}
              seeds={a.bracket.seeds}
            />
          </div>
        )}
        <details className="panel fold">
          <summary className="fold-head">
            <h3>Share text</h3>
          </summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-testid="arena-share-text">
            {text}
          </pre>
        </details>
      </div>
    </div>
  )
}
