import { useEffect, useMemo, useState } from 'react'
import { useStorePick } from '../useStorePick'
import { seasonTable, USER_TEAM } from '@engine/season'
import { RUN_IN_TEMPLATE_LABEL, runInShare, runInVerdict } from '@game/logic/runin'
import { gameLabel, storyForGame } from '@game/logic/story'
import { TableView } from '../components/TableView'
import { CasualStatus } from '../online/CasualStatus'
import { BadgeUnlocks } from '../components/BadgeUnlocks'
import { ClubBadge, Info, Stat } from '../components/bits'
import { Check, ChevronDown, Copy, House, ImageDown, RotateCcw, Send } from 'lucide-react'
import { clubName, ordinal, outcomeClass, outcomeOf, seasonLabel } from '../format'
import { getFormation } from '@engine/formations'
import { playerLookup } from '@game/logic/players'
import { modeLabel, shareCardFooter } from '@game/logic/modes'
import { ratingHidden } from '@game/logic/ratingVisibility'
import { inviteFor, shareWithInvite, tidyShareText } from '@game/logic/shareInvite'
import { downloadDataUrl, renderShareCard } from '../shareCard'
import { shareOrCopy } from '../shareSheet'
import { APP_NAME, BRAND_COLOURS } from '../brand'
import { Celebrate } from '../components/Celebrate'
import { prefersReducedMotion, useFirstReveal } from '../motion'
import { playSound } from '../sound/synth'
import { isWeeklyRunIn } from '@game/logic/runinWeekly'
import { translator } from '../i18n'
import { runin } from '../i18n/en/runin'
import { marginText, templateText } from '../runInText'

const t = translator(runin)

/** The end of a run-in: the brief's chip, the verdict against the real club, the ten games, the final table and the share text. */
export function RunInSummary() {
  const { universe: u, game, go, showToast } = useStorePick('universe', 'game', 'go', 'showToast')
  const [copied, setCopied] = useState(false)
  const table = useMemo(() => (game?.season ? seasonTable(game.season) : []), [game?.season])
  const story = useMemo(() => (game && u ? storyForGame(game, u) : null), [game, u])
  // A brief met: the flourish behind the chip and the fanfare, the first time this summary shows in a visit (as the arena's)
  const met = useMemo(() => (game && u && game.season ? !!runInVerdict(game, u)?.met : false), [game, u])
  const first = useFirstReveal(`runin-met:${game?.id}`, false)
  useEffect(() => {
    if (met && first) playSound({ id: 'fanfare', treble: false, reduced: prefersReducedMotion() }, 0.6)
  }, [met, first])
  // "Copied" reverts after a moment; the timer goes with the screen
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  if (!u || !game || !game.season) return null
  const v = runInVerdict(game, u)
  const raw = runInShare(game, u)
  if (!v || !raw) return null
  // Emoji-light, and the last line asks a friend to take the same job
  const invite = inviteFor('runin', { position: v.position })
  const text = shareWithInvite(raw, invite)
  const host = game.settings.hostClubId
  // How close it came, against the club across the brief's line (goal difference named when the points are level)
  const margin = marginText(table, USER_TEAM, game.season.boardTarget, { sacked: !!game.season.sacked, playOff: game.season.playOff?.tie.winnerId !== undefined, name: (id) => clubName(u, id) })
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
        subtitle: `${clubName(u, host)} ${seasonLabel(game.settings.leagueSeason)} · took over in week ${v.from.matchweek}`,
        tier: v.met ? 'CHAMPIONS' : 'RELEGATED',
        row: { won: 0, drawn: 0, lost: 0, points: v.points },
        position: v.position,
        formation: getFormation(game.tactics.formationId),
        lineup: game.lineup,
        getPlayer: playerLookup(game, u),
        footer: shareCardFooter(game),
        hideRatings: ratingHidden(game.settings.rules, 'squad'),
        banner: { text: v.chip, colour: v.met ? BRAND_COLOURS.good : BRAND_COLOURS.bad },
        mode: modeLabel(game, 'short'),
        beatMe: invite,
        lines: tidyShareText([`Brief: ${RUN_IN_TEMPLATE_LABEL[v.template]}`, `Took over ${ordinal(v.from.position)}, finished ${ordinal(v.position)} on ${v.points}`, ...(v.realLine ? [v.realLine] : [])].join('\n')).split('\n'),
      })
      downloadDataUrl(url, `touchline-runin-${game.settings.teamName.replace(/\s+/g, '-').toLowerCase()}.png`)
    } catch {
      showToast(t('cardFailed'))
    }
  }
  const challenge = async () => {
    const outcome = await shareOrCopy({ title: APP_NAME, text: `${tidyShareText(raw)}\n${invite.title}`, url: `${location.origin}${location.pathname}` })
    if (outcome === 'copied') showToast(t('inviteCopied'))
    else if (outcome === 'failed') showToast(t('copyFailed'))
  }
  return (
    // Main's summary layout: the verdict box on the left, the games, the table and the share text in a box beside it
    <div className="page summary runin-summary" data-testid="summary">
      <div className="tier-banner result-banner" data-testid="runin-verdict">
        <div className="banner-meta">
          <span className="bm-team">
            <ClubBadge clubId={host} size={22} />
            {clubName(u, host)} {seasonLabel(game.settings.leagueSeason)}
          </span>
          <span className="bm-rest">{t('modeLine', { week: isWeeklyRunIn(game.settings) ? 'yes' : 'no', template: templateText(v.template) })}</span>
        </div>
        <div className="tier-wrap">
          {v.met && <Celebrate tier="CHAMPIONS" resultKey={`${game.id}:runin`} replayed={false} />}
          <div className={`tier ${v.met ? 'CHAMPIONS' : 'RELEGATED'}`} data-testid="runin-chip">
            {v.chip}
          </div>
        </div>
        <p className="tier-blurb" data-testid="runin-line">
          {v.line}
        </p>
        {margin && (
          <p className="tier-blurb" data-testid="runin-margin">
            {margin}
          </p>
        )}
        <div className="banner-stats">
          <Stat label={t('tookOver')} value={ordinal(v.from.position)} sub={t('tookOverSub', { week: v.from.matchweek, pts: v.from.points })} />
          <Stat label={t('finished')} value={ordinal(v.position)} sub={t('pts', { n: v.points })} />
        </div>
        {story && story.strip.length > 0 && (
          <div className="blocks" aria-hidden="true">
            {story.strip.map((o, i) => (
              <span key={i} style={{ background: o === 'W' ? 'var(--good)' : o === 'D' ? 'var(--draw)' : 'var(--bad)' }} />
            ))}
          </div>
        )}
        {game.season.sacked && <div className="notice danger">{t('sackedNotice')}</div>}
        <div className="banner-actions">
          <button className="btn primary" onClick={() => go('setup', 'runin')} data-testid="runin-again">
            <RotateCcw size={16} aria-hidden="true" /> {t('another')}
          </button>
          <button className="btn" onClick={() => void challenge()} data-testid="runin-challenge">
            <Send size={16} aria-hidden="true" /> {t('challengeFriend')}
          </button>
          <button className="btn" onClick={copy}>
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {t(copied ? 'copied' : 'copyResult')}
          </button>
          <button className="btn" onClick={() => void card()} data-testid="runin-card">
            <ImageDown size={16} aria-hidden="true" /> {t('downloadCard')}
          </button>
          <button className="btn ghost" onClick={() => go('home')}>
            <House size={16} aria-hidden="true" /> {t('home')}
          </button>
        </div>
      </div>
      <div className="summary-body fill" data-testid="summary-body">
        <CasualStatus game={game} />
        <BadgeUnlocks />
        <div className="grid two">
          <div className="panel" data-testid="runin-games">
            <h3>{t('theRunIn')}</h3>
            <ol className="runin-games">
              {(story?.results ?? []).map((r) => {
                const o = outcomeOf(r.gf, r.ga)
                return (
                  <li key={r.matchweek} title={gameLabel(r, (id) => clubName(u, id))}>
                    <span className={`chip ${outcomeClass(o)}`}>{o}</span>
                    <span className="muted rg-mw">{t('mwShort', { n: r.matchweek })}</span>
                    <span className="rg-opp">
                      <ClubBadge clubId={r.opponentId} size={18} />
                      <span className="rg-name">{t('versus', { home: r.home ? 'home' : 'away', club: clubName(u, r.opponentId) })}</span>
                    </span>
                    <b className={`rg-score ${outcomeClass(o)}`}>
                      {r.gf}-{r.ga}
                    </b>
                    <span className="muted rg-pos" title={t('placeAfter', { pos: ordinal(r.position) })}>
                      {ordinal(r.position)}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="panel">
            <div className="panel-head">
              <span className="head-title">
                <h3>{t('finalTable')}</h3>
                <Info label={t('aboutTable')}>
                  {t('tableInfo', { from: v.from.matchweek, played: game.season.matchweeks - v.from.matchweek })}
                </Info>
              </span>
            </div>
            <TableView rows={table} teamName={game.settings.teamName} compact highlightTop zones />
          </div>
        </div>
        <details className="panel fold">
          <summary className="panel-head">
            <h3>{t('shareText')}</h3>
            <ChevronDown size={16} className="fold-chevron" aria-hidden="true" />
          </summary>
          <pre className="mono small share-text" data-testid="runin-share-text">
            {text}
          </pre>
        </details>
      </div>
    </div>
  )
}
