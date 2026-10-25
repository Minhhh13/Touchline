import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, CalendarDays, ClipboardList, Clock, Crown, Dices, Flame, Search, Swords, Trophy, type LucideIcon } from 'lucide-react'
import { useStore, todaysDailySeed } from '@game/store'
import { dailySettings } from '@game/logic/setup'
import { seasonLabel, formationName } from '../format'
import { TeamBadge } from '../components/bits'
import { Lockup } from '../components/Logo'
import { LeagueFlag } from '../components/Flag'
import { HeroArt, ModeArt as ModeScene, type ModeArtKind } from '../components/Art'
import { withViewTransition } from '../motion'

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

function Tile({ icon: Icon, title, meta, onClick }: { icon: LucideIcon; title: string; meta: string; onClick: () => void }) {
  return (
    <button type="button" className="home-tile" onClick={onClick}>
      <span className="tile-icon">
        <Icon size={20} />
      </span>
      <span className="tile-text">
        <b>{title}</b>
        <span>{meta}</span>
      </span>
    </button>
  )
}

export function Home() {
  const { universe: u, game, go: goNow, abandonGame, profile, parked, resumeGame, discardParked, loadedLeagues } = useStore()
  // Leaving Home for another screen runs as a View Transition where the browser has one (motion.ts)
  const go = (...args: Parameters<typeof goNow>) => withViewTransition(() => goNow(...args))
  const playerSeasons = u ? u.available.reduce((s, l) => s + l.playerSeasons, 0) : 0
  const today = new Date().toISOString().slice(0, 10)
  const dailyDone = !!profile.dailyResults[`daily-${today}`]
  // Today's puzzle is fixed for everyone, so the card can start it in one tap; the Setup screen only adds a team name
  const dailyReady = !!u && loadedLeagues.includes('england')
  const daily = dailyReady ? dailySettings(u, todaysDailySeed()) : null
  // Today's puzzle already under way continues rather than restarting; an unfinished quick draft in the same slot is only dropped on a yes
  const dailyUnderWay = !!game && game.settings.mode === 'daily' && game.settings.seed === todaysDailySeed() && game.phase !== 'summary'
  const playDaily = () => {
    if (!u || !dailyReady) return
    if (dailyUnderWay) {
      go('game')
      return
    }
    // The button opens the Daily setup, as the card does: the team name, today's puzzle, and Start Draft there
    go('setup', 'daily')
  }
  const achievements = Object.keys(profile.achievements).length
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
            <div className="row wrap hero-flags" aria-label="Leagues">
              {u.available.map((l) => (
                <LeagueFlag key={l.id} leagueId={l.id} label={l.name} size={24} />
              ))}
            </div>
          )}
        </div>
      </section>

      {game && (
        <div className="panel resume-card row between wrap">
          <div className="row">
            <TeamBadge code={game.settings.shortName} size={36} />
            <div>
              <div style={{ fontWeight: 700 }}>
                {game.settings.teamName} · {game.settings.mode === 'quick' ? 'Quick draft' : game.settings.mode === 'daily' ? 'Daily challenge' : game.settings.mode === 'season' ? 'Season' : `Dynasty · Year ${game.year}`}
              </div>
              <div className="small muted">
                {game.phase === 'draft' ? 'Drafting' : game.phase === 'kickoff' ? 'Kick-off' : game.phase === 'january' ? 'January window' : game.phase === 'summary' ? 'Season complete' : game.season ? `Matchweek ${game.season.matchweek} of ${game.season.matchweeks} · ${seasonLabel(game.settings.leagueSeason)}` : 'In progress'}
              </div>
            </div>
          </div>
          <div className="row">
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
        <div key={slot} className="panel resume-card parked row between wrap">
          <div className="row">
            <TeamBadge code={g.settings.shortName} size={36} />
            <div>
              <div style={{ fontWeight: 700 }}>
                {g.settings.teamName} · {g.settings.mode === 'quick' ? 'Quick draft' : g.settings.mode === 'daily' ? 'Daily challenge' : g.settings.mode === 'season' ? 'Season' : `Dynasty · Year ${g.year}`} (parked)
              </div>
              <div className="small muted">{g.phase === 'draft' ? 'Drafting' : g.phase === 'kickoff' ? 'Kick-off' : g.phase === 'january' ? 'January window' : g.season ? `Matchweek ${g.season.matchweek} of ${g.season.matchweeks} · ${seasonLabel(g.settings.leagueSeason)}` : 'In progress'}</div>
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => resumeGame(slot)}>
              Resume
            </button>
            <button className="btn danger ghost" onClick={() => confirm('Discard this parked game?') && discardParked(slot)}>
              Discard
            </button>
          </div>
        </div>
      ))}

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
                {profile.dailyStreak > 0 && (
                  <span className="streak" title={dailyDone ? 'Played today' : 'Daily streak'}>
                    <Flame size={13} />
                    {profile.dailyStreak}
                  </span>
                )}
              </span>
            </span>
          </button>
          <button type="button" className="btn primary block" disabled={!dailyReady} onClick={playDaily} data-testid="daily-play">
            {!dailyReady ? 'Loading…' : dailyUnderWay ? "Continue today's puzzle" : dailyDone ? 'Play it again' : "Play today's puzzle"}
          </button>
        </div>
        <button className="mode-card" onClick={() => go('setup', 'season')}>
          <ModeArt kind="season" icon={ClipboardList} />
          <span className="mode-text">
            <h3>Season</h3>
            <p>Draft eighteen, then manage every week.</p>
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

      <div className="home-tiles">
        <Tile icon={Swords} title="Head-to-head" meta="Two managers, one device" onClick={() => go('h2h')} />
        <Tile icon={Search} title="Explore database" meta={u ? `${u.available.length} leagues of real squads` : 'Real squads since 2008-09'} onClick={() => go('explore')} />
        <Tile icon={Trophy} title="Profile" meta={`${profile.seasonsSimulated} seasons · ${achievements} achievements`} onClick={() => go('profile')} />
        <Tile icon={BookOpen} title="How it works" meta="The wheel, matches, the board" onClick={() => go('howto')} />
      </div>
    </div>
  )
}
