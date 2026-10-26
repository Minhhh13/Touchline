import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@game/store'
import { Home } from './screens/Home'
import { Setup } from './screens/Setup'
import { Draft } from './screens/Draft'
import { Summary } from './screens/Summary'
import { KickOff } from './screens/KickOff'
import { SeasonPlayback } from './screens/SeasonPlayback'
import { Dugout } from './screens/Dugout'
import { MatchScreen } from './screens/MatchScreen'
import { Explore } from './screens/Explore'
import { ProfileScreen } from './screens/ProfileScreen'
import { HowTo } from './screens/HowTo'
import { H2HScreen } from './screens/H2H'
import { Privacy } from './screens/Privacy'
import { Arena } from './screens/Arena'
import { ArenaSetup } from './screens/ArenaSetup'
import { ArenaChallengeSetup } from './screens/ArenaChallengeSetup'
import { isArenaPayload } from '@engine/challenge'
import { ArenaSummary } from './screens/ArenaSummary'
import { RunInSetup } from './screens/RunInSetup'
import { RunInSummary } from './screens/RunInSummary'
import { Bar, ClubBadge, Modal, Toast, useViewerFlag } from './components/bits'
import { DIGEST_GROUP_CAP, digestTitle, type SimDigest } from '@game/logic/digest'
import { unseenNews } from '@game/logic/news'
import type { NewsItem } from '@engine/season'
import { clubName, ordinal, outcomeClass } from './format'
import { developmentLists } from './screenText'
import { Lockup, Logo } from './components/Logo'
import { rememberThemePreference, toggledTheme, useResolvedTheme } from './theme'
import { withViewTransition } from './motion'
import { useArenaWarmup } from './useArenaWarmup'
import './sound/boot'
import { Bandage, Banknote, BookOpen, ChevronDown, ChevronUp, ClipboardList, Dices, Globe, House, MessageSquare, Moon, RectangleVertical, Search, Sun, Swords, TrendingUp, Trophy } from 'lucide-react'

/** Per viewer: the top bar folded away for the full height (the toggle beside the theme switch, or the \ key). */
export const TOPBAR_HIDDEN_KEY = 'touchline-topbar-hidden'
import { WorldBoard } from './online/WorldBoard'
import { AccountChip } from './online/AccountChip'
import { AccountScreen } from './online/AccountPanel'
import { RoomScreen } from './online/Rooms'
import { parseGameHash } from '../online/core/codes'
import { onlineAvailable, openRoom, resolveShort } from '../online/api'

export function App() {
  const { universe, loading, loadError, loadData, screen, go, game, h2h, profile, setTheme, offseason, dismissOffseason, digest, dismissDigest, abandonGame, openChallenge, playback, setupMode, pendingChallenge } = useStore()
  // An arena run's field strengths, worked out in idle moments while it drafts
  useArenaWarmup()
  const hashHandled = useRef(false)
  const theme = useResolvedTheme(profile.theme)
  // Top-bar navigation and the theme flip run as View Transitions where the browser has them (motion.ts)
  const nav = (s: Parameters<typeof go>[0]) => withViewTransition(() => go(s))
  // The flip reads what is on screen when it runs, not when it was clicked, so a quick second tap inside the transition flips back
  const flipTheme = () => withViewTransition(() => setTheme(toggledTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark')))
  const [barHidden, toggleBar] = useViewerFlag(TOPBAR_HIDDEN_KEY)
  // Focus follows the control that replaces the one just pressed (the toggle and the restore pill sit in the same spot)
  const barToggled = useRef(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)
  // The top bar's real height (one row or two) as --topbar-h, so whatever scrolls into view stops clear of it (U3, U22)
  const [topbar, setTopbar] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const root = document.documentElement
    if (!topbar || barHidden) {
      root.style.setProperty('--topbar-h', '0px')
      return
    }
    const set = () => root.style.setProperty('--topbar-h', `${Math.ceil(topbar.getBoundingClientRect().height)}px`)
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(topbar)
    return () => ro.disconnect()
  }, [topbar, barHidden])
  const flipBar = () => {
    barToggled.current = true
    toggleBar()
  }
  useEffect(() => {
    if (!barToggled.current) return
    barToggled.current = false
    ;(barHidden ? restoreRef : toggleRef).current?.focus()
  }, [barHidden])
  // The \ key folds and restores the bar, except while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '\\' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      flipBar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    void loadData()
  }, [loadData])

  // A challenge link (`#c=...` long, `#s=K7Q2MX9A` short) opens once the default league is in: the hash is cleared so
  // a reload does not reopen it. A short code is resolved online, then opened exactly like a long link.
  useEffect(() => {
    if (!universe) return
    const open = () => {
      const h = parseGameHash(location.hash)
      if (!h) return
      // A head-to-head room link (`#h=K7Q2MX9A`) opens the room screen, which keeps the hash while it is open
      if (h.kind === 'h') {
        if (onlineAvailable()) {
          useStore.getState().go('room')
          void openRoom(h.code)
        } else {
          history.replaceState(null, '', location.pathname + location.search)
          useStore.getState().showToast('Online rooms need the online version of TouchLine.')
        }
        return
      }
      history.replaceState(null, '', location.pathname + location.search)
      if (h.kind === 'c') void openChallenge(h.payload)
      else
        void resolveShort(h.code).then((r) => {
          if (r.ok) void openChallenge(r.encoded)
          else useStore.getState().showToast(r.message)
        })
    }
    if (!hashHandled.current) {
      hashHandled.current = true
      open()
    }
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [universe, openChallenge])

  // Auto follows the device live (useResolvedTheme listens to prefers-color-scheme); the browser bar takes the page colour.
  // A layout effect, so the attribute changes in the same commit as the switch (the theme's View Transition captures it)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  }, [theme])
  useEffect(() => {
    rememberThemePreference(profile.theme)
  }, [profile.theme])

  // A new screen opens at its top, not where the last one was left (the summary is long; Explore used to open half-way down)
  const phase = game?.phase
  const h2hStage = !h2h ? 'setup' : h2h.result ? 'result' : 'draft'
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [screen, phase, h2hStage])

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
        <div className="page loading-screen" aria-busy="true">
          <div className="skeleton loading-hero">
            <Logo size="lg" />
            <div className="muted small" role="status">
              Loading the player database…
            </div>
          </div>
          <div className="loading-cards" aria-hidden="true">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        </div>
      </div>
    )
  }

  let body: React.ReactNode
  // One screen, one panel: on a desktop these screens fit the window and scroll inside their panels (the app shell);
  // The quick season's screens (Squad complete, the playback, January) are shell screens too, boxed side by side (`.page.fit`);
  // Setup and the match day keep their own layouts
  let shell = screen === 'home' || screen === 'h2h' || screen === 'room' || screen === 'explore' || screen === 'profile' || screen === 'howto' || screen === 'privacy' || screen === 'world' || screen === 'account'
  if (screen === 'game' && game) {
    // An arena shoot-out waiting for its takers is a shell screen too (`.page.fit`)
    shell = game.phase !== 'match' || !!game.arena?.pending
    if (game.phase === 'draft') body = <Draft />
    else if (game.phase === 'kickoff') body = <KickOff />
    // The quick season plays game by game: the first half to the January window, then (or all at once) to the summary.
    // A season with a bench stays here until the playback is closed, even after a reload, so its result is recorded once
    else if (game.phase === 'january' || (game.phase === 'summary' && (playback || game.quickOpen) && game.quickResult?.results?.length)) body = <SeasonPlayback key={game.phase} />
    else if (game.phase === 'match') body = <MatchScreen />
    else if (game.phase === 'summary') body = game.arena ? <ArenaSummary /> : game.settings.mode === 'runin' ? <RunInSummary /> : <Summary />
    else body = game.arena ? <Arena /> : <Dugout />
  } else if (screen === 'setup') body = setupMode === 'runin' ? <RunInSetup /> : setupMode === 'arena' ? (pendingChallenge && isArenaPayload(pendingChallenge.payload) ? <ArenaChallengeSetup /> : <ArenaSetup />) : <Setup />
  else if (screen === 'h2h') body = <H2HScreen />
  else if (screen === 'room') body = <RoomScreen />
  else if (screen === 'explore') body = <Explore />
  else if (screen === 'profile') body = <ProfileScreen />
  else if (screen === 'howto') body = <HowTo />
  else if (screen === 'world') body = <WorldBoard />
  else if (screen === 'privacy') body = <Privacy />
  else if (screen === 'account') body = <AccountScreen />
  else body = <Home />

  return (
    <div className={`app ${shell ? 'shell' : ''} ${barHidden ? 'bar-hidden' : ''}`}>
      <header className="topbar" ref={setTopbar} inert={barHidden} aria-hidden={barHidden || undefined}>
        <div className="brand" onClick={() => nav('home')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav('home')}>
          <Lockup height={40} animate="hover" />
        </div>
        <nav>
          <button className={screen === 'home' ? 'active' : ''} onClick={() => nav('home')}>
            <House size={16} />
            <span className="nav-label">Home</span>
          </button>
          {game && (
            <button className={screen === 'game' ? 'active' : ''} onClick={() => nav('game')}>
              {game.phase === 'draft' ? <Dices size={16} /> : game.phase === 'summary' ? <Trophy size={16} /> : <ClipboardList size={16} />}
              <span className="nav-label">{game.phase === 'draft' ? 'Draft' : game.phase === 'kickoff' || game.phase === 'january' ? 'Season' : game.phase === 'summary' ? 'Summary' : game.arena ? 'Arena' : 'Dugout'}</span>
            </button>
          )}
          <button className={screen === 'h2h' || screen === 'room' ? 'active' : ''} onClick={() => nav('h2h')}>
            <Swords size={16} />
            <span className="nav-label">Head-to-head</span>
          </button>
          <button className={screen === 'explore' ? 'active' : ''} onClick={() => nav('explore')}>
            <Search size={16} />
            <span className="nav-label"><span className="nav-long">Explore database</span><span className="nav-short">Database</span></span>
          </button>
          {onlineAvailable() && (
            <button className={screen === 'world' ? 'active' : ''} onClick={() => nav('world')} data-testid="nav-world">
              <Globe size={16} />
              <span className="nav-label">World</span>
            </button>
          )}
          <button className={screen === 'profile' ? 'active' : ''} onClick={() => nav('profile')}>
            <Trophy size={16} />
            <span className="nav-label">Profile</span>
          </button>
          <button className={screen === 'howto' ? 'active' : ''} onClick={() => nav('howto')}>
            <BookOpen size={16} />
            <span className="nav-label">How it works</span>
          </button>
        </nav>
        {onlineAvailable() && <AccountChip active={screen === 'account'} onOpen={() => nav('account')} />}
        <button
          type="button"
          className="theme-switch"
          onClick={flipTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          data-testid="theme-switch"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button type="button" className="theme-switch topbar-toggle" onClick={flipBar} aria-label="Hide top bar" aria-keyshortcuts={'\\'} title={'Hide top bar (\\)'} data-testid="topbar-toggle" ref={toggleRef}>
          <ChevronUp size={18} />
        </button>
      </header>
      {barHidden && (
        <button type="button" className="topbar-restore" onClick={flipBar} aria-label="Show top bar" aria-keyshortcuts={'\\'} title={'Show top bar (\\)'} data-testid="topbar-restore" ref={restoreRef}>
          <ChevronDown size={16} aria-hidden="true" />
          <span>Show top bar</span>
        </button>
      )}
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
      <Modal open={!!digest} onClose={dismissDigest} title={digest ? digestTitle(digest) : undefined}>
        {digest && <DigestBody digest={digest} onClose={dismissDigest} />}
      </Modal>
    </div>
  )
}

const CONFIDENCE_COLOUR = (c: number) => (c > 60 ? 'var(--good)' : c > 30 ? 'var(--meter-mid)' : 'var(--danger)')

/** "While you were away": results, the table move, the board, and what the assistant did in your name. */
function DigestBody({ digest: d, onClose }: { digest: SimDigest; onClose: () => void }) {
  const u = useStore((s) => s.universe)
  // Read live, as the Inbox tab's badge is: a run simulated with the Inbox open has already been marked read
  const unread = useStore((s) => (s.game ? unseenNews(s.game) : 0))
  const league = d.results.filter((r) => r.comp === 'league')
  const tally = { W: 0, D: 0, L: 0 }
  for (const r of league) tally[r.outcome]++
  // From pre-season nobody has played, so the table's order before the run means nothing: only where you stand now
  const move = d.positionTo < d.positionFrom ? 'up' : d.positionTo > d.positionFrom ? 'down' : 'level'
  const quiet = !d.decisions.length && !d.injuries.length && !d.suspensions.length && !d.transfers.length && !d.development.length
  return (
    <div className="col digest" data-testid="digest">
      <div className="digest-results" data-testid="digest-results">
        {d.results.map((r, i) => (
          <span
            key={i}
            className={`chip ${outcomeClass(r.outcome)} ${r.comp !== 'league' ? 'cup' : ''}`}
            title={`${r.comp === 'league' ? `Matchweek ${r.matchweek}` : `${r.roundLabel ?? 'Cup tie'} after matchweek ${r.matchweek}`}: ${r.home ? 'v' : 'at'} ${clubName(u, r.opponentId)} ${r.gf}-${r.ga}${r.penalties ? ` (${r.penalties.gf}-${r.penalties.ga} on penalties)` : ''}`}
          >
            <ClubBadge clubId={r.opponentId} size={18} />
            <b>
              {r.gf}-{r.ga}
            </b>
            <span className="small muted">{r.home ? 'H' : 'A'}</span>
            {r.comp !== 'league' && <span className="small muted">{r.comp === 'cup' ? 'Cup' : 'Eur'}</span>}
          </span>
        ))}
      </div>
      <div data-testid="digest-table">
        <b>
          {league.length ? <><span className="res-w">{tally.W}W</span> <span className="res-d">{tally.D}D</span> <span className="res-l">{tally.L}L</span> · </> : ''}
          {d.fromMatchweek === 0 ? `${ordinal(d.positionTo)} in the table` : move === 'level' ? `Still ${ordinal(d.positionTo)}` : `${ordinal(d.positionFrom)} to ${ordinal(d.positionTo)}`}, {d.points} point{d.points === 1 ? '' : 's'}
        </b>
        <span className="muted"> from {league.length} league match{league.length === 1 ? '' : 'es'}</span>
      </div>
      <div className="digest-conf" data-testid="digest-confidence">
        <span className="small muted">Board confidence</span>
        <div className="row" style={{ gap: 8 }}>
          <span className="small" style={{ minWidth: 22, textAlign: 'right' }}>
            {Math.round(d.confidenceFrom)}
          </span>
          <Bar value={d.confidenceFrom} colour={CONFIDENCE_COLOUR(d.confidenceFrom)} />
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="small" style={{ minWidth: 22, textAlign: 'right' }}>
            {Math.round(d.confidenceTo)}
          </span>
          <Bar value={d.confidenceTo} colour={CONFIDENCE_COLOUR(d.confidenceTo)} thick />
        </div>
      </div>
      {d.decisions.length > 0 && (
        <DigestGroup title="Decided for you" icon={<MessageSquare size={14} />} count={d.decisions.length}>
          {d.decisions.slice(0, DIGEST_GROUP_CAP).map((x, i) => (
            <li key={i}>
              <b>{x.title}</b>: {x.choice}
              {x.outcome && <span className="muted"> · {x.outcome}</span>}
            </li>
          ))}
        </DigestGroup>
      )}
      <NewsGroup title="Injuries" icon={<Bandage size={14} />} items={d.injuries} />
      <NewsGroup title="Suspensions" icon={<RectangleVertical size={14} className="ic-red-card" />} items={d.suspensions} />
      <NewsGroup title="Transfers" icon={<Banknote size={14} />} items={d.transfers} />
      <NewsGroup title="Development" icon={<TrendingUp size={14} />} items={d.development} />
      {quiet && <p className="muted small">Nothing else to report: no injuries, bans, transfers or decisions taken in your name.</p>}
      {d.truncated && <p className="muted small">The inbox keeps the latest 120 items, so the earliest of these weeks have already dropped off it.</p>}
      <div className="row between wrap">
        <span className="small muted" data-testid="digest-unread">
          {unread ? `${unread} unread in the Inbox` : 'Nothing unread in the Inbox'}
        </span>
        <button className="btn primary" onClick={onClose} data-testid="digest-close">
          To the dugout
        </button>
      </div>
    </div>
  )
}

function DigestGroup({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div className="digest-group">
      <div className="small muted digest-group-title">
        {icon} {title}
      </div>
      <ul>{children}</ul>
      {count > DIGEST_GROUP_CAP && <div className="small muted">and {count - DIGEST_GROUP_CAP} more in the Inbox</div>}
    </div>
  )
}

function NewsGroup({ title, icon, items }: { title: string; icon: React.ReactNode; items: NewsItem[] }) {
  if (!items.length) return null
  return (
    <DigestGroup title={title} icon={icon} count={items.length}>
      {items.slice(0, DIGEST_GROUP_CAP).map((n, i) => {
        // A development report lists a dozen players: up and down as two short lists, five names each
        const dev = n.kind === 'training' ? developmentLists(n.body) : null
        if (!dev) {
          return (
            <li key={i}>
              <b>{n.title}</b> <span className="muted">{n.body}</span>
            </li>
          )
        }
        return (
          <li key={i} className="dev-report">
            <b>{n.title}</b>
            {(
              [
                ['Improving', dev.improving, 'res-w'],
                ['Fading', dev.fading, 'res-l'],
              ] as const
            ).map(([label, list, cls]) =>
              list.length ? (
                <div key={label} className="dev-line small">
                  <span className={cls}>{label}</span> <span className="muted">{list.slice(0, 5).join(' · ')}{list.length > 5 ? ` · +${list.length - 5} more` : ''}</span>
                </div>
              ) : null,
            )}
          </li>
        )
      })}
    </DigestGroup>
  )
}
