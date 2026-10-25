import { useEffect, useRef } from 'react'
import { useStore } from '@game/store'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Draft } from './screens/Draft'
import { Summary } from './screens/Summary'
import { Dugout } from './screens/Dugout'
import { MatchScreen } from './screens/MatchScreen'
import { Explore } from './screens/Explore'
import { ProfileScreen } from './screens/ProfileScreen'
import { HowTo } from './screens/HowTo'
import { H2HScreen } from './screens/H2H'
import { Arena } from './screens/Arena'
import { ArenaSetup } from './screens/ArenaSetup'
import { ArenaChallengeSetup } from './screens/ArenaChallengeSetup'
import { isArenaPayload } from '@engine/challenge'
import { ArenaSummary } from './screens/ArenaSummary'
import { Modal, Toast } from './components/bits'

export function App() {
  const { universe, loading, loadError, loadData, screen, go, game, profile, offseason, dismissOffseason, abandonGame, openChallenge, setupMode, pendingChallenge } = useStore()
  const hashHandled = useRef(false)

  useEffect(() => {
    void loadData()
  }, [loadData])

  // A challenge link (`#c=...`) opens once the default league is in: the hash is cleared so a reload does not reopen it
  useEffect(() => {
    if (!universe) return
    const open = () => {
      const m = /^#c=([A-Za-z0-9_-]+)$/.exec(location.hash)
      if (!m) return
      history.replaceState(null, '', location.pathname + location.search)
      void openChallenge(m[1])
    }
    if (!hashHandled.current) {
      hashHandled.current = true
      open()
    }
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [universe, openChallenge])

  useEffect(() => {
    const root = document.documentElement
    if (profile.theme === 'auto') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', profile.theme)
  }, [profile.theme])

  if (loadError) {
    return (
      <div className="page">
        <div className="panel">
          <h2>Could not load the player database</h2>
          <p className="muted">{loadError}</p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => loadData()}>
              Retry
            </button>
            {game && (
              <button className="btn" onClick={() => { abandonGame(); void loadData() }}>
                Discard the saved game and retry
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
  if (!universe || loading) {
    return (
      <div className="app">
        <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
          <div className="col" style={{ alignItems: 'center' }}>
            <div className="brand">
              <span className="mark">T</span>
              <span className="name">Touchline</span>
            </div>
            <div className="muted small">Loading eleven thousand player-seasons…</div>
          </div>
        </div>
      </div>
    )
  }

  let body: React.ReactNode
  if (screen === 'game' && game) {
    if (game.phase === 'draft') body = <Draft />
    else if (game.phase === 'match') body = <MatchScreen />
    else if (game.phase === 'summary') body = game.arena ? <ArenaSummary /> : <Summary />
    else body = game.arena ? <Arena /> : <Dugout />
  } else if (screen === 'setup') body = setupMode === 'arena' ? (pendingChallenge && isArenaPayload(pendingChallenge.payload) ? <ArenaChallengeSetup /> : <ArenaSetup />) : <Setup />
  else if (screen === 'h2h') body = <H2HScreen />
  else if (screen === 'explore') body = <Explore />
  else if (screen === 'profile') body = <ProfileScreen />
  else if (screen === 'howto') body = <HowTo />
  else body = <Home />

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('home')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('home')}>
          <span className="mark">T</span>
          <span className="name">Touchline</span>
        </div>
        <nav>
          <button className={screen === 'home' ? 'active' : ''} onClick={() => go('home')}>
            Home
          </button>
          {game && (
            <button className={screen === 'game' ? 'active' : ''} onClick={() => go('game')}>
              {game.phase === 'draft' ? 'Draft' : game.phase === 'summary' ? 'Summary' : game.arena ? 'Arena' : 'Dugout'}
            </button>
          )}
          <button className={screen === 'h2h' ? 'active' : ''} onClick={() => go('h2h')}>
            Head-to-head
          </button>
          <button className={screen === 'explore' ? 'active' : ''} onClick={() => go('explore')}>
            Explore
          </button>
          <button className={screen === 'profile' ? 'active' : ''} onClick={() => go('profile')}>
            Record
          </button>
          <button className={screen === 'howto' ? 'active' : ''} onClick={() => go('howto')}>
            How it works
          </button>
        </nav>
      </header>
      {body}
      <Toast />
      <Modal open={!!offseason} onClose={dismissOffseason} title="The summer">
        {offseason && (
          <div className="col">
            {offseason.retired.length > 0 && (
              <p>
                <b>Retired:</b> {offseason.retired.join(', ')}
              </p>
            )}
            {offseason.expired.length > 0 && (
              <p>
                <b>Left on expired contracts:</b> {offseason.expired.join(', ')}
              </p>
            )}
            {offseason.returned.length > 0 && (
              <p>
                <b>Back to their clubs after loans:</b> {offseason.returned.join(', ')}
              </p>
            )}
            {offseason.improved.length > 0 && (
              <p>
                <b>Improved:</b> {offseason.improved.map((x) => `${x.name} ${x.from}→${x.to}`).join(', ')}
              </p>
            )}
            {offseason.declined.length > 0 && (
              <p>
                <b>Declined:</b> {offseason.declined.map((x) => `${x.name} ${x.from}→${x.to}`).join(', ')}
              </p>
            )}
            <p className="muted small">You have bonus spins to rebuild, and the summer market is open from the Dugout once the season begins. Finish the draft to carry on.</p>
            <button className="btn primary" onClick={dismissOffseason}>
              To the draft
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
