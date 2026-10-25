import { useStore, todaysDailySeed, slotOf } from '@game/store'
import { dailyGameSettings, dailySettings } from '@game/logic/setup'
import { seasonLabel } from '../format'
import { ClubBadge } from '../components/bits'

export function Home() {
  const { universe: u, game, go, abandonGame, profile, parked, resumeGame, discardParked, startGame, loadedLeagues } = useStore()
  const playerSeasons = u ? u.available.reduce((s, l) => s + l.playerSeasons, 0) : 0
  const players = u ? u.available.reduce((s, l) => s + l.players, 0) : 0
  const clubCount = u ? u.available.reduce((s, l) => s + l.clubs, 0) : 0
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
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !confirm(`Start today's puzzle? Your current ${game.settings.mode === 'daily' ? 'Daily Challenge' : 'Quick Draft'} (${game.settings.teamName}) will be abandoned.`)) return
    startGame(dailyGameSettings(u, todaysDailySeed()))
  }
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
                {game.settings.teamName} · {game.settings.mode === 'quick' ? 'Quick draft' : game.settings.mode === 'daily' ? 'Daily challenge' : game.settings.mode === 'season' ? 'Season' : `Dynasty · Year ${game.year}`}
              </div>
              <div className="small muted">
                {game.phase === 'draft' ? 'Drafting' : game.phase === 'summary' ? 'Season complete' : game.season ? `Matchweek ${game.season.matchweek} of ${game.season.matchweeks} · ${seasonLabel(game.settings.leagueSeason)}` : 'In progress'}
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
                {g.settings.teamName} · {g.settings.mode === 'quick' ? 'Quick draft' : g.settings.mode === 'daily' ? 'Daily challenge' : g.settings.mode === 'season' ? 'Season' : `Dynasty · Year ${g.year}`} (parked)
              </div>
              <div className="small muted">{g.phase === 'draft' ? 'Drafting' : g.season ? `Matchweek ${g.season.matchweek} of ${g.season.matchweeks} · ${seasonLabel(g.settings.leagueSeason)}` : 'In progress'}</div>
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
          <span className="icon">🎡</span>
          <h3>Quick Draft</h3>
          <p>The 38-0 classic. Spin for a club and season, draft one player, repeat eleven times, simulate the season instantly.</p>
          <span className="foot">5 minutes · shareable result</span>
        </button>
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
        <button className="mode-card" onClick={() => go('setup', 'season')}>
          <span className="icon">📋</span>
          <h3>Season</h3>
          <p>Draft a squad of eighteen, then manage it week by week: tactics, roles, rotation, injuries, the cup, the January window, the board.</p>
          <span className="foot">45 minutes · deep</span>
        </button>
        <button className="mode-card" onClick={() => go('setup', 'dynasty')}>
          <span className="icon">👑</span>
          <h3>Dynasty</h3>
          <p>Season mode that never ends. Players age, contracts expire, summer windows open and the league moves on a year at a time.</p>
          <span className="foot">Multi-season career</span>
        </button>
      </div>

      <div className="grid three" style={{ marginTop: 16 }}>
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
