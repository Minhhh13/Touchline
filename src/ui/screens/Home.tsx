import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Award, BookOpen, CalendarDays, CalendarRange, ChevronsUp, Clock, Dices, Globe, Menu, Search, Shield, Sparkles, Swords, Timer, Trophy, X, Zap, type LucideIcon } from 'lucide-react'
import { todaysDailySeed, slotOf } from '@game/store'
import { useStorePick } from '../useStorePick'
import { resumeStatus } from '@game/logic/resume'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { arenaDailySeed, randomSeed, weeklySeed } from '@engine/rng'
import { firstDraftSettings, isNewcomer, nextUpFor } from '@game/logic/onboarding'
import { onlineAvailable } from '../../online/api'
import { startingTeam, startingTeamName, teamShortName } from '../teamName'
import { ConflictCards } from '../online/ConflictCard'
import { TeamBadge } from '../components/bits'
import { Lockup } from '../components/Logo'
import { withViewTransition } from '../motion'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'
import { modeText } from '../i18n/modeText'
import './Home.css'

const t = translator(home)
import { askConfirm } from '../confirm'

function TimeTag({ children }: { children: ReactNode }) {
  return (
    <span className="time-tag">
      <Clock size={13} />
      {children}
    </span>
  )
}

function ModeChoice({ icon: Icon, title, line, meta, onClick, testId, disabled, next }: { icon: LucideIcon; title: string; line?: string; meta?: ReactNode; onClick: () => void; testId?: string; disabled?: boolean; next?: boolean }) {
  return (
    <button type="button" className={`home-choice${next ? ' next-up' : ''}`} onClick={onClick} data-testid={testId} disabled={disabled}>
      <span className="home-choice-icon" aria-hidden="true">
        <Icon size={24} strokeWidth={1.8} />
      </span>
      <span className="home-choice-copy">
        <strong>{title}</strong>
        {line && <span>{line}</span>}
        {next && <NextUpChip />}
      </span>
      {meta && <span className="home-choice-meta">{meta}</span>}
      <ArrowRight className="home-choice-arrow" size={18} aria-hidden="true" />
    </button>
  )
}

/** The marker on the one card Home points an early player to next (`nextUpFor`). */
function NextUpChip() {
  return (
    <span className="chip next-up-chip" data-testid="next-up">
      <Sparkles size={12} aria-hidden="true" />
      {t('tryNext')}
    </span>
  )
}

type HomePanel = 'closed' | 'play' | 'challenges' | 'resume' | 'menu'

export function Home() {
  const { universe: u, game, go: goNow, abandonGame, profile, parked, resumeGame, discardParked, loadedLeagues, startGame, openArenaSetup: openArenaNow } = useStorePick('universe', 'game', 'go', 'abandonGame', 'profile', 'parked', 'resumeGame', 'discardParked', 'loadedLeagues', 'startGame', 'openArenaSetup')
  // Leaving Home for another screen runs as a View Transition where the browser has one (motion.ts)
  const go = (...args: Parameters<typeof goNow>) => withViewTransition(() => goNow(...args))
  const openArenaSetup = (format: 'cup' | 'gauntlet') => withViewTransition(() => openArenaNow(format))
  const today = new Date().toISOString().slice(0, 10)
  const dailyResult = profile.dailyResults[`daily-${today}`]
  const dailyDone = !!dailyResult
  // Today's puzzle is fixed for everyone, so the card can start it in one tap; the Setup screen only adds a team name
  const dailyReady = !!u && loadedLeagues.includes('england')
  // Today's puzzle already under way continues rather than restarting; an unfinished quick draft in the same slot is only dropped on a yes
  const isTodaysDaily = (g: typeof game) => !!g && g.settings.mode === 'daily' && g.settings.seed === todaysDailySeed() && g.phase !== 'summary'
  const dailyUnderWay = isTodaysDaily(game) || isTodaysDaily(parked.quick)
  const playDaily = () => {
    if (!u || !dailyReady) return
    if (isTodaysDaily(game)) {
      go('game')
      return
    }
    // Parked by an arena run or a Weekly: today's puzzle comes back as it was left
    if (isTodaysDaily(parked.quick)) return resumeGame('quick')
    // The button opens the Daily setup, as the card does: the team name, today's puzzle, and Start Draft there
    go('setup', 'daily')
  }
  // The Daily Arena: today's run continues wherever it is (active or parked); any other unfinished arena run is only dropped on a yes
  const arenaSeed = arenaDailySeed()
  const arenaDone = profile.arenaDaily?.results[arenaSeed]
  const isTodaysArena = (g: typeof game) => !!g && !!g.settings.arena?.daily && g.settings.seed === arenaSeed && g.phase !== 'summary'
  const arenaUnderWay = isTodaysArena(game) ? 'active' : isTodaysArena(parked.arena) ? 'parked' : null
  const playArenaDaily = async () => {
    if (!u || !dailyReady) return
    if (arenaUnderWay === 'active') return go('game')
    if (arenaUnderWay === 'parked') return resumeGame('arena')
    const open = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
    if (open && !(await askConfirm(t('arenaAbandon', { mode: modeText(open, 'short'), team: open.settings.teamName }), { ok: t('startOk'), danger: true }))) return
    // Played already: a second go is practice, and says so before it replaces today's summary
    if (!open && arenaDone && !(await askConfirm(t('arenaAgain', { label: arenaDone.label }), { ok: t('playAgainOk') }))) return
    // The manager's own team name (the remembered one, or an invented one), never the logic's "Touchline XI" fallback
    const team = startingTeam()
    startGame({ ...dailyArenaGameSettings(u, arenaSeed, team.teamName), shortName: team.shortName })
  }
  // The Weekly Challenge: its setup names the team and loads the week's packs; this week's run under way continues
  const weekSeed = weeklySeed()
  const weekDone = profile.weekly?.results[weekSeed]
  const isThisWeek = (g: typeof game) => !!g && g.settings.mode === 'weekly' && g.settings.seed === weekSeed && g.phase !== 'summary'
  const playWeekly = () => {
    if (isThisWeek(game)) return go('game')
    if (isThisWeek(parked.quick)) return resumeGame('quick')
    go('setup', 'weekly')
  }
  // A manager with nothing finished and nothing waiting gets one Play action, then a direct Quick Draft choice.
  const newcomer = isNewcomer(profile, !!game || Object.keys(parked).length > 0)
  // An early player (a first result in, a handful at most): the one card worth trying next is marked
  const seasonWaiting = [game, ...Object.values(parked)].some((g) => !!g && (g.settings.mode === 'season' || g.settings.mode === 'dynasty'))
  const nextUp = newcomer ? null : nextUpFor(profile, { dailyPlayedToday: dailyDone, online: onlineAvailable(), seasonWaiting })
  // A finished game on the resume strip (a Dynasty's summary goes on to next year, so it is never finished here)
  const finishedHere = !!game && game.phase === 'summary' && game.settings.mode !== 'dynasty'
  // Today's Daily as the current game shows on the Daily card itself (See the result, Continue), not twice on Home
  const dailyIsGame = !!game && game.settings.mode === 'daily' && game.settings.seed === todaysDailySeed()
  const stripGame = dailyIsGame ? null : game
  const playFirstDraft = () => {
    // The first draft takes an invented club name too (or one typed before), never Touchline XI
    const name = startingTeamName()
    const settings = u && dailyReady ? firstDraftSettings(u, randomSeed(), name) : null
    if (settings) withViewTransition(() => startGame({ ...settings, shortName: teamShortName(name) }))
  }
  const [panel, setPanel] = useState<HomePanel>('closed')
  const playButton = useRef<HTMLButtonElement>(null)
  const panelClose = useRef<HTMLButtonElement>(null)
  const openPanel = (next: Exclude<HomePanel, 'closed'>) => setPanel(next)
  const closePanel = () => {
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setPanel('closed')
  }
  const closeAndFocusPlay = () => {
    closePanel()
    requestAnimationFrame(() => playButton.current?.focus())
  }
  useEffect(() => {
    if (panel === 'closed') return
    const frame = requestAnimationFrame(() => panelClose.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAndFocusPlay()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = document.getElementById('home-panel')
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((item) => !item.closest('[hidden]'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [panel])
  const runCount = (stripGame ? 1 : 0) + Object.keys(parked).length
  return (
    <div className="page home home-scene" data-panel={panel}>
      <div className="home-landing" inert={panel !== 'closed'}>
        <button type="button" className="home-menu-trigger" onClick={() => openPanel('menu')} aria-label={t('menu')} data-testid="home-menu">
          <Menu size={20} aria-hidden="true" />
          <span>{t('menu')}</span>
        </button>

        <main className="home-hero" aria-labelledby="home-title">
          <h1 id="home-title" className="home-lockup"><Lockup height={96} /></h1>
          <p>{t('tagline')}</p>
          <div className="home-actions">
            <button ref={playButton} type="button" className="home-play" onClick={() => openPanel('play')} aria-expanded={panel === 'play'} aria-controls="home-panel" data-testid="home-play">
              {t('play')}
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            {runCount > 0 && (
              <button type="button" className="home-continue" onClick={() => openPanel('resume')} data-testid="home-resume">
                {t('continueRuns', { n: runCount })}
              </button>
            )}
          </div>
        </main>

        <div className="home-mascot-stage" aria-hidden="true">
          <img src="/art/touchline-flag-mascot.png" alt="" />
        </div>
        <footer className="home-minimal-footer">{t('footer')}</footer>
      </div>

      <div className="home-panel-layer" aria-hidden={panel === 'closed'} onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeAndFocusPlay()
      }}>
        <section id="home-panel" className="home-panel" role="dialog" aria-modal="true" aria-labelledby="home-panel-title" inert={panel === 'closed'}>
          <header className="home-panel-head">
            <div className="home-panel-heading">
              {panel === 'challenges' && (
                <button type="button" className="home-panel-back" onClick={() => setPanel('play')} aria-label={t('back')}>
                  <ArrowLeft size={18} aria-hidden="true" />
                </button>
              )}
              <div>
                <h2 id="home-panel-title">{t(panel === 'challenges' ? 'moreModes' : panel === 'resume' ? 'continue' : panel === 'menu' ? 'menu' : 'chooseGame')}</h2>
                <p>{t(panel === 'challenges' ? 'moreModesLine' : panel === 'resume' ? 'continueLine' : panel === 'menu' ? 'menuLine' : 'modeNote')}</p>
              </div>
            </div>
            <button ref={panelClose} type="button" className="home-panel-close" onClick={closeAndFocusPlay} aria-label={t('close')}>
              <X size={20} aria-hidden="true" />
            </button>
          </header>

          <ConflictCards />

          <div className="home-panel-body">
            <div className="home-choice-list" data-testid={newcomer ? 'first-run' : undefined} hidden={panel !== 'play'}>
                <ModeChoice icon={Dices} title={t('quickTitle')} line={t('quickLine')} meta={<TimeTag>{t('minutes', { n: 5 })}</TimeTag>} onClick={newcomer ? playFirstDraft : () => go('setup', 'quick')} testId="quick-card" disabled={!dailyReady} />
                <ModeChoice icon={Zap} title={t('dailyTitle')} line={t('dailyLine')} meta={<TimeTag>{t(!dailyReady ? 'loading' : dailyIsGame ? finishedHere ? 'seeResult' : 'continueDaily' : dailyUnderWay ? 'continueDaily' : dailyDone ? 'playAgainFun' : 'minutes', { n: 5 })}</TimeTag>} onClick={dailyIsGame ? () => go('game') : playDaily} testId="daily-card" disabled={!dailyReady} next={nextUp === 'daily'} />
                <ModeChoice icon={CalendarDays} title={t('seasonTitle')} line={t('seasonLine')} meta={<TimeTag>{t('minutes', { n: 45 })}</TimeTag>} onClick={() => go('setup', 'season')} testId="season-card" next={nextUp === 'season'} />
                <ModeChoice icon={Shield} title={t('dynastyTitle')} line={t('dynastyLine')} meta={<TimeTag>{t('career')}</TimeTag>} onClick={() => go('setup', 'dynasty')} testId="dynasty-card" />
                <ModeChoice icon={Swords} title={t('h2hTitle')} line={t('h2hLine')} meta={<TimeTag>{t('twoPlayers')}</TimeTag>} onClick={() => go('h2h')} testId="h2h-card" />
                {!newcomer && <ModeChoice icon={Trophy} title={t('moreModes')} line={t('moreModesLine')} onClick={() => setPanel('challenges')} testId="more-modes" />}
            </div>

            {!newcomer && (
              <div className="home-choice-list home-challenge-list casual" data-testid="casual-row" hidden={panel !== 'challenges'}>
                <ModeChoice icon={Zap} testId="arena-daily-card" title={t('arenaDaily')} line={arenaDone ? t('playedLabel', { label: arenaDone.label }) : t('sameDraw')} onClick={playArenaDaily} disabled={!dailyReady} />
                <ModeChoice icon={CalendarRange} testId="weekly-card" title={t('weeklyTitle')} line={weekDone ? t('playedPoints', { n: weekDone.points }) : t('weeklyFallback')} onClick={playWeekly} disabled={!u} />
                <ModeChoice icon={Award} testId="arena-cup-card" title={t('cupTitle')} line={t('cupMeta')} onClick={() => openArenaSetup('cup')} />
                <ModeChoice icon={ChevronsUp} testId="arena-gauntlet-card" title={t('gauntletTitle')} line={t('gauntletMeta')} onClick={() => openArenaSetup('gauntlet')} />
                <ModeChoice icon={Timer} testId="runin-card" title={t('runinTitle')} line={t('runinMeta')} onClick={() => go('setup', 'runin')} />
              </div>
            )}

            <div className="resume-list home-resume-list" data-testid="resume-list" data-count={runCount} hidden={panel !== 'resume' || runCount === 0}>
                {stripGame && game && (
                  <div className="resume-card row between" data-testid="resume-current">
                    <div className="row resume-who">
                      <TeamBadge code={game.settings.shortName} size={36} />
                      <div className="resume-text">
                        <div className="resume-name">{t('resumeName', { mode: modeText(game, 'short'), team: game.settings.teamName })}</div>
                        <div className="resume-status">{resumeStatus(game)}</div>
                      </div>
                    </div>
                    <div className="row resume-actions">
                      <button className="btn primary" onClick={() => go('game')} data-testid="resume-continue">{t(finishedHere ? 'seeResult' : 'continue')}</button>
                      {finishedHere ? (
                        <button className="btn ghost" onClick={() => abandonGame()} data-testid="resume-clear" title={t('clearTip')}>{t('clear')}</button>
                      ) : (
                        <button className="btn danger ghost" onClick={() => void askConfirm(t('abandonConfirm'), { ok: t('abandon'), danger: true }).then((ok) => { if (ok) abandonGame() })} data-testid="resume-abandon">{t('abandon')}</button>
                      )}
                    </div>
                  </div>
                )}
                {Object.entries(parked).map(([slot, g]) => (
                  <div key={slot} className="resume-card parked row between" data-testid={`resume-parked-${slot}`}>
                    <div className="row resume-who">
                      <TeamBadge code={g.settings.shortName} size={36} />
                      <div className="resume-text">
                        <div className="resume-name">{t('parkedName', { mode: modeText(g, 'short'), team: g.settings.teamName })}</div>
                        <div className="resume-status">{resumeStatus(g)}</div>
                      </div>
                    </div>
                    <div className="row resume-actions">
                      <button className="btn primary" onClick={() => resumeGame(slot)}>{t('resume')}</button>
                      <button className="btn danger ghost" onClick={() => void askConfirm(t('discardConfirm'), { ok: t('discard'), danger: true }).then((ok) => { if (ok) discardParked(slot) })}>{t('discard')}</button>
                    </div>
                  </div>
                ))}
            </div>

            <div className="home-choice-list home-utility-list" hidden={panel !== 'menu'}>
                <ModeChoice icon={Trophy} title={t('viewProfile')} onClick={() => go('profile')} />
                <ModeChoice icon={Search} title={t('explore')} onClick={() => go('explore')} />
                <ModeChoice icon={BookOpen} title={t('howItWorks')} onClick={() => go('howto')} />
                {onlineAvailable() && <ModeChoice icon={Globe} title={t('worldTitle')} line={t('worldNext')} onClick={() => go('world')} testId="world-card" next={nextUp === 'boards'} />}
                <ModeChoice icon={Shield} title={t('privacy')} onClick={() => go('privacy')} testId="privacy-link" />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
