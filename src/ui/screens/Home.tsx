import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowRight, Award, Sparkles, CalendarRange, ChevronsUp, Clock, Dices, Flame, Globe, Timer, Trophy, UserPlus, Zap, type LucideIcon } from 'lucide-react'
import { todaysDailySeed, slotOf } from '@game/store'
import { useStorePick } from '../useStorePick'
import { dailyLoaded, dailyPlan, dailySettings } from '@game/logic/setup'
import { resumeStatus } from '@game/logic/resume'
import { dailyArenaGameSettings, dailyArenaSettings } from '@game/logic/arenaDaily'
import { weeklyPlan } from '@game/logic/weekly'
import { weeklyThemeText as weeklyThemeName } from '../i18n/weeklyThemeText'
import { arenaDailySeed, dailySeed as dailySeedOf, randomSeed, weeklySeed } from '@engine/rng'
import { dailyNudge, personalBests, type Best } from '@game/logic/shareInvite'
import { recordLabel } from '@game/logic/perfect'
import { FIRST_RUN_STEPS, firstDraftSettings, isNewcomer, nextUpFor } from '@game/logic/onboarding'
import type { StartDecision } from '../../online/daily'
import type { PuzzlePin } from '../../online/server/dailyVerify'
import type { LoadedUniverse } from '@engine/universe'
import { onlineAvailable } from '../../online/api'
import { startingTeam, startingTeamName, teamShortName } from '../teamName'
import { useOnline } from '../../online/state'
import { ConflictCards } from '../online/ConflictCard'
import { seasonLabel, formationName } from '../format'
import { TeamBadge, Tip } from '../components/bits'
import { Lockup } from '../components/Logo'
import { LeagueFlag } from '../components/Flag'
import { HeroArt, ModeArt as ModeScene, type ModeArtKind } from '../components/Art'
import { withViewTransition } from '../motion'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'
import { modeText } from '../i18n/modeText'

const t = translator(home)
/** The next-badge line reads the trophies' catalogue: its own chunk, out of the first download. */
const HomeBadgeNudge = lazy(() => import('../components/HomeBadgeNudge'))
import { askConfirm } from '../confirm'

/** Today's ranked Daily with its tag and note, worked out once a board's pin is in. */
interface PinnedDaily {
  start: StartDecision
  tag: string
  note: string
}

/**
 * Online and pinned: the ranked puzzle (the same as the local mapping unless the data or rules changed since the pin),
 * worked out once per universe, day and pin. Its code (the verifier's mapping and the challenge codec) loads with the
 * pin, never in the first download: the pin itself arrives after Home is up, so the card read the local mapping first
 * before this too.
 */
function usePinnedDaily(u: LoadedUniverse | null, seed: string, pin: PuzzlePin | null, here: boolean): PinnedDaily | null {
  const [done, setDone] = useState<{ u: LoadedUniverse; seed: string; pin: PuzzlePin; value: PinnedDaily } | null>(null)
  useEffect(() => {
    if (!here || !u || !pin) return
    let live = true
    void Promise.all([import('../../online/daily'), import('../../online/engineRoute')]).then(([{ dailyStartSettings }, { PIN_NOTE, PIN_TAG, pinStanding }]) => {
      if (!live) return
      const start = dailyStartSettings(u, seed, 'Touchline XI', pin)
      const standing = start.ranked ? 'ranked' : pinStanding(pin, start.source)
      setDone({ u, seed, pin, value: { start, tag: PIN_TAG[standing], note: standing === 'ranked' ? '' : PIN_NOTE[standing] } })
    })
    return () => {
      live = false
    }
  }, [u, seed, pin, here])
  return here && done && done.u === u && done.seed === seed && done.pin === pin ? done.value : null
}

/** "69,155" becomes "69k": the hero shows three figures, not a sentence. */
function compact(n: number): string {
  return n >= 10_000 ? t('thousands', { n: Math.floor(n / 1000) }) : n.toLocaleString()
}

/** The card's picture is our own drawing (components/Art.tsx). It used to carry the mode's icon on its edge too: one picture is enough. */
function ModeArt({ kind }: { kind: ModeArtKind }) {
  return (
    <span className="mode-art">
      <ModeScene kind={kind} />
    </span>
  )
}

function TimeTag({ children }: { children: ReactNode }) {
  return (
    <span className="time-tag">
      <Clock size={13} />
      {children}
    </span>
  )
}

/** The card is the button; this only shows where to tap, lined up with the Daily card's own button. Hidden on a phone, where cards are rows. */
function GoLabel() {
  return (
    <span className="mode-go" aria-hidden>
      {t('start')}
      <ArrowRight size={16} />
    </span>
  )
}

function Tile({ icon: Icon, title, meta, onClick, testId, disabled, next }: { icon: LucideIcon; title: string; meta: string; onClick: () => void; testId?: string; disabled?: boolean; next?: boolean }) {
  return (
    <button type="button" className={`home-tile${next ? ' next-up' : ''}`} onClick={onClick} data-testid={testId} disabled={disabled}>
      <span className="tile-icon">
        <Icon size={20} />
      </span>
      <span className="tile-text">
        <b>{title}</b>
        {/* The meta line can be cut short on a narrow tile: the whole line is its tooltip */}
        <span title={meta}>{meta}</span>
      </span>
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

/** The phone held upright, where the nav is the dock along the bottom (styles.css, "The dock"). */
const DOCK_QUERY = '(max-width: 720px) and (min-height: 501px)'
function subscribeDock(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const mq = window.matchMedia(DOCK_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const dockedNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DOCK_QUERY).matches
function useDocked(): boolean {
  return useSyncExternalStore(subscribeDock, dockedNow, () => false)
}

const STEP_ICON: Record<(typeof FIRST_RUN_STEPS)[number]['id'], LucideIcon> = { spin: Dices, draft: UserPlus, play: Trophy }

/** The first-run panel in the hero: the game in three steps and one button into a Quick Draft on Setup's defaults. */
function FirstRun({ ready, onPlay, onHowTo }: { ready: boolean; onPlay: () => void; onHowTo: () => void }) {
  return (
    <div className="first-run" data-testid="first-run">
      <ol className="first-steps">
        {FIRST_RUN_STEPS.map((step, i) => {
          const Icon = STEP_ICON[step.id]
          return (
            <li key={step.id}>
              <span className="first-step-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <span>
                <b>{t('stepTitle', { n: i + 1, title: t(`step_${step.id}_title`) })}</b>
                <span>{t(`step_${step.id}_line`)}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <div className="first-go">
        <button type="button" className="btn primary big" disabled={!ready} onClick={onPlay} data-testid="first-draft">
          {t(ready ? 'playFirst' : 'loading')}
          {ready && <ArrowRight size={18} aria-hidden="true" />}
        </button>
        <span className="first-note">
          <Clock size={13} aria-hidden="true" /> {t('firstNote')}{' '}
          <button type="button" className="linklike" onClick={onHowTo}>
            {t('howItWorks')}
          </button>
        </span>
      </div>
    </div>
  )
}

export function Home() {
  const { universe: u, game, go: goNow, abandonGame, profile, parked, resumeGame, discardParked, loadedLeagues, startGame, openArenaSetup: openArenaNow } = useStorePick('universe', 'game', 'go', 'abandonGame', 'profile', 'parked', 'resumeGame', 'discardParked', 'loadedLeagues', 'startGame', 'openArenaSetup')
  // Leaving Home for another screen runs as a View Transition where the browser has one (motion.ts)
  const go = (...args: Parameters<typeof goNow>) => withViewTransition(() => goNow(...args))
  const pin = useOnline((s) => (s.pins.day === new Date().toISOString().slice(0, 10) ? s.pins.daily : null))
  const openArenaSetup = (format: 'cup' | 'gauntlet') => withViewTransition(() => openArenaNow(format))
  const playerSeasons = u ? u.available.reduce((s, l) => s + l.playerSeasons, 0) : 0
  const today = new Date().toISOString().slice(0, 10)
  const dailyResult = profile.dailyResults[`daily-${today}`]
  const dailyDone = !!dailyResult
  // Today's puzzle is fixed for everyone, so the card can start it in one tap; the Setup screen only adds a team name
  const dailyReady = !!u && loadedLeagues.includes('england')
  // The day's league rotates (engine 7, `dailyPlan`): its pack loads on the Daily's setup, so until then the card names the league and shape only
  const dailyHere = dailyReady && dailyLoaded(loadedLeagues, todaysDailySeed())
  // Online and pinned: the ranked puzzle (the same as this mapping unless the data or rules changed since the pin)
  // Both scan every club-season, so they are worked out once per universe, day and pin, not on every render of Home
  const dailySeed = todaysDailySeed()
  const pinned = usePinnedDaily(u, dailySeed, pin, dailyHere)
  const dailyStart = pinned?.start ?? null
  const daily = useMemo((): { formationId: string; leagueId: string; season: number | null } | null => {
    if (!dailyReady || !u) return null
    if (dailyStart?.source === 'pinned') return { formationId: dailyStart.settings.formationId, leagueId: dailyStart.settings.leagueId, season: dailyStart.settings.leagueSeason }
    const local = dailyHere ? dailySettings(u, dailySeed) : null
    if (local) return { formationId: local.formationId, leagueId: local.leagueId, season: local.season }
    const plan = dailyPlan(dailySeed)
    return { formationId: plan.formationId, leagueId: plan.leagueId, season: null }
  }, [dailyReady, dailyHere, u, dailySeed, dailyStart])
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
  const arenaToday = dailyArenaSettings(arenaSeed)
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
  const weekPlan = u ? weeklyPlan(u, weekSeed) : null
  const weekDone = profile.weekly?.results[weekSeed]
  const isThisWeek = (g: typeof game) => !!g && g.settings.mode === 'weekly' && g.settings.seed === weekSeed && g.phase !== 'summary'
  const playWeekly = () => {
    if (isThisWeek(game)) return go('game')
    if (isThisWeek(parked.quick)) return resumeGame('quick')
    go('setup', 'weekly')
  }
  // A manager with nothing finished and nothing waiting gets the game in three steps and one button into a Quick Draft
  const newcomer = isNewcomer(profile, !!game || Object.keys(parked).length > 0)
  // An early player (a first result in, a handful at most): the one card worth trying next is marked
  const seasonWaiting = [game, ...Object.values(parked)].some((g) => !!g && (g.settings.mode === 'season' || g.settings.mode === 'dynasty'))
  const nextUp = newcomer ? null : nextUpFor(profile, { dailyPlayedToday: dailyDone, online: onlineAvailable(), seasonWaiting })
  // The phone's nav is the dock along the bottom: its tip shows only there, once a first result is in (`TIP_AFTER`)
  const docked = useDocked()
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
  // A returning manager's own figures in the hero (the database's when there are none yet) and the reasons to come back
  const bests = personalBests(profile, profile.dailyStreak > 0 ? 2 : 3)
  const nudge = dailyNudge(profile, todaysDailySeed(), dailySeedOf(new Date(Date.now() - 86400000)))
  const bestStat = (b: Best) => (b.id === 'record' ? recordLabel(b.won, b.drawn, b.lost) : String(b.n))
  const streakMeta = (done: string | null, streak: number | undefined, fallback: string) => (done ? (streak ? t('streakDone', { done, n: streak }) : done) : streak ? t('streakFallback', { n: streak, fallback }) : fallback)
  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-photo">
          <HeroArt />
        </div>
        <div className="hero-content">
          <h1>
            <Lockup height={104} animate="load" />
          </h1>
          <p className="tag">{t('tagline')}</p>
          {newcomer ? (
            <FirstRun ready={dailyReady} onPlay={playFirstDraft} onHowTo={() => go('howto')} />
          ) : (
          <>
          <dl className="hero-stats" aria-live="polite">
            {profile.dailyStreak > 0 || bests.length ? (
              <>
                {profile.dailyStreak > 0 && (
                  <div data-testid="home-best-streak">
                    <dt>{t('best_streak')}</dt>
                    <dd>{profile.dailyStreak}</dd>
                  </div>
                )}
                {bests.map((b) => (
                  <div key={b.id} data-testid={`home-best-${b.id}`}>
                    <dt>{t(`best_${b.id}`)}</dt>
                    <dd>{bestStat(b)}</dd>
                  </div>
                ))}
              </>
            ) : u ? (
              <>
                <div>
                  <dt>{t('playerSeasons')}</dt>
                  <dd>{compact(playerSeasons)}</dd>
                </div>
                <div>
                  <dt>{t('leagues')}</dt>
                  <dd>{u.available.length}</dd>
                </div>
                <div>
                  <dt>{t('seasons')}</dt>
                  <dd>
                    {seasonLabel(u.firstSeason).slice(0, 4)}–{seasonLabel(u.lastSeason).slice(-2)}
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt>{t('database')}</dt>
                <dd>{t('loading')}</dd>
              </div>
            )}
          </dl>
          {/* Why come back today: the Daily (a streak that ends tonight first) and the badge nearest its next tier */}
          <div className="home-nudges" data-testid="home-nudges">
            {/* While the Daily card carries Try next, a fresh Daily's nudge would point at it a second time */}
            {!(nudge.kind === 'fresh' && nextUp === 'daily') && (
              <span className={`home-nudge${nudge.kind === 'atRisk' ? ' hot' : ''}`} data-testid="daily-nudge" data-kind={nudge.kind}>
                <Flame size={14} aria-hidden="true" />
                {nudge.kind === 'played' ? t('nudgePlayed', { points: nudge.points, n: nudge.streak }) : nudge.kind === 'atRisk' ? t('nudgeAtRisk', { n: nudge.streak }) : t('nudgeFresh')}
              </span>
            )}
            <Suspense fallback={null}>
              <HomeBadgeNudge onOpen={() => go('profile')} />
            </Suspense>
          </div>
          </>
          )}
        </div>
      </section>

      <ConflictCards />

      {(stripGame || Object.keys(parked).length > 0) && (
        <div className="resume-list" data-testid="resume-list" data-count={(stripGame ? 1 : 0) + Object.keys(parked).length}>
          {stripGame && game && (
            <div className="panel resume-card row between" data-testid="resume-current">
              <div className="row resume-who">
                <TeamBadge code={game.settings.shortName} size={36} />
                <div className="resume-text">
                  <div className="resume-name" title={t('resumeName', { mode: modeText(game, 'short'), team: game.settings.teamName })}>
                    {t('resumeName', { mode: modeText(game, 'short'), team: game.settings.teamName })}
                  </div>
                  <div className="small muted resume-status">{resumeStatus(game)}</div>
                </div>
              </div>
              <div className="row resume-actions">
                <button className="btn primary" onClick={() => go('game')} data-testid="resume-continue">
                  {t(finishedHere ? 'seeResult' : 'continue')}
                </button>
                {/* A finished result is already in the record: clearing it from Home loses nothing, so it asks nothing */}
                {finishedHere ? (
                  <button className="btn ghost" onClick={() => abandonGame()} data-testid="resume-clear" title={t('clearTip')}>
                    {t('clear')}
                  </button>
                ) : (
                  <button className="btn danger ghost" onClick={() => void askConfirm(t('abandonConfirm'), { ok: t('abandon'), danger: true }).then((ok) => { if (ok) abandonGame() })} data-testid="resume-abandon">
                    {t('abandon')}
                  </button>
                )}
              </div>
            </div>
          )}
          {Object.entries(parked).map(([slot, g]) => (
            <div key={slot} className="panel resume-card parked row between" data-testid={`resume-parked-${slot}`}>
              <div className="row resume-who">
                <TeamBadge code={g.settings.shortName} size={36} />
                <div className="resume-text">
                  <div className="resume-name" title={t('parkedName', { mode: modeText(g, 'short'), team: g.settings.teamName })}>
                    {t('parkedName', { mode: modeText(g, 'short'), team: g.settings.teamName })}
                  </div>
                  <div className="small muted resume-status">{resumeStatus(g)}</div>
                </div>
              </div>
              <div className="row resume-actions">
                <button className="btn" onClick={() => resumeGame(slot)}>
                  {t('resume')}
                </button>
                <button className="btn danger ghost" onClick={() => void askConfirm(t('discardConfirm'), { ok: t('discard'), danger: true }).then((ok) => { if (ok) discardParked(slot) })}>
                  {t('discard')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {docked && !newcomer && <Tip id="dock-first">{t('dockTip')}</Tip>}

      <div className="modes">
        <button className="mode-card" onClick={() => go('setup', 'quick')}>
          <ModeArt kind="quick" />
          <span className="mode-text">
            <h3>{t('quickTitle')}</h3>
            <p>{t('quickLine')}</p>
            <span className="foot">
              <TimeTag>{t('minutes', { n: 5 })}</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <div className={`mode-card daily${nextUp === 'daily' ? ' next-up' : ''}`} data-testid="daily-card">
          <button type="button" className="mode-card-body" onClick={() => go('setup', 'daily')} title={t('dailyOpen')}>
            <ModeArt kind="daily" />
            <span className="mode-text">
              <h3>{t('dailyTitle')}</h3>
              {nextUp === 'daily' && <NextUpChip />}
              <p>{t('dailyLine')}</p>
              <span className="foot">
                <TimeTag>{t('minutes', { n: 5 })}</TimeTag>
                {/* Played today: the result takes the puzzle's place on the line */}
                {daily && u && !dailyResult && (
                  <span className="daily-today" data-testid="daily-today" data-league={daily.leagueId} title={t(daily.season === null ? 'dailyTodayLeague' : 'dailyToday', { formation: formationName(daily.formationId), league: u.available.find((l) => l.id === daily.leagueId)?.name ?? u.leagues.find((l) => l.id === daily.leagueId)?.name ?? '', season: daily.season === null ? '' : seasonLabel(daily.season) })}>
                    <LeagueFlag leagueId={daily.leagueId} />
                    {formationName(daily.formationId)}
                    {daily.season !== null && ` · ${seasonLabel(daily.season)}`}
                  </span>
                )}
                {pin && pinned && (
                  <span className={`ranked-tag${pinned.start.ranked ? ' on' : ''}`} data-testid="daily-ranked" title={pinned.start.ranked ? t('dailyRanked') : pinned.note}>
                    {pinned.tag}
                  </span>
                )}
                {dailyResult && (
                  <span className="chip good daily-done" data-testid="daily-done">
                    {t('todayPts', { n: dailyResult.points })}
                  </span>
                )}
                {profile.dailyStreak > 0 && (
                  <span className="streak" role="img" title={t('streakTip', { n: profile.dailyStreak })} aria-label={t('streakLabel', { n: profile.dailyStreak })}>
                    <Flame size={13} aria-hidden="true" />
                    {profile.dailyStreak}
                  </span>
                )}
              </span>
            </span>
          </button>
          {dailyIsGame ? (
            <div className="daily-actions">
              <button type="button" className="btn primary" onClick={() => go('game')} data-testid="daily-play">
                {t(finishedHere ? 'seeResult' : 'continueDaily')}
              </button>
              {/* A finished result is already in the record: clearing it loses nothing, so it asks nothing */}
              {finishedHere ? (
                <button type="button" className="btn ghost" onClick={() => abandonGame()} data-testid="resume-clear" title={t('clearTip')}>
                  {t('clear')}
                </button>
              ) : (
                <button type="button" className="btn danger ghost" onClick={() => void askConfirm(t('abandonConfirm'), { ok: t('abandon'), danger: true }).then((ok) => { if (ok) abandonGame() })} data-testid="resume-abandon">
                  {t('abandon')}
                </button>
              )}
            </div>
          ) : (
            <button type="button" className={`btn block${newcomer || (dailyDone && !dailyUnderWay) ? '' : ' primary'}`} disabled={!dailyReady} onClick={playDaily} data-testid="daily-play">
              {t(!dailyReady ? 'loading' : dailyUnderWay ? 'continueDaily' : dailyDone ? 'playAgainFun' : 'playDaily')}
            </button>
          )}
        </div>
        <button className={`mode-card${nextUp === 'season' ? ' next-up' : ''}`} onClick={() => go('setup', 'season')} data-testid="season-card">
          <ModeArt kind="season" />
          <span className="mode-text">
            <h3>{t('seasonTitle')}</h3>
            {nextUp === 'season' && <NextUpChip />}
            <p>{t('seasonLine')}</p>
            <span className="foot">
              <TimeTag>{t('minutes', { n: 45 })}</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'dynasty')}>
          <ModeArt kind="dynasty" />
          <span className="mode-text">
            <h3>{t('dynastyTitle')}</h3>
            <p>{t('dynastyLine')}</p>
            <span className="foot">
              <TimeTag>{t('career')}</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
      </div>

      {/* The casual modes: one sitting each, beside the four ways to play above. A newcomer's Home keeps to the first
          draft and the four modes; the five more come in with the first result */}
      {!newcomer && (
      <>
      <h2 className="home-more eyebrow" id="home-more">{t('moreModes')}</h2>
      <div className="home-tiles casual" data-testid="casual-row" role="group" aria-labelledby="home-more">
        <Tile icon={Zap} testId="arena-daily-card" title={t('arenaDaily')} meta={streakMeta(arenaDone ? t('playedLabel', { label: arenaDone.label }) : null, profile.arenaDaily?.streak, u ? t(arenaToday.format === 'gauntlet' ? 'arenaDayGauntlet' : 'arenaDayCup', { size: arenaToday.size ?? 16, wheel: u.available.find((l) => l.id === arenaToday.leagueId)?.name ?? arenaToday.leagueId }) : t('sameDraw'))} onClick={playArenaDaily} disabled={!dailyReady} />
        <Tile icon={CalendarRange} testId="weekly-card" title={t('weeklyTitle')} meta={streakMeta(weekDone ? t('playedPoints', { n: weekDone.points }) : null, profile.weekly?.streak, weekPlan ? t('weekEnds', { theme: weeklyThemeName(weekPlan.theme) || t('thisWeek') }) : t('weeklyFallback'))} onClick={playWeekly} disabled={!u} />
        <Tile icon={Award} testId="arena-cup-card" title={t('cupTitle')} meta={t('cupMeta')} onClick={() => openArenaSetup('cup')} />
        <Tile icon={ChevronsUp} testId="arena-gauntlet-card" title={t('gauntletTitle')} meta={t('gauntletMeta')} onClick={() => openArenaSetup('gauntlet')} />
        <Tile icon={Timer} testId="runin-card" title={t('runinTitle')} meta={t('runinMeta')} onClick={() => go('setup', 'runin')} />
      </div>
      </>
      )}

      {/* The other screens live in the nav; the World board shows here only while it is an early player's next step */}
      {onlineAvailable() && nextUp === 'boards' && (
        <div className="home-tiles">
          <Tile icon={Globe} title={t('worldTitle')} meta={t('worldNext')} onClick={() => go('world')} testId="world-card" next />
        </div>
      )}
      <p className="muted small" style={{ marginTop: 16, textAlign: 'center' }}>
        {t('footer')}{' '}
        <button className="btn ghost sm" onClick={() => go('privacy')} data-testid="privacy-link">
          {t('privacy')}
        </button>
      </p>
    </div>
  )
}
