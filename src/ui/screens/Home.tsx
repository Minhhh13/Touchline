import type { ReactNode } from 'react'
import { ArrowRight, Award, BookOpen, CalendarDays, CalendarRange, ChevronsUp, ClipboardList, Clock, Crown, Dices, Flame, Globe, Search, Swords, Timer, Trophy, UserPlus, Zap, type LucideIcon } from 'lucide-react'
import { useStore, todaysDailySeed, slotOf } from '@game/store'
import { dailySettings } from '@game/logic/setup'
import { resumeStatus } from '@game/logic/resume'
import { dailyArenaGameSettings, dailyArenaSettings } from '@game/logic/arenaDaily'
import { weeklyPlan } from '@game/logic/weekly'
import { weeklyThemeText as weeklyThemeName } from '../i18n/weeklyThemeText'
import { arenaDailySeed, randomSeed, weeklySeed } from '@engine/rng'
import { FIRST_RUN_STEPS, firstDraftSettings, isNewcomer } from '@game/logic/onboarding'
import { dailyStartSettings } from '../../online/daily'
import { PIN_NOTE, PIN_TAG, pinStanding, type PinStanding } from '../../online/engineRoute'
import { useOnline } from '../../online/state'
import { onlineAvailable } from '../../online/api'
import { ConflictCards } from '../online/ConflictCard'
import { seasonLabel, formationName } from '../format'
import { TeamBadge } from '../components/bits'
import { Lockup } from '../components/Logo'
import { LeagueFlag } from '../components/Flag'
import { HeroArt, ModeArt as ModeScene, type ModeArtKind } from '../components/Art'
import { withViewTransition } from '../motion'
import { translator } from '../i18n'
import { home } from '../i18n/en/home'
import { modeText } from '../i18n/modeText'

const t = translator(home)
import { askConfirm } from '../confirm'

/** "69,155" becomes "69k": the hero shows three figures, not a sentence. */
function compact(n: number): string {
  return n >= 10_000 ? t('thousands', { n: Math.floor(n / 1000) }) : n.toLocaleString()
}

/** The card's picture is our own drawing (components/Art.tsx), with the mode's icon on the edge. */
function ModeArt({ kind, icon: Icon }: { kind: ModeArtKind; icon: LucideIcon }) {
  return (
    <span className="mode-art">
      <ModeScene kind={kind} />
      <span className="mode-icon">
        <Icon size={20} />
      </span>
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

function Tile({ icon: Icon, title, meta, onClick, testId, disabled }: { icon: LucideIcon; title: string; meta: string; onClick: () => void; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" className="home-tile" onClick={onClick} data-testid={testId} disabled={disabled}>
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
  const { universe: u, game, go: goNow, abandonGame, profile, parked, resumeGame, discardParked, loadedLeagues, startGame, openArenaSetup: openArenaNow } = useStore()
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
  // Online and pinned: the ranked puzzle (the same as this mapping unless the data or rules changed since the pin)
  const dailyStart = dailyReady ? dailyStartSettings(u, todaysDailySeed(), 'Touchline XI', pin) : null
  const daily = dailyReady ? (dailyStart?.source === 'pinned' ? { formationId: dailyStart.settings.formationId, host: dailyStart.settings.hostClubId, season: dailyStart.settings.leagueSeason } : dailySettings(u, todaysDailySeed())) : null
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
  const achievements = Object.keys(profile.achievements).length
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
    startGame(dailyArenaGameSettings(u, arenaSeed))
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
  // A finished game on the resume strip (a Dynasty's summary goes on to next year, so it is never finished here)
  const finishedHere = !!game && game.phase === 'summary' && game.settings.mode !== 'dynasty'
  const playFirstDraft = () => {
    const settings = u && dailyReady ? firstDraftSettings(u, randomSeed()) : null
    if (settings) withViewTransition(() => startGame(settings))
  }
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
            {u ? (
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
          {u && (
            <div className="row wrap hero-flags" role="group" aria-label={t('leagues')}>
              {u.available.map((l) => (
                <LeagueFlag key={l.id} leagueId={l.id} label={l.name} size={24} />
              ))}
            </div>
          )}
          </>
          )}
        </div>
      </section>

      <ConflictCards />

      {(game || Object.keys(parked).length > 0) && (
        <div className="resume-list" data-testid="resume-list" data-count={(game ? 1 : 0) + Object.keys(parked).length}>
          {game && (
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

      <div className="modes">
        <button className="mode-card" onClick={() => go('setup', 'quick')}>
          <ModeArt kind="quick" icon={Dices} />
          <span className="mode-text">
            <h3>{t('quickTitle')}</h3>
            <p>{t('quickLine')}</p>
            <span className="foot">
              <TimeTag>{t('minutes', { n: 5 })}</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <div className="mode-card daily" data-testid="daily-card">
          <button type="button" className="mode-card-body" onClick={() => go('setup', 'daily')} title={t('dailyOpen')}>
            <ModeArt kind="daily" icon={CalendarDays} />
            <span className="mode-text">
              <h3>{t('dailyTitle')}</h3>
              <p>{t('dailyLine')}</p>
              <span className="foot">
                <TimeTag>{t('minutes', { n: 5 })}</TimeTag>
                {/* Played today: the result takes the puzzle's place on the line */}
                {daily && u && !dailyResult && (
                  <span className="daily-today" title={t('dailyToday', { formation: formationName(daily.formationId), league: u.leagues.find((l) => l.id === u.clubById[daily.host]?.leagueId)?.name ?? '', season: seasonLabel(daily.season) })}>
                    <LeagueFlag leagueId={u.clubById[daily.host]?.leagueId ?? 'england'} />
                    {formationName(daily.formationId)} · {seasonLabel(daily.season)}
                  </span>
                )}
                {pin && dailyStart && (
                  <span className={`ranked-tag${dailyStart.ranked ? ' on' : ''}`} data-testid="daily-ranked" title={dailyStart.ranked ? t('dailyRanked') : PIN_NOTE[pinStanding(pin, dailyStart.source) as Exclude<PinStanding, 'ranked'>]}>
                    {PIN_TAG[dailyStart.ranked ? 'ranked' : pinStanding(pin, dailyStart.source)]}
                  </span>
                )}
                {dailyResult && (
                  <span className="chip good daily-done" data-testid="daily-done">
                    {t('todayPts', { n: dailyResult.points })}
                  </span>
                )}
                {profile.dailyStreak > 0 && (
                  <span className="streak" title={t('streakTip', { n: profile.dailyStreak })} aria-label={t('streakLabel', { n: profile.dailyStreak })}>
                    <Flame size={13} aria-hidden="true" />
                    {profile.dailyStreak}
                  </span>
                )}
              </span>
            </span>
          </button>
          <button type="button" className={`btn block${newcomer || (dailyDone && !dailyUnderWay) ? '' : ' primary'}`} disabled={!dailyReady} onClick={playDaily} data-testid="daily-play">
            {t(!dailyReady ? 'loading' : dailyUnderWay ? 'continueDaily' : dailyDone ? 'playAgainFun' : 'playDaily')}
          </button>
        </div>
        <button className="mode-card" onClick={() => go('setup', 'season')}>
          <ModeArt kind="season" icon={ClipboardList} />
          <span className="mode-text">
            <h3>{t('seasonTitle')}</h3>
            <p>{t('seasonLine')}</p>
            <span className="foot">
              <TimeTag>{t('minutes', { n: 45 })}</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'dynasty')}>
          <ModeArt kind="dynasty" icon={Crown} />
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

      {/* The casual modes: one sitting each, beside the four ways to play above */}
      <div className="home-tiles casual" data-testid="casual-row" role="group" aria-label={t('moreWays')}>
        <Tile icon={Zap} testId="arena-daily-card" title={t('arenaDaily')} meta={streakMeta(arenaDone ? t('playedLabel', { label: arenaDone.label }) : null, profile.arenaDaily?.streak, u ? t(arenaToday.format === 'gauntlet' ? 'arenaDayGauntlet' : 'arenaDayCup', { size: arenaToday.size ?? 16, wheel: u.available.find((l) => l.id === arenaToday.leagueId)?.name ?? arenaToday.leagueId }) : t('sameDraw'))} onClick={playArenaDaily} disabled={!dailyReady} />
        <Tile icon={CalendarRange} testId="weekly-card" title={t('weeklyTitle')} meta={streakMeta(weekDone ? t('playedPoints', { n: weekDone.points }) : null, profile.weekly?.streak, weekPlan ? t('weekEnds', { theme: weeklyThemeName(weekPlan.theme) || t('thisWeek') }) : t('weeklyFallback'))} onClick={playWeekly} disabled={!u} />
        <Tile icon={Award} testId="arena-cup-card" title={t('cupTitle')} meta={t('cupMeta')} onClick={() => openArenaSetup('cup')} />
        <Tile icon={ChevronsUp} testId="arena-gauntlet-card" title={t('gauntletTitle')} meta={t('gauntletMeta')} onClick={() => openArenaSetup('gauntlet')} />
        <Tile icon={Timer} testId="runin-card" title={t('runinTitle')} meta={t('runinMeta')} onClick={() => go('setup', 'runin')} />
      </div>

      <div className="home-tiles">
        <Tile icon={Swords} title={t('h2hTitle')} meta={t('h2hMeta')} onClick={() => go('h2h')} />
        {onlineAvailable() && <Tile icon={Globe} title={t('worldTitle')} meta={t('worldMeta')} onClick={() => go('world')} testId="world-card" />}
        <Tile icon={Search} title={t('exploreTitle')} meta={u ? t('exploreMeta', { n: u.available.length }) : t('exploreFallback')} onClick={() => go('explore')} />
        <Tile icon={Trophy} title={t('profileTitle')} meta={t('profileMeta', { seasons: profile.seasonsSimulated, achievements })} onClick={() => go('profile')} />
        <Tile icon={BookOpen} title={t('howToTitle')} meta={t('howToMeta')} onClick={() => go('howto')} />
      </div>
      <p className="muted small" style={{ marginTop: 16, textAlign: 'center' }}>
        {t('footer')}{' '}
        <button className="btn ghost sm" onClick={() => go('privacy')} data-testid="privacy-link">
          {t('privacy')}
        </button>
      </p>
    </div>
  )
}
