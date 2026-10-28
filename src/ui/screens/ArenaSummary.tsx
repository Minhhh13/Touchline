import { useEffect, useState } from 'react'
import { useStorePick } from '../useStorePick'
import { arenaShareText, arenaStepMark } from '@engine/awards'
import { getFormation } from '@engine/formations'
import { clubIdOfKey } from '@engine/knockout'
import { randomSeed } from '@engine/rng'
import { arenaAgainSettings } from '@game/logic/arenaDaily'
import { USER_TEAM } from '@engine/season'
import { arenaBanner, arenaClubName, arenaClubShortName, arenaShareInput, cupWinnerName, gauntletLines, isBigCup, rungMark, stepWon } from '@game/logic/arena'
import { cupRoundCount } from '@engine/cup'
import { Bracket } from '../components/Bracket'
import { arenaBracketView } from '@game/logic/bracket'
import { modeLabel, shareCardFooter } from '@game/logic/modes'
import { modeText } from '../i18n/modeText'
import { translator } from '../i18n'
import { arena } from '../i18n/en/arena'
import { playerLookup } from '@game/logic/players'
import { aiLookup } from '@engine/reserve'
import { Pitch } from '../components/Pitch'
import { ClubBadge, Info, Stat, TeamBadge } from '../components/bits'
import { Check, Copy, Dices, ImageDown, Plus, RotateCcw, Send } from 'lucide-react'
import { GauntletLadder } from '../components/GauntletLadder'
import { Celebrate } from '../components/Celebrate'
import { TrophyArt } from '../components/TrophyArt'
import '../visuals.css'
import { minuteLabel } from '../format'
import { downloadDataUrl, renderShareCard } from '../shareCard'
import { arenaChallengeFromGame, arenaVerifiedLine, challengeLink, runItBackArena } from '@game/logic/challenge'
import { arenaVerdictOf, ghostStepLine } from '@game/logic/arenaClaim'
import { cleanName } from '@engine/challenge'
import { inviteFor, inviteKindOf, shareWithInvite, tidyShareText } from '@game/logic/shareInvite'
import { ENGINE_VERSION } from '@engine/version'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { CasualStatus } from '../online/CasualStatus'
import { prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'
import { fixed } from '../format'

const t = translator(arena)

/** The card's own lines, emoji-light as the share text is (the Gauntlet's strip stays). */
const cardLines = (lines: string[]) => tidyShareText(lines.join('\n')).split('\n')

/** Seconds before an arena win's fanfare: after the last rung's bell or the final's whistle has had its moment. */
const ARENA_FANFARE_DELAY = 0.6

/** The end of an arena run: the banner, every match, the man of the match and scorers, the XI, the share text and card. */
export function ArenaSummary() {
  const { universe: u, game, startGame, openArenaSetup, showToast, profile } = useStorePick('universe', 'game', 'startGame', 'openArenaSetup', 'showToast', 'profile')
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
  // Emoji-light, and the last line asks a friend in: the challenge link once made, else where to play
  const invite = inviteFor(inviteKindOf(game), { won: a.won, rungs: a.log.length - (a.won ? 0 : 1) })
  const text = input ? shareWithInvite(arenaShareText(input), invite, link) : ''
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
      showToast(t('cannotPack'))
      return
    }
    const url = challengeLink(c, location.origin, location.pathname)
    setLink(url)
    try {
      await navigator.clipboard.writeText(url)
      showToast(t('linkCopied', { n: url.length }))
    } catch {
      showToast(t('linkBelow'))
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
      showToast(t('copyFailed'))
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
        mode: modeLabel(game, 'short'),
        beatMe: invite,
        lines: cardLines([...(gauntlet ? [a.log.map(rungMark).join(''), ...gauntletLines(game, u)] : [...a.log.map((_, i) => stepLine(i)), ...(winner && !inFinal ? [`🏆 Won by ${winner}`] : []), ...(motm ? [`⭐ ${cup ? 'Final MOTM: ' : ''}${motm}`] : [])]), ...(verdict ? [verdict] : [])]),
      })
      downloadDataUrl(url, `touchline-${gauntlet ? 'gauntlet' : cup ? 'cup' : 'final'}-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast(t('cardFailed'))
    }
  }

  // A step won is the logic's rule (a draw settled on penalties counts): the screen never words its own
  const won = stepWon
  return (
    // Main's summary layout: the result box on the left, everything else in a box beside it that scrolls inside itself
    <div className="page summary arena-summary" data-testid="summary">
      <div className="tier-banner result-banner" data-testid="arena-banner">
        <div className="banner-meta">
          <span className="bm-team">
            <TeamBadge code={game.settings.shortName} size={22} />
            {game.settings.teamName}
          </span>
          <span className="bm-rest">{modeText(game, 'short')}</span>
        </div>
        {/* A run won lifts its trophy: the Cup's for the Cup and the final, the league's shape for the top of the Gauntlet */}
        {a.won && (
          <div className="arena-trophy" data-testid="arena-trophy">
            <TrophyArt kind={gauntlet ? 'league' : 'cup'} size={92} />
          </div>
        )}
        <div className="tier-wrap">
          {a.won && <Celebrate tier="CHAMPIONS" resultKey={`${game.id}:arena`} replayed={false} />}
          <div className={`tier ${a.won ? 'CHAMPIONS' : ''}`} data-testid="tier">
            {banner}
          </div>
        </div>
        {winner && (
          <p className="tier-blurb" data-testid="cup-winner">
            {t('wonBy', { name: winner })}
          </p>
        )}
        <div className="banner-stats">
          <Stat label={t(gauntlet ? 'rungs' : 'won')} value={a.log.filter(won).length} />
          <Stat label={t('played')} value={a.log.length} />
          <Stat label={t('goals')} value={`${a.log.reduce((x, s) => x + s.gf, 0)}-${a.log.reduce((x, s) => x + s.ga, 0)}`} />
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
          <button className="btn primary" onClick={() => void makeChallenge()} data-testid="arena-challenge-friend" title={t(a.handManaged ? 'handTip' : 'assistantTip')}>
            <Send size={16} aria-hidden="true" /> {t('challengeFriend')}
          </button>
          <button className="btn" onClick={() => void copy()} data-testid="arena-copy">
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {t(copied ? 'copied' : 'copyResult')}
          </button>
          <button className="btn" onClick={card} data-testid="arena-card">
            <ImageDown size={16} aria-hidden="true" /> {t('downloadCard')}
          </button>
          <button className="btn" onClick={() => startGame(arenaAgainSettings(game.settings, randomSeed()))} data-testid="arena-again" title={t('againTip')}>
            <Dices size={16} aria-hidden="true" /> {t('playAgain')}
          </button>
          <button className="btn" onClick={runItBack} data-testid="arena-run-it-back" title={t('runItBackTip')}>
            <RotateCcw size={16} aria-hidden="true" /> {t('runItBack')}
          </button>
          <button className="btn ghost" onClick={() => openArenaSetup(gauntlet ? 'gauntlet' : 'cup')} title={t('newRunTip')}>
            <Plus size={16} aria-hidden="true" /> {t('newGame')}
          </button>
        </div>
      </div>

      <div className="summary-body fill" data-testid="summary-body">
        <CasualStatus game={game} />
        {link && (
          <div className="panel" data-testid="arena-challenge-link">
            <div className="panel-head">
              <span className="head-title">
                <h3>{t('challengeLink')}</h3>
                <Info label={t('aboutLink')}>
                  {t('linkInfo', { name: challengeName, gauntlet: gauntlet ? 'yes' : 'no', hand: a.handManaged ? 'yes' : 'no', data: u.generatedAt, engine: ENGINE_VERSION })}
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
                <h3>{t('h2hVs', { name: challenge.name })}</h3>
                <Info label={t('aboutClaim')}>{arenaVerifiedLine(challenge, a.format)}</Info>
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
              <h3>{t('theRun')}</h3>
              <div className="plist lined">
                {a.log.map((s, i) => (
                  <div key={i} className="row between" style={{ gap: 8, padding: '6px 0' }}>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <ClubBadge clubId={clubIdOfKey(s.opponent)} size={26} />
                      <span style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>
                          {t('stepVs', { label: s.label, club: arenaClubName(u, s.opponent) })}
                        </div>
                        <div className="small muted">
                          {t('stepMeta', { where: s.neutral ? 'neutral' : s.home ? 'home' : 'away', real: fixed(s.realStrength, 1), offset: s.offset > 0 ? 'yes' : 'no', at: fixed(s.realStrength - s.offset, 1), live: s.live ? 'yes' : 'no' })}
                        </div>
                      </span>
                    </span>
                    <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
                      <span className={`chip ${won(s) ? 'good' : 'bad'}`} style={{ fontFamily: 'var(--font-display)', fontSize: 'calc(var(--fs-base) + 2px)' }}>
                        {s.gf}-{s.ga}
                        {s.pens ? t('pensSuffix', { score: `${s.pens.us}-${s.pens.them}` }) : ''}
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
                      {(k.us ? get(k.takerId)?.name : aiLookup(u)(k.takerId)?.name) ?? k.takerId} {k.scored ? '✓' : '✗'}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="panel">
              <h3>{t(runLong ? 'runScorers' : 'motmAndScorers')}</h3>
              {motm && <div style={{ fontWeight: 600 }}>{t(cup ? 'finalMotm' : 'motm', { name: motm })}</div>}
              {runLong && runScorers.length === 0 && <div className="muted small">{t('noGoals')}</div>}
              {runLong &&
                runScorers.map(([id, s]) => (
                  <div key={id} className="row between small">
                    <span>
                      ⚽ {get(id)?.name ?? id}
                      {s.seasonStats.motm > 0 ? t('motmCount', { n: s.seasonStats.motm }) : ''}
                    </span>
                    <span className="mono muted">{s.seasonStats.goals}</span>
                  </div>
                ))}
              {!runLong && goals.length === 0 && <div className="muted small">{t('noGoals')}</div>}
              {!runLong &&
                goals.map((g, i) => (
                  <div key={i} className="row between small">
                    <span>
                      ⚽ {g.playerName}
                      {g.type === 'penalty' ? t('pen') : g.type === 'own_goal' ? t('og') : ''}
                    </span>
                    <span className="mono muted">{minuteLabel(g.minute)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="panel">
            <h3>{t('theXI', { name: formation.name })}</h3>
            <Pitch formation={formation} lineup={game.lineup} getPlayer={get} hideRatings={ratingHidden(game.settings.rules, 'squad')} />
          </div>
        </div>
        {cup && a.bracket && (
          <div className="panel" data-testid="arena-bracket">
            <h3>{t('theDraw', { n: size })}</h3>
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
            <h3>{t('shareText')}</h3>
          </summary>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }} data-testid="arena-share-text">
            {text}
          </pre>
        </details>
      </div>
    </div>
  )
}
