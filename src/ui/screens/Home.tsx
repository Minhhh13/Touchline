import { useStore, todaysDailySeed, slotOf } from '@game/store'
import { dailyGameSettings, dailySettings } from '@game/logic/setup'
import { MODE_TITLE, modeLabel } from '@game/logic/modes'
import { arenaStatus } from '@game/logic/arena'
import { dailyArenaGameSettings, dailyArenaLine, dailyArenaSettings } from '@game/logic/arenaDaily'
import { weeklyPlan, weeklySettings } from '@game/logic/weekly'
import { weeklyThemeName } from '@game/logic/weeklyThemes'
import { TIER_LABEL } from '@engine/season'
import { arenaDailySeed, weeklySeed } from '@engine/rng'
import { seasonLabel } from '../format'
import { ClubBadge } from '../components/bits'

export function Home() {
  const { universe: u, game, go, abandonGame, profile, parked, resumeGame, discardParked, startGame, loadedLeagues, openArenaSetup, startWeekly, loadingLeagues } = useStore()
  const playerSeasons = u ? u.available.reduce((s, l) => s + l.playerSeasons, 0) : 0
  const players = u ? u.available.reduce((s, l) => s + l.players, 0) : 0
  const clubCount = u ? u.available.reduce((s, l) => s + l.clubs, 0) : 0
  const today = new Date().toISOString().slice(0, 10)
  const dailyDone = !!profile.dailyResults[`daily-${today}`]
  // Today's puzzle is fixed for everyone, so the card can start it in one tap; the Setup screen only adds a team name
  const dailyReady = !!u && loadedLeagues.includes('england')
  const daily = dailyReady ? dailySettings(u, todaysDailySeed()) : null
  // Today's puzzle already under way continues rather than restarting; an unfinished quick draft in the same slot is only dropped on a yes
  const isTodaysDaily = (g: typeof game) => !!g && g.settings.mode === 'daily' && g.settings.seed === todaysDailySeed() && g.phase !== 'summary'
  const dailyUnderWay = isTodaysDaily(game) || isTodaysDaily(parked.quick)
  const playDaily = () => {
    if (!u || !dailyReady) return
    if (isTodaysDaily(game)) {
      go('game')
      return
    }
    if (isTodaysDaily(parked.quick)) return resumeGame('quick')
    // A parked game in the quick slot (a Weekly parked by an arena run) is dropped by the start too, so it asks as well
    const open = [game, parked.quick].find((g) => g && slotOf(g) === 'quick' && g.phase !== 'summary')
    if (open && !confirm(`Start today's puzzle? Your current ${MODE_TITLE[open.settings.mode]} (${open.settings.teamName}) will be abandoned.`)) return
    startGame(dailyGameSettings(u, todaysDailySeed()))
  }
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
    startGame(dailyArenaGameSettings(u, arenaSeed))
  }
  // The Weekly Challenge: the week's packs load when it starts; the card names the season once its league is in
  const weekSeed = weeklySeed()
  const weekPlan = u ? weeklyPlan(u, weekSeed) : null
  const week = u && weekPlan && loadedLeagues.includes(weekPlan.leagueId) ? weeklySettings(u, weekSeed) : null
  const weekDone = profile.weekly?.results[weekSeed]
  const isThisWeek = (g: typeof game) => !!g && g.settings.mode === 'weekly' && g.settings.seed === weekSeed && g.phase !== 'summary'
  const weekUnderWay = isThisWeek(game) ? 'active' : isThisWeek(parked.quick) ? 'parked' : null
  const playWeekly = () => {
    if (!u) return
    if (weekUnderWay === 'active') return go('game')
    if (weekUnderWay === 'parked') return resumeGame('quick')
    const open = [game, parked.quick].find((g) => g && slotOf(g) === 'quick' && g.phase !== 'summary')
    if (open && !confirm(`Start this week's challenge? Your current ${modeLabel(open, 'short')} (${open.settings.teamName}) will be abandoned.`)) return
    void startWeekly(weekSeed)
  }
  const leagueName = (id: string) => u?.available.find((l) => l.id === id)?.name ?? id
  return (
    <div className="page">
      <section className="hero">
        <h1>Touchline</h1>
        <div className="tag">Spin the wheel. Draft the XI. Manage the season.</div>
        <p className="muted small" style={{ marginTop: 10 }}>
          {u ? `${playerSeasons.toLocaleString()} real player-seasons · ${players.toLocaleString()} players · ${clubCount} clubs · ${u.available.length} leagues · ${seasonLabel(u.firstSeason)} to ${seasonLabel(u.lastSeason)}` : 'Loading the database…'}
        </p>
      </section>

      {game && (
        <div className="panel row between wrap" style={{ marginBottom: 14 }}>
          <div className="row">
            <ClubBadge clubId={game.settings.hostClubId} size={36} />
            <div>
              <div style={{ fontWeight: 700 }}>
                {game.settings.teamName} · {modeLabel(game, 'short')}
              </div>
              <div className="small muted">
                {game.arena ? arenaStatus(game) : game.phase === 'draft' ? 'Drafting' : game.phase === 'summary' ? 'Season complete' : game.season ? `Matchweek ${game.season.matchweek} of ${game.season.matchweeks} · ${seasonLabel(game.settings.leagueSeason)}` : 'In progress'}
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
        <div key={slot} className="panel row between wrap" style={{ marginBottom: 14, opacity: 0.9 }}>
          <div className="row">
            <ClubBadge clubId={g.settings.hostClubId} size={36} />
            <div>
              <div style={{ fontWeight: 700 }}>
                {g.settings.teamName} · {modeLabel(g, 'short')} (parked)
              </div>
              <div className="small muted">{g.arena ? arenaStatus(g) : g.phase === 'draft' ? 'Drafting' : g.season ? `Matchweek ${g.season.matchweek} of ${g.season.matchweeks} · ${seasonLabel(g.settings.leagueSeason)}` : 'In progress'}</div>
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
      <div className="row between wrap" style={{ marginBottom: 8 }}>
        <h2>Today and this week</h2>
        <span className="small muted">The same puzzles for everyone, with streaks. Days and weeks run on UTC.</span>
      </div>
      <div className="modes three" data-testid="today-row" style={{ marginBottom: 18 }}>
        <div className="mode-card daily" data-testid="daily-card">
          <button type="button" className="mode-card-body" onClick={() => go('setup', 'daily')} title="Open the full setup to name your team">
            <span className="icon">📅</span>
            <h3>Daily Challenge</h3>
            <p>
              Everyone gets the same spins today. Build the best XI from the same wheel and compare.
              {daily && u && (
                <>
                  {' '}
                  Today: a <b>{daily.formationId}</b> as <b>{u.clubById[daily.host]?.name ?? daily.host}</b>, {seasonLabel(daily.season)}.
                </>
              )}
            </p>
            <span className="foot">{dailyDone ? `Played today · streak ${profile.dailyStreak}` : profile.dailyStreak ? `Streak ${profile.dailyStreak}` : 'New puzzle every day'} · tap to name your team</span>
          </button>
          <button type="button" className="btn primary block" disabled={!dailyReady} onClick={playDaily} data-testid="daily-play">
            {!dailyReady ? 'Loading…' : dailyUnderWay ? "Continue today's puzzle" : dailyDone ? 'Play it again' : "Play today's puzzle"}
          </button>
        </div>
        <div className="mode-card daily" data-testid="arena-daily-card">
          <button type="button" className="mode-card-body" onClick={playArenaDaily} title="Play today's arena">
            <span className="icon">🏟️</span>
            <h3>Daily Arena</h3>
            <p>
              Everyone climbs the same ladder or faces the same draw today. Today: <b>{u ? dailyArenaLine(u, arenaToday) : arenaToday.format}</b>, a <b>{arenaToday.formationId}</b>.
            </p>
            <span className="foot" data-testid="arena-daily-foot">{arenaDone ? `Played: ${arenaDone.label} · streak ${profile.arenaDaily?.streak ?? 1}` : profile.arenaDaily?.streak ? `Streak ${profile.arenaDaily.streak}` : 'The Gauntlet and the Cup in turn'}</span>
          </button>
          <button type="button" className="btn primary block" disabled={!dailyReady} onClick={playArenaDaily} data-testid="arena-daily-play">
            {!dailyReady ? 'Loading…' : arenaUnderWay ? "Continue today's arena" : arenaDone ? 'Play it again' : "Play today's arena"}
          </button>
        </div>
        <div className="mode-card daily" data-testid="weekly-card">
          <button type="button" className="mode-card-body" onClick={() => go('setup', 'weekly')} title="Open the setup to name your team">
            <span className="icon">🗓️</span>
            <h3>Weekly Challenge</h3>
            <p>
              One themed wheel a week, for everyone.{' '}
              {weekPlan && (
                <>
                  <b style={{ whiteSpace: 'nowrap' }}>{weekPlan.week}</b> · <b>{weeklyThemeName(weekPlan.theme)}</b> in {leagueName(weekPlan.leagueId)}
                  {week ? ` ${seasonLabel(week.season)}` : ''} · ends Sunday
                </>
              )}
            </p>
            <span className="foot" data-testid="weekly-foot">{weekDone ? `Played: ${weekDone.points} pts, ${TIER_LABEL[weekDone.tier]} · streak ${profile.weekly?.streak ?? 1}` : profile.weekly?.streak ? `Streak ${profile.weekly.streak}` : 'New theme every Monday'} · tap to name your team</span>
          </button>
          <button type="button" className="btn primary block" disabled={!u || loadingLeagues} onClick={playWeekly} data-testid="weekly-play">
            {loadingLeagues ? 'Loading…' : weekUnderWay ? "Continue this week's" : weekDone ? 'Play it again' : "Play this week's"}
          </button>
        </div>
      </div>
      <div className="modes three">
        <button className="mode-card" onClick={() => go('setup', 'quick')}>
          <span className="icon">🎡</span>
          <h3>Quick Draft</h3>
          <p>The 38-0 classic. Spin for a club and season, draft one player, repeat eleven times, simulate the season instantly.</p>
          <span className="foot">5 minutes · shareable result</span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'season')}>
          <span className="icon">📋</span>
          <h3>Season</h3>
          <p>Draft a squad of eighteen, then manage it week by week: tactics, roles, rotation, injuries, the cup, the January window, the board.</p>
          <span className="foot">15 to 45 minutes · sim to the big matches</span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'dynasty')}>
          <span className="icon">👑</span>
          <h3>Dynasty</h3>
          <p>Season mode that never ends. Players age, contracts expire, summer windows open and the league moves on a year at a time.</p>
          <span className="foot">Multi-season career</span>
        </button>
      </div>

      <div className="row between wrap" style={{ marginTop: 18, marginBottom: 8 }}>
        <h2>Arena</h2>
        <span className="small muted">One sitting, real club-seasons, no season attached.</span>
      </div>
      <div className="modes" data-testid="arena-row">
        <button className="mode-card" onClick={() => openArenaSetup('cup')} data-testid="arena-cup-card">
          <span className="icon">🏆</span>
          <h3>The Cup</h3>
          <p>Draft sixteen, then a knockout of real club-seasons in one sitting: seeded draws, four days between ties, bans that carry and penalties when it is level. Eight, sixteen or thirty-two clubs, or one final.</p>
          <span className="foot">10 minutes · lift a trophy tonight</span>
        </button>
        <button className="mode-card" onClick={() => openArenaSetup('gauntlet')} data-testid="arena-gauntlet-card">
          <span className="icon">🪜</span>
          <h3>The Gauntlet</h3>
          <p>Draft fourteen, then climb fifteen rungs of real club-seasons, each stronger than the last. Lose once and it is over: one lifeline, a bonus spin every second rung, and tired legs to rotate.</p>
          <span className="foot">5 minutes · how far can you climb?</span>
        </button>
      </div>

      <div className="row between wrap" style={{ marginTop: 18, marginBottom: 8 }}>
        <h2>Scenarios</h2>
        <span className="small muted">A real club, a real season, the job half done.</span>
      </div>
      <div className="modes" data-testid="scenario-row">
        <button className="mode-card" onClick={() => go('setup', 'runin')} data-testid="runin-card">
          <span className="icon">⏱️</span>
          <h3>Run-in</h3>
          <p>Take over a real club at matchweek 28 with its real squad and a brief: win the title, reach the top four or stay up. Four spins to strengthen, then the last ten games, judged against what really happened.</p>
          <span className="foot">10 minutes · ten games to save a season</span>
        </button>
      </div>

      <div className="grid four" style={{ marginTop: 16 }}>
        <button className="panel" style={{ textAlign: 'left', cursor: 'pointer', borderColor: 'var(--line-2)' }} onClick={() => go('h2h')}>
          <h3>🤝 Head-to-head</h3>
          <p className="muted small">Two managers on one device draft from the same spins, then both sides play the same season. Settle it properly.</p>
        </button>
        <button className="panel" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('explore')}>
          <h3>Explore the database</h3>
          <p className="muted small">Every club-season in {u ? `${u.available.length} leagues` : 'seven leagues'} since 2008-09, with real squads and ratings. Settle the argument before you spin.</p>
        </button>
        <button className="panel" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('profile')}>
          <h3>Your record</h3>
          <p className="muted small">
            {profile.seasonsSimulated} seasons simulated · {Object.keys(profile.achievements).length} achievements
          </p>
        </button>
        <button className="panel" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('howto')}>
          <h3>How it works</h3>
          <p className="muted small">The wheel, the draft rules, how matches are simulated and what the board expects.</p>
        </button>
      </div>
    </div>
  )
}
