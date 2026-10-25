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
import { Bar, ClubBadge, Modal, Toast } from './components/bits'
import { DIGEST_GROUP_CAP, digestTitle, type SimDigest } from '@game/logic/digest'
import { unseenNews } from '@game/logic/news'
import type { NewsItem } from '@engine/season'
import { clubName, ordinal } from './format'
import { Lockup, Logo } from './components/Logo'
import { toggledTheme, useResolvedTheme } from './theme'
import { Bandage, Banknote, BookOpen, ClipboardList, Dices, House, MessageSquare, Moon, RectangleVertical, Search, Sun, Swords, TrendingUp, Trophy } from 'lucide-react'

export function App() {
  const { universe, loading, loadError, loadData, screen, go, game, profile, setTheme, offseason, dismissOffseason, digest, dismissDigest, abandonGame, openChallenge } = useStore()
  const hashHandled = useRef(false)
  const theme = useResolvedTheme(profile.theme)

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

  // Auto follows the device live (useResolvedTheme listens to prefers-color-scheme); the browser bar takes the page colour
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  }, [theme])

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
            <Logo size="lg" />
            <div className="muted small">Loading the player database…</div>
          </div>
        </div>
      </div>
    )
  }

  let body: React.ReactNode
  if (screen === 'game' && game) {
    if (game.phase === 'draft') body = <Draft />
    else if (game.phase === 'match') body = <MatchScreen />
    else if (game.phase === 'summary') body = <Summary />
    else body = <Dugout />
  } else if (screen === 'setup') body = <Setup />
  else if (screen === 'h2h') body = <H2HScreen />
  else if (screen === 'explore') body = <Explore />
  else if (screen === 'profile') body = <ProfileScreen />
  else if (screen === 'howto') body = <HowTo />
  else body = <Home />

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('home')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('home')}>
          <Lockup height={40} animate="hover" />
        </div>
        <nav>
          <button className={screen === 'home' ? 'active' : ''} onClick={() => go('home')}>
            <House size={16} />
            Home
          </button>
          {game && (
            <button className={screen === 'game' ? 'active' : ''} onClick={() => go('game')}>
              {game.phase === 'draft' ? <Dices size={16} /> : game.phase === 'summary' ? <Trophy size={16} /> : <ClipboardList size={16} />}
              {game.phase === 'draft' ? 'Draft' : game.phase === 'summary' ? 'Summary' : 'Dugout'}
            </button>
          )}
          <button className={screen === 'h2h' ? 'active' : ''} onClick={() => go('h2h')}>
            <Swords size={16} />
            Head-to-head
          </button>
          <button className={screen === 'explore' ? 'active' : ''} onClick={() => go('explore')}>
            <Search size={16} />
            Explore
          </button>
          <button className={screen === 'profile' ? 'active' : ''} onClick={() => go('profile')}>
            <Trophy size={16} />
            Profile
          </button>
          <button className={screen === 'howto' ? 'active' : ''} onClick={() => go('howto')}>
            <BookOpen size={16} />
            How it works
          </button>
        </nav>
        <button
          type="button"
          className="theme-switch"
          onClick={() => setTheme(toggledTheme(theme))}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          data-testid="theme-switch"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
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
            className={`chip ${r.outcome === 'W' ? 'good' : r.outcome === 'L' ? 'bad' : ''} ${r.comp !== 'league' ? 'cup' : ''}`}
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
          {league.length ? `${tally.W}W ${tally.D}D ${tally.L}L · ` : ''}
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
      {items.slice(0, DIGEST_GROUP_CAP).map((n, i) => (
        <li key={i}>
          <b>{n.title}</b> <span className="muted">{n.body}</span>
        </li>
      ))}
    </DigestGroup>
  )
}
