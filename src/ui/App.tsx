import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '@game/store'
import { loadRules, rules } from '@game/rulesHook'
import { useStorePick } from './useStorePick'
import { Home } from './screens/Home'
import { lazyScreen, prefetchScreens, ScreenBoundary } from './lazyScreens'
import { Bar, ClubBadge, Modal, Toast, useViewerFlag } from './components/bits'
import { SaveBanner } from './components/SaveBanner'
import { SaveIssue } from './components/SaveIssue'
import { ConfirmHost } from './components/ConfirmDialog'
import { usePersistAfterFirstResult } from './persistStorage'
import { DIGEST_GROUP_CAP, digestTitle, type SimDigest } from '@game/logic/digest'
import { unseenNews } from '@game/logic/news'
import type { NewsItem } from '@engine/season'
import { clubName, outcomeClass, seasonLabel, signedValue } from './format'
import { developmentLists } from './screenText'
import { Lockup, Logo } from './components/Logo'
import { rememberThemePreference, toggledTheme, useResolvedTheme } from './theme'
import { withViewTransition } from './motion'
import { useArenaWarmup } from './useArenaWarmup'
import './sound/boot'
import { watchScrollFocus } from './scrollFocus'
import { watchFocusRescue } from './focusRescue'
import { skipToMain, watchMainLandmark } from './landmarks'
import { Bandage, Banknote, BookOpen, Briefcase, ChevronDown, ChevronUp, ClipboardCheck, ClipboardList, Dices, Globe, House, MessageSquare, Moon, RectangleVertical, Search, Sun, Swords, TrendingUp, Trophy } from 'lucide-react'

/** Per viewer: the top bar folded away for the full height (the toggle beside the theme switch, or the \ key). */
export const TOPBAR_HIDDEN_KEY = 'touchline-topbar-hidden'
import { readGameHash } from './gameHash'
import { onlineAvailable, openRoom, resolveShort } from '../online/api'
import { newsBody } from '@game/logic/newsFlavour'
import { translator } from './i18n'
import { app } from './i18n/en/app'
import { shell } from './i18n/en/shell'
import { useLanguage } from './i18n/language'
import { B, rich } from './i18n/rich'
// The summer's player stories ride in their own chunk, with the history catalogue (the first download stays as it was)
const SummerStories = lazy(() => import('./components/SummerStories').then((m) => ({ default: m.SummerStories })))

const t = translator(app)
const tShell = translator(shell)

/**
 * A screen that plays a game loads the rules chunk (`src/game/rulesHook.ts`) and the game screens' styles
 * (`gameScreens.css`) with its own: the store's actions it calls find the rules in place and its boxes their styles,
 * and Home's first download leaves both out.
 */
const withRules =
  <T,>(load: () => Promise<T>) =>
  (): Promise<T> =>
    Promise.all([load(), loadRules(), import('./gameStyles')]).then(([m]) => m)

// Every screen but Home is its own chunk (lazyScreens.tsx), listed in the order a player meets them: the idle prefetch
// after Home fetches them in this order, the Quick Draft path first
const SCREENS = {
  setup: lazyScreen(withRules(() => import('./screens/Setup')), 'Setup'),
  draft: lazyScreen(withRules(() => import('./screens/Draft')), 'Draft'),
  kickOff: lazyScreen(withRules(() => import('./screens/KickOff')), 'KickOff'),
  playback: lazyScreen(withRules(() => import('./screens/SeasonPlayback')), 'SeasonPlayback'),
  summary: lazyScreen(withRules(() => import('./screens/Summary')), 'Summary'),
  dugout: lazyScreen(withRules(() => import('./screens/Dugout')), 'Dugout'),
  match: lazyScreen(withRules(() => import('./screens/MatchScreen')), 'MatchScreen'),
  explore: lazyScreen(withRules(() => import('./screens/Explore')), 'Explore'),
  profile: lazyScreen(withRules(() => import('./screens/ProfileScreen')), 'ProfileScreen'),
  h2h: lazyScreen(withRules(() => import('./screens/H2H')), 'H2HScreen'),
  howTo: lazyScreen(() => import('./screens/HowTo'), 'HowTo'),
  arenaSetup: lazyScreen(withRules(() => import('./screens/ArenaSetup')), 'ArenaSetup'),
  arena: lazyScreen(withRules(() => import('./screens/Arena')), 'Arena'),
  arenaSummary: lazyScreen(withRules(() => import('./screens/ArenaSummary')), 'ArenaSummary'),
  arenaChallengeSetup: lazyScreen(withRules(() => import('./screens/ArenaChallengeSetup')), 'ArenaChallengeSetup'),
  runInSetup: lazyScreen(withRules(() => import('./screens/RunInSetup')), 'RunInSetup'),
  runInSummary: lazyScreen(withRules(() => import('./screens/RunInSummary')), 'RunInSummary'),
  privacy: lazyScreen(() => import('./screens/Privacy'), 'Privacy'),
  world: lazyScreen(withRules(() => import('./online/WorldBoard')), 'WorldBoard'),
  account: lazyScreen(withRules(() => import('./online/AccountPanel')), 'AccountScreen'),
  room: lazyScreen(withRules(() => import('./online/Rooms')), 'RoomScreen'),
}
const { setup: { Screen: Setup }, draft: { Screen: Draft }, kickOff: { Screen: KickOff }, playback: { Screen: SeasonPlayback }, summary: { Screen: Summary }, dugout: { Screen: Dugout }, match: { Screen: MatchScreen }, explore: { Screen: Explore }, profile: { Screen: ProfileScreen }, h2h: { Screen: H2HScreen }, howTo: { Screen: HowTo }, arenaSetup: { Screen: ArenaSetup }, arena: { Screen: Arena }, arenaSummary: { Screen: ArenaSummary }, arenaChallengeSetup: { Screen: ArenaChallengeSetup }, runInSetup: { Screen: RunInSetup }, runInSummary: { Screen: RunInSummary }, privacy: { Screen: Privacy }, world: { Screen: WorldBoard }, account: { Screen: AccountScreen }, room: { Screen: RoomScreen } } = SCREENS

// The account chip (and the account panel it opens from) only exists in an online build: never in the first download
const AccountChip = lazy(() => import('./online/AccountChip').then((m) => ({ default: m.AccountChip })))

export function App() {
  const { universe, loading, loadError, loadData, screen, go, game, h2h, profile, setTheme, offseason, dismissOffseason, digest, dismissDigest, abandonGame, openChallenge, playback, setupMode, pendingChallenge } = useStorePick('universe', 'loading', 'loadError', 'loadData', 'screen', 'go', 'game', 'h2h', 'profile', 'setTheme', 'offseason', 'dismissOffseason', 'digest', 'dismissDigest', 'abandonGame', 'openChallenge', 'playback', 'setupMode', 'pendingChallenge')
  // An arena run's field strengths, worked out in idle moments while it drafts
  useArenaWarmup()
  // After the first finished game, ask the browser to keep the save through storage pressure (persistStorage.ts)
  usePersistAfterFirstResult(profile)
  const hashHandled = useRef(false)
  // A language change remounts the screen below (its key), so every string on it is read again
  const { locale } = useLanguage()
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

  // Once the database is in and Home is up, fetch the other screens in idle moments (online ones only when online)
  const dataReady = !!universe
  useEffect(() => {
    if (!dataReady) return
    const online = onlineAvailable()
    return prefetchScreens(Object.entries(SCREENS).filter(([k]) => online || (k !== 'world' && k !== 'account' && k !== 'room')).map(([, s]) => s))
  }, [dataReady])
  // A box that scrolls with nothing focusable inside joins the Tab order while it scrolls (keyboard and Safari reach)
  useEffect(() => watchScrollFocus(), [])
  // A focus whose control leaves the page goes back to the nearest box, or to the new screen's page
  useEffect(() => watchFocusRescue(), [])

  // A challenge link (`#c=...` long, `#s=K7Q2MX9A` short) opens once the default league is in: the hash is cleared so
  // a reload does not reopen it. A short code is resolved online, then opened exactly like a long link.
  useEffect(() => {
    if (!universe) return
    const open = () => {
      const { link: h, damaged } = readGameHash(location.hash)
      if (damaged) {
        history.replaceState(null, '', location.pathname + location.search)
        useStore.getState().showToast(tShell('damagedLink'))
        return
      }
      if (!h) return
      // A head-to-head room link (`#h=K7Q2MX9A`) opens the room screen, which keeps the hash while it is open
      if (h.kind === 'h') {
        if (onlineAvailable()) {
          useStore.getState().go('room')
          void openRoom(h.code)
        } else {
          history.replaceState(null, '', location.pathname + location.search)
          useStore.getState().showToast(t('roomsOffline'))
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
  // An arena shoot-out is its own screen inside the match phase: once taken, the report opens at its top, where the kicks reveal
  const shootout = !!game?.arena?.pending
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [screen, phase, h2hStage, shootout])

  if (loadError) {
    return (
      <div className="page">
        <div className="panel">
          <h2>{t('loadFailed')}</h2>
          <p className="muted">{loadError}</p>
          <div className="row wrap">
            <button className="btn primary" onClick={() => loadData()}>
              {t('retry')}
            </button>
            {game && (
              <button className="btn" onClick={() => { abandonGame(); void loadData() }}>
                {t('discardAndRetry')}
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
              {t('loading')}
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
  // The quick season's playback after kick-off runs in the summary phase: the nav still calls it the season until it closes
  const seasonPlaying = !!game && game.phase === 'summary' && !!(playback || game.quickOpen) && !!game.quickResult?.results?.length
  // The game's own nav entry, named for where the game is
  const gameNav = !game ? '' : t(game.phase === 'draft' ? 'navDraft' : game.phase === 'kickoff' || game.phase === 'january' || seasonPlaying ? 'navSeason' : game.phase === 'summary' ? 'navSummary' : game.arena ? 'navArena' : 'navDugout')
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
    else if (game.phase === 'january' || seasonPlaying) body = <SeasonPlayback key={game.phase} />
    else if (game.phase === 'match') body = <MatchScreen />
    else if (game.phase === 'summary') body = game.arena ? <ArenaSummary /> : game.settings.mode === 'runin' ? <RunInSummary /> : <Summary />
    else body = game.arena ? <Arena /> : <Dugout />
  } else if (screen === 'setup') body = setupMode === 'runin' ? <RunInSetup /> : setupMode === 'arena' ? (pendingChallenge && rules().isArenaPayload(pendingChallenge.payload) ? <ArenaChallengeSetup /> : <ArenaSetup />) : <Setup />
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
    <div className={`app ${shell ? 'shell' : ''} ${barHidden ? 'bar-hidden' : ''} ${screen === 'game' && game?.phase === 'match' && !shell ? 'dock-off' : ''}`} ref={watchMainLandmark}>
      <a className="skip-link" href="#main" onClick={skipToMain} data-testid="skip-link">
        {t('skipToContent')}
      </a>
      <header className="topbar" ref={setTopbar} inert={barHidden} aria-hidden={barHidden || undefined}>
        <div className="brand" onClick={() => nav('home')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav('home')}>
          <Lockup height={40} animate="hover" />
        </div>
        <SaveBanner />
        <nav>
          <button className={screen === 'home' ? 'active' : ''} aria-current={screen === 'home' ? 'page' : undefined} onClick={() => nav('home')}>
            <House size={16} />
            <span className="nav-label">{t('navHome')}</span>
            <span className="nav-tiny" aria-hidden="true">{t('navHome')}</span>
          </button>
          {game && (
            <button className={screen === 'game' ? 'active' : ''} aria-current={screen === 'game' ? 'page' : undefined} onClick={() => nav('game')}>
              {game.phase === 'draft' ? <Dices size={16} /> : game.phase === 'summary' && !seasonPlaying ? <ClipboardCheck size={16} /> : <ClipboardList size={16} />}
              <span className="nav-label">{gameNav}</span>
              <span className="nav-tiny" aria-hidden="true">{gameNav}</span>
            </button>
          )}
          <button className={screen === 'h2h' || screen === 'room' ? 'active' : ''} aria-current={screen === 'h2h' || screen === 'room' ? 'page' : undefined} onClick={() => nav('h2h')}>
            <Swords size={16} />
            <span className="nav-tiny">{t('navTinyH2H')}</span>
            <span className="nav-label">{t('navH2H')}</span>
          </button>
          <button className={screen === 'explore' ? 'active' : ''} aria-current={screen === 'explore' ? 'page' : undefined} onClick={() => nav('explore')}>
            <Search size={16} />
            <span className="nav-tiny">{t('navTinyExplore')}</span>
            <span className="nav-label"><span className="nav-long">{t('navExplore')}</span><span className="nav-short">{t('navExploreShort')}</span></span>
          </button>
          {onlineAvailable() && (
            <button className={screen === 'world' ? 'active' : ''} aria-current={screen === 'world' ? 'page' : undefined} onClick={() => nav('world')} data-testid="nav-world">
              <Globe size={16} />
              <span className="nav-label">{t('navWorld')}</span>
              <span className="nav-tiny" aria-hidden="true">{t('navWorld')}</span>
            </button>
          )}
          <button className={screen === 'profile' ? 'active' : ''} aria-current={screen === 'profile' ? 'page' : undefined} onClick={() => nav('profile')}>
            <Trophy size={16} />
            <span className="nav-label">{t('navProfile')}</span>
            <span className="nav-tiny" aria-hidden="true">{t('navProfile')}</span>
          </button>
          <button className={screen === 'howto' ? 'active' : ''} aria-current={screen === 'howto' ? 'page' : undefined} onClick={() => nav('howto')}>
            <BookOpen size={16} />
            <span className="nav-tiny">{t('navTinyGuide')}</span>
            <span className="nav-label">{t('navHowTo')}</span>
          </button>
        </nav>
        {onlineAvailable() && (
          <Suspense fallback={null}>
            <AccountChip active={screen === 'account'} onOpen={() => nav('account')} />
          </Suspense>
        )}
        <button
          type="button"
          className="theme-switch"
          onClick={flipTheme}
          aria-label={t(theme === 'dark' ? 'toLight' : 'toDark')}
          title={t(theme === 'dark' ? 'lightMode' : 'darkMode')}
          data-testid="theme-switch"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button type="button" className="theme-switch topbar-toggle" onClick={flipBar} aria-label={t('hideBar')} aria-keyshortcuts={'\\'} title={t('hideBarKey')} data-testid="topbar-toggle" ref={toggleRef}>
          <ChevronUp size={18} />
        </button>
      </header>
      {barHidden && (
        <button type="button" className="topbar-restore" onClick={flipBar} aria-label={t('showBar')} aria-keyshortcuts={'\\'} title={t('showBarKey')} data-testid="topbar-restore" ref={restoreRef}>
          <ChevronDown size={16} aria-hidden="true" />
          <span>{t('showBar')}</span>
        </button>
      )}
      <ScreenBoundary resetKey={`${screen}|${game?.phase ?? ''}|${h2hStage}`} key={locale} onHome={() => go('home')} atHome={screen === 'home'}>
        {body}
      </ScreenBoundary>
      <Toast />
      {barHidden && <SaveBanner floating />}
      <SaveIssue />
      <ConfirmHost />
      <Modal open={!!offseason} onClose={dismissOffseason} title={t('summerTitle')}>
        {offseason && (
          <div className="col summer-review">
            {offseason.retired.length > 0 && (
              <p>{rich(t('summerRetired', { names: offseason.retired.join(', ') }), B)}</p>
            )}
            {offseason.expired.length > 0 && (
              <p>{rich(t('summerExpired', { names: offseason.expired.join(', ') }), B)}</p>
            )}
            {(offseason.renewals ?? []).length > 0 && (
              <p data-testid="offseason-renewals">{rich(t('summerRenewals', { names: (offseason.renewals ?? []).join(', ') }), B)}</p>
            )}
            {offseason.returned.length > 0 && (
              <p>{rich(t('summerReturned', { names: offseason.returned.join(', ') }), B)}</p>
            )}
            {offseason.stories && (
              <Suspense fallback={null}>
                <SummerStories stories={offseason.stories} />
              </Suspense>
            )}
            {offseason.improved.length > 0 && (
              <div className="summer-moves" data-testid="summer-improved">
                <b>{t('summerImproved')}</b>
                {offseason.improved.map((x) => (
                  <span key={x.name} className="chip good">
                    {t('summerMove', { name: x.name, from: x.from, to: x.to })}
                  </span>
                ))}
              </div>
            )}
            {offseason.declined.length > 0 && (
              <div className="summer-moves" data-testid="summer-declined">
                <b>{t('summerDeclined')}</b>
                {offseason.declined.map((x) => (
                  <span key={x.name} className="chip bad">
                    {t('summerMove', { name: x.name, from: x.from, to: x.to })}
                  </span>
                ))}
              </div>
            )}
            {game && (game.history.at(-1)?.leagueSeason ?? 0) > game.settings.leagueSeason && (
              <p className="small" data-testid="season-wrap">
                {rich(t('summerWrap', { season: seasonLabel(game.settings.leagueSeason) }), B)}
              </p>
            )}
            <p className="muted small">{t('summerSpins', { n: game ? game.bonusSpins : 0 })}</p>
            <button className="btn primary" onClick={dismissOffseason}>
              {t('toTheDraft')}
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
  const office = d.office ?? []
  const quiet = !d.decisions.length && !d.injuries.length && !d.suspensions.length && !d.transfers.length && !d.development.length && !office.length
  return (
    <div className="col digest" data-testid="digest">
      <div className="digest-results" data-testid="digest-results">
        {d.results.map((r, i) => (
          <span
            key={i}
            className={`chip ${outcomeClass(r.outcome)} ${r.comp !== 'league' ? 'cup' : ''}`}
            style={{ ['--i' as string]: String(Math.min(i, 12)) }}
            title={t(r.comp === 'league' ? 'digestLeagueTip' : 'digestCupTip', { week: r.matchweek, round: r.roundLabel ?? t('digestCupTie'), venue: r.home ? 'home' : 'away', club: clubName(u, r.opponentId), score: `${r.gf}-${r.ga}`, agg: r.aggregate ? t('digestAggTip', { score: `${r.aggregate.gf}-${r.aggregate.ga}` }) : '', pens: r.penalties ? t('digestPensTip', { score: `${r.penalties.gf}-${r.penalties.ga}` }) : '' })}
          >
            <ClubBadge clubId={r.opponentId} size={18} />
            <b>
              {r.gf}-{r.ga}
            </b>
            {r.penalties && <span className="small muted">{t('digestPens', { score: `${r.penalties.gf}-${r.penalties.ga}` })}</span>}
            <span className="res-letter">{r.outcome}</span>
            <span className="small muted">{t(r.home ? 'digestHome' : 'digestAway')}</span>
            {r.comp !== 'league' && <span className="small muted">{t(r.comp === 'cup' ? 'digestCup' : 'digestEurope')}</span>}
          </span>
        ))}
      </div>
      <div data-testid="digest-table">
        <b>
          {league.length ? <><span className="res-w">{t('tallyW', { n: tally.W })}</span> <span className="res-d">{t('tallyD', { n: tally.D })}</span> <span className="res-l">{t('tallyL', { n: tally.L })}</span> · </> : ''}
          {t('digestPoints', { n: d.points, place: d.fromMatchweek === 0 ? t('digestPlaced', { pos: d.positionTo }) : move === 'level' ? t('digestStill', { pos: d.positionTo }) : t('digestMoved', { from: d.positionFrom, to: d.positionTo }) })}
        </b>
        <span className="muted">{t('digestFrom', { n: league.length })}</span>
      </div>
      <div className="digest-conf" data-testid="digest-confidence">
        <div className="row between">
          <span className="small muted">{t('boardConfidence')}</span>
          <span className="small digest-conf-move">
            {t('confidenceMove', { from: Math.round(d.confidenceFrom), to: Math.round(d.confidenceTo) })}
            {Math.round(d.confidenceTo) !== Math.round(d.confidenceFrom) && (
              <b className={d.confidenceTo > d.confidenceFrom ? 'res-w' : 'res-l'}> {t('confidenceDelta', { n: signedValue(Math.round(d.confidenceTo) - Math.round(d.confidenceFrom)) })}</b>
            )}
          </span>
        </div>
        <Bar value={d.confidenceTo} colour={CONFIDENCE_COLOUR(d.confidenceTo)} thick />
      </div>
      {d.decisions.length > 0 && (
        <DigestGroup title={t('decidedForYou')} icon={<MessageSquare size={14} />} count={d.decisions.length}>
          {d.decisions.slice(0, DIGEST_GROUP_CAP).map((x, i) => (
            <li key={i}>
              <b>{x.title}</b>{x.count ? t('decidedTimes', { n: x.count }) : ''}: {x.choice}
              {x.outcome && <span className="muted"> · {x.outcome}</span>}
            </li>
          ))}
        </DigestGroup>
      )}
      <NewsGroup title={t('digestOffice')} icon={<Briefcase size={14} />} items={office} testId="digest-office" />
      <NewsGroup title={t('injuries')} icon={<Bandage size={14} />} items={d.injuries} />
      <NewsGroup title={t('suspensions')} icon={<RectangleVertical size={14} className="ic-red-card" />} items={d.suspensions} />
      <NewsGroup title={t('transfers')} icon={<Banknote size={14} />} items={d.transfers} />
      <NewsGroup title={t('development')} icon={<TrendingUp size={14} />} items={d.development} />
      {quiet && <p className="muted small">{t('digestQuiet')}</p>}
      {d.truncated && <p className="muted small">{t('digestTruncated')}</p>}
      <div className="row between wrap">
        <span className="small muted" data-testid="digest-unread">
          {t('unread', { n: unread })}
        </span>
        <button className="btn primary" onClick={onClose} data-testid="digest-close">
          {t('toTheDugout')}
        </button>
      </div>
    </div>
  )
}

function DigestGroup({ title, icon, count, children, testId }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode; testId?: string }) {
  return (
    <div className="digest-group" data-testid={testId}>
      <div className="small muted digest-group-title">
        {icon} {title}
      </div>
      <ul>{children}</ul>
      {count > DIGEST_GROUP_CAP && <div className="small muted">{t('andMore', { n: count - DIGEST_GROUP_CAP })}</div>}
    </div>
  )
}

function NewsGroup({ title, icon, items, testId }: { title: string; icon: React.ReactNode; items: NewsItem[]; testId?: string }) {
  if (!items.length) return null
  return (
    <DigestGroup title={title} icon={icon} count={items.length} testId={testId}>
      {items.slice(0, DIGEST_GROUP_CAP).map((n, i) => {
        // A development report lists a dozen players: up and down as two short lists, five names each
        const dev = n.kind === 'training' ? developmentLists(n.body) : null
        if (!dev) {
          return (
            <li key={i}>
              <b>{n.title}</b> <span className="muted">{newsBody(n)}</span>
            </li>
          )
        }
        return (
          <li key={i} className="dev-report">
            <b>{n.title}</b>
            {(
              [
                [t('improving'), dev.improving, 'res-w'],
                [t('fading'), dev.fading, 'res-l'],
              ] as const
            ).map(([label, list, cls]) =>
              list.length ? (
                <div key={label} className="dev-line small">
                  <span className={cls}>{label}</span> <span className="muted">{list.slice(0, 5).join(' · ')}{list.length > 5 ? t('plusMore', { n: list.length - 5 }) : ''}</span>
                </div>
              ) : null,
            )}
          </li>
        )
      })}
    </DigestGroup>
  )
}
