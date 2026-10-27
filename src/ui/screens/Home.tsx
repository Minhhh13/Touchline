import type { ReactNode } from 'react'
import { ArrowRight, Award, BookOpen, CalendarDays, CalendarRange, ChevronsUp, ClipboardList, Clock, Crown, Dices, Flame, Globe, Search, Swords, Timer, Trophy, UserPlus, Zap, type LucideIcon } from 'lucide-react'
import { useStore, todaysDailySeed, slotOf } from '@game/store'
import { dailySettings } from '@game/logic/setup'
import { modeLabel } from '@game/logic/modes'
import { resumeStatus } from '@game/logic/resume'
import { dailyArenaGameSettings, dailyArenaLine, dailyArenaSettings } from '@game/logic/arenaDaily'
import { weeklyPlan } from '@game/logic/weekly'
import { weeklyThemeName } from '@game/logic/weeklyThemes'
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
import { countPhrase } from '../screenText'

/** "69,155" becomes "69k": the hero shows three figures, not a sentence. */
function compact(n: number): string {
  return n >= 10_000 ? `${Math.floor(n / 1000)}k` : n.toLocaleString()
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
      Start
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
                <b>
                  {i + 1}. {step.title}
                </b>
                <span>{step.line}</span>
              </span>
            </li>
          )
        })}
      </ol>
      <div className="first-go">
        <button type="button" className="btn primary big" disabled={!ready} onClick={onPlay} data-testid="first-draft">
          {ready ? 'Play your first draft' : 'Loading…'}
          {ready && <ArrowRight size={18} aria-hidden="true" />}
        </button>
        <span className="first-note">
          <Clock size={13} aria-hidden="true" /> About 5 minutes, no sign-up.{' '}
          <button type="button" className="linklike" onClick={onHowTo}>
            How it works
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
  const dailyDone = !!profile.dailyResults[`daily-${today}`]
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
  const playArenaDaily = () => {
    if (!u || !dailyReady) return
    if (arenaUnderWay === 'active') return go('game')
    if (arenaUnderWay === 'parked') return resumeGame('arena')
    const open = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
    if (open && !confirm(`Start today's arena? Your current ${modeLabel(open, 'short')} run (${open.settings.teamName}) will be abandoned.`)) return
    // Played already: a second go is practice, and says so before it replaces today's summary
    if (!open && arenaDone && !confirm(`You have played today's Daily Arena (${arenaDone.label}). Play it again? Your result and streak stay as they are.`)) return
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
  const playFirstDraft = () => {
    const settings = u && dailyReady ? firstDraftSettings(u, randomSeed()) : null
    if (settings) withViewTransition(() => startGame(settings))
  }
  const streakMeta = (done: string | null, streak: number | undefined, fallback: string) => (done ? `${done}${streak ? ` · streak ${streak}` : ''}` : streak ? `Streak ${streak} · ${fallback}` : fallback)
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
          <p className="tag">Spin the wheel. Draft the XI. Manage the season.</p>
          {newcomer ? (
            <FirstRun ready={dailyReady} onPlay={playFirstDraft} onHowTo={() => go('howto')} />
          ) : (
          <>
          <dl className="hero-stats" aria-live="polite">
            {u ? (
              <>
                <div>
                  <dt>Player-seasons</dt>
                  <dd>{compact(playerSeasons)}</dd>
                </div>
                <div>
                  <dt>Leagues</dt>
                  <dd>{u.available.length}</dd>
                </div>
                <div>
                  <dt>Seasons</dt>
                  <dd>
                    {seasonLabel(u.firstSeason).slice(0, 4)}–{seasonLabel(u.lastSeason).slice(-2)}
                  </dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Database</dt>
                <dd>Loading…</dd>
              </div>
            )}
          </dl>
          {u && (
            <div className="row wrap hero-flags" role="group" aria-label="Leagues">
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
                  <div className="resume-name" title={`${modeLabel(game, 'short')} · ${game.settings.teamName}`}>
                    {modeLabel(game, 'short')} · {game.settings.teamName}
                  </div>
                  <div className="small muted resume-status">{resumeStatus(game)}</div>
                </div>
              </div>
              <div className="row resume-actions">
                <button className="btn primary" onClick={() => go('game')}>
                  Continue
                </button>
                <button className="btn danger ghost" onClick={() => confirm('Abandon the current game? This cannot be undone.') && abandonGame()}>
                  Abandon
                </button>
              </div>
            </div>
          )}
          {Object.entries(parked).map(([slot, g]) => (
            <div key={slot} className="panel resume-card parked row between" data-testid={`resume-parked-${slot}`}>
              <div className="row resume-who">
                <TeamBadge code={g.settings.shortName} size={36} />
                <div className="resume-text">
                  <div className="resume-name" title={`${modeLabel(g, 'short')} (parked) · ${g.settings.teamName}`}>
                    {modeLabel(g, 'short')} (parked) · {g.settings.teamName}
                  </div>
                  <div className="small muted resume-status">{resumeStatus(g)}</div>
                </div>
              </div>
              <div className="row resume-actions">
                <button className="btn" onClick={() => resumeGame(slot)}>
                  Resume
                </button>
                <button className="btn danger ghost" onClick={() => confirm('Discard this parked game?') && discardParked(slot)}>
                  Discard
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
            <h3>Quick Draft</h3>
            <p>Eleven spins, one XI, a whole season.</p>
            <span className="foot">
              <TimeTag>5 min</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <div className="mode-card daily" data-testid="daily-card">
          <button type="button" className="mode-card-body" onClick={() => go('setup', 'daily')} title="Open the full setup to name your team">
            <ModeArt kind="daily" icon={CalendarDays} />
            <span className="mode-text">
              <h3>Daily Challenge</h3>
              <p>Same spins for everyone, every day.</p>
              <span className="foot">
                <TimeTag>5 min</TimeTag>
                {daily && u && (
                  <span className="daily-today" title={`Today: a ${formationName(daily.formationId)}, ${u.leagues.find((l) => l.id === u.clubById[daily.host]?.leagueId)?.name ?? ''} ${seasonLabel(daily.season)}`}>
                    <LeagueFlag leagueId={u.clubById[daily.host]?.leagueId ?? 'england'} />
                    {formationName(daily.formationId)} · {seasonLabel(daily.season)}
                  </span>
                )}
                {pin && dailyStart && (
                  <span className={`ranked-tag${dailyStart.ranked ? ' on' : ''}`} data-testid="daily-ranked" title={dailyStart.ranked ? 'Every score on the world leaderboard is checked by replay' : PIN_NOTE[pinStanding(pin, dailyStart.source) as Exclude<PinStanding, 'ranked'>]}>
                    {PIN_TAG[dailyStart.ranked ? 'ranked' : pinStanding(pin, dailyStart.source)]}
                  </span>
                )}
                {profile.dailyStreak > 0 && (
                  <span className="streak" title={dailyDone ? 'Played today' : 'Daily streak'}>
                    <Flame size={13} />
                    {profile.dailyStreak}
                  </span>
                )}
              </span>
            </span>
          </button>
          <button type="button" className={`btn block${newcomer ? '' : ' primary'}`} disabled={!dailyReady} onClick={playDaily} data-testid="daily-play">
            {!dailyReady ? 'Loading…' : dailyUnderWay ? "Continue today's puzzle" : dailyDone ? 'Play it again' : "Play today's puzzle"}
          </button>
        </div>
        <button className="mode-card" onClick={() => go('setup', 'season')}>
          <ModeArt kind="season" icon={ClipboardList} />
          <span className="mode-text">
            <h3>Season</h3>
            <p>Draft 18, then manage every week.</p>
            <span className="foot">
              <TimeTag>45 min</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'dynasty')}>
          <ModeArt kind="dynasty" icon={Crown} />
          <span className="mode-text">
            <h3>Dynasty</h3>
            <p>Season mode that never ends.</p>
            <span className="foot">
              <TimeTag>Career</TimeTag>
            </span>
            <GoLabel />
          </span>
        </button>
      </div>

      {/* The casual modes: one sitting each, beside the four ways to play above */}
      <div className="home-tiles casual" data-testid="casual-row" role="group" aria-label="More ways to play">
        <Tile icon={Zap} testId="arena-daily-card" title="Daily Arena" meta={streakMeta(arenaDone ? `Played: ${arenaDone.label}` : null, profile.arenaDaily?.streak, u ? dailyArenaLine(u, arenaToday) : 'Same draw for everyone')} onClick={playArenaDaily} disabled={!dailyReady} />
        <Tile icon={CalendarRange} testId="weekly-card" title="Weekly Challenge" meta={streakMeta(weekDone ? `Played: ${weekDone.points} pts` : null, profile.weekly?.streak, weekPlan ? `${weeklyThemeName(weekPlan.theme) || 'This week'} · ends Sunday` : 'One themed wheel a week')} onClick={playWeekly} disabled={!u} />
        <Tile icon={Award} testId="arena-cup-card" title="The Cup" meta="Draft 16, win a knockout" onClick={() => openArenaSetup('cup')} />
        <Tile icon={ChevronsUp} testId="arena-gauntlet-card" title="The Gauntlet" meta="Climb 15 rungs, lose once and out" onClick={() => openArenaSetup('gauntlet')} />
        <Tile icon={Timer} testId="runin-card" title="Run-in" meta="Take over a real club, ten games left" onClick={() => go('setup', 'runin')} />
      </div>

      <div className="home-tiles">
        <Tile icon={Swords} title="Head-to-head" meta="Two managers, one device" onClick={() => go('h2h')} />
        {onlineAvailable() && <Tile icon={Globe} title="World leaderboard" meta="Daily, weekly and all-time, by country" onClick={() => go('world')} testId="world-card" />}
        <Tile icon={Search} title="Explore database" meta={u ? `${u.available.length} leagues of real squads` : 'Real squads since 2008-09'} onClick={() => go('explore')} />
        <Tile icon={Trophy} title="Profile" meta={`${countPhrase(profile.seasonsSimulated, 'seasons')} · ${countPhrase(achievements, 'achievements')}`} onClick={() => go('profile')} />
        <Tile icon={BookOpen} title="How it works" meta="The wheel, matches, the board" onClick={() => go('howto')} />
      </div>
      <p className="muted small" style={{ marginTop: 16, textAlign: 'center' }}>
        Free, no ads, no account needed.{' '}
        <button className="btn ghost sm" onClick={() => go('privacy')} data-testid="privacy-link">
          Privacy and fair play
        </button>
      </p>
    </div>
  )
}
