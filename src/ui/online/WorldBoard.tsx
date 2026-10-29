import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import { useStore, slotOf, todaysDailySeed } from '@game/store'
import { useStorePick } from '../useStorePick'
import { TIER_LABEL } from '@engine/season'
import type { SeasonTier } from '@engine/types'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import type { AlltimeMine, AlltimeOrder, AlltimeRow, BoardRow, BoardSummary, CasualKind, CasualRow, CasualSummary, ChaseRow, ChaseScope, ChaseStatus, ChaseSummary, RankedKind } from '../../online/boards'
import { PAGE } from '../../online/boards'
import { weekKeyOf, weekStartOf, weeklyIsOpen } from '../../online/weekly'
import { dailyStartSettings, weeklyStartSettings } from '../../online/daily'
import { PIN_NOTE, pinStanding, type PinStanding } from '../../online/engineRoute'
import { CHASE_ATTEMPT_HOURS, CHASE_ATTEMPTS_PER_DAY, CHASE_DEFAULT_OPTIONS, CHASE_FORMATIONS, isChaseGame } from '../../online/chase'
import { perfectTarget, recordLabel } from '@game/logic/perfect'
import { dailyArenaGameSettings, dailyArenaSettings } from '@game/logic/arenaDaily'
import { weeklyPlan } from '@game/logic/weekly'
import { weeklyThemeText } from '../i18n/weeklyThemeText'
import { arenaDailySeed, weeklySeed } from '@engine/rng'
import { levelRows, podiumOf, signedGd } from '../boardRows'
import { isWeeklyRunIn, runInWeekSeed, weeklyRunInJob, weeklyRunInPlan } from '@game/logic/runinWeekly'
import { Info, Segmented } from '../components/bits'
import { formationName, seasonLabel } from '../format'
import { CountryFlag, CountrySelect } from './AccountPanel'
import { countryName } from './countries'
import { onlineErrorText } from '../../online/postText'
import { askConfirm } from '../confirm'
import { onTabListKey } from '../a11y'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'
import { B, rich } from '../i18n/rich'
import { templateText } from '../runInText'

const tr = translator(online)

type Tab = 'daily' | 'weekly' | 'alltime' | 'chase' | CasualKind
const TABS: readonly Tab[] = ['daily', 'weekly', 'alltime', 'chase', 'arena', 'themed', 'runin']

/** The World screen's last board, per viewer (a convenience only: a blocked storage opens Today's Daily). */
const TAB_KEY = 'touchline-world-tab'
export function rememberWorldTab(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // remembered for this visit only
  }
}
function rememberedTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return (TABS as readonly string[]).includes(v ?? '') ? (v as Tab) : 'daily'
  } catch {
    return 'daily'
  }
}

const DAY = 86400000

/** The browser says it has no connection (a board then waits for one instead of trying). */
const offlineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false
const tierText = (t: string) => TIER_LABEL[t as SeasonTier] ?? t

function Flag({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <span className="board-flag" title={countryName(code)}>
      <CountryFlag code={code} size={18} />
    </span>
  )
}

/**
 * One board's rows and summary, a page at a time. It loads again on a new key, a sign-in or out, Try again, and by
 * itself when the connection comes back after a failed load.
 */
function useBoard<R, S>(key: string, page: (offset: number) => Promise<R[]>, summary: () => Promise<S>) {
  const session = useOnline((s) => s.session)
  const [rows, setRows] = useState<R[] | null>(null)
  const [sum, setSum] = useState<S | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  // The readers change every render; the effect reads the latest through a ref and reloads only on what it names
  const readers = useRef({ page, summary })
  readers.current = { page, summary }
  useEffect(() => {
    let live = true
    setRows(null)
    // A new board never shows the last one's summary while it loads
    setSum(null)
    setMore(false)
    setError(null)
    setOffline(false)
    if (offlineNow()) {
      // No connection: say so at once, and load when the browser says it is back (below)
      setOffline(true)
      setError(tr('offlineBoard'))
      return
    }
    Promise.all([readers.current.page(0), readers.current.summary()]).then(
      ([r, s]) => {
        if (!live) return
        setRows(r)
        setSum(s)
        setMore(r.length === PAGE)
      },
      (e: unknown) => {
        if (!live) return
        setOffline(offlineNow())
        setError(onlineErrorText(e))
      },
    )
    return () => {
      live = false
    }
  }, [key, session, attempt])
  useEffect(() => {
    if (!error || typeof window === 'undefined') return
    const back = () => setAttempt((a) => a + 1)
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [error])
  const loadMore = async () => {
    if (!rows || busy) return
    setBusy(true)
    let next: R[]
    try {
      next = await readers.current.page(rows.length)
    } catch (e) {
      // A dropped connection keeps the rows shown and says why the next page did not come
      setOffline(offlineNow())
      setError(onlineErrorText(e))
      setBusy(false)
      return
    }
    setBusy(false)
    setError(null)
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  return { rows, summary: sum, more, error, offline, busy, loadMore, retry: () => setAttempt((a) => a + 1) }
}

/** A board's state above its table: the error with Try again, loading, or nobody yet (with what to do about it). */
export function BoardState({ rows, error, offline = false, retry, empty, hint }: { rows: unknown[] | null; error: string | null; offline?: boolean; retry: () => void; empty: string; hint?: string }) {
  return (
    <>
      {error && (
        <div className={`notice warn row between wrap board-error${offline ? ' board-offline' : ''}`} data-testid={offline ? 'board-offline' : 'board-error'} role="status">
          <span className="row">
            {offline && <WifiOff size={16} aria-hidden="true" />}
            {offline ? error : tr('boardError', { error })}
          </span>
          <button type="button" className="btn sm" onClick={retry} data-testid="board-retry">
            {tr('tryAgain')}
          </button>
        </div>
      )}
      {!rows && !error && (
        <div className="board-loading" aria-busy="true" data-testid="board-loading">
          <span className="sr-only">{tr('loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="board-skeleton" aria-hidden="true" />
          ))}
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="empty-state board-empty" data-testid="board-empty">
          <p className="muted">{empty}</p>
          {hint && <p className="small muted" data-testid="board-empty-hint">{hint}</p>}
        </div>
      )}
    </>
  )
}

/** A row's place: the podium's three in their colours, and a mark when only the time of posting split it from a neighbour. */
function RankCell({ position, level }: { position: number; level: boolean }) {
  const podium = podiumOf(position)
  return (
    <td className="num board-rank">
      <span className={`rank-pill${podium ? ` p${podium}` : ''}`}>{position}</span>
      {level && (
        <span className="rank-level" title={tr('levelTip')}>
          <span aria-hidden="true">=</span>
          <span className="sr-only">{tr('levelTip')}</span>
        </span>
      )}
    </td>
  )
}

/** The manager's flag, name and, on your own row, the You chip. */
function ManagerCell({ name, country, isMe }: { name: string; country: string | null; isMe: boolean }) {
  return (
    <td className="board-manager">
      <Flag code={country} />
      <span className="board-name">{name}</span>
      {isMe && <span className="chip info board-you">{tr('you')}</span>}
    </td>
  )
}

/** The rows' class: your own row lit, the podium marked. */
const rowClass = (r: { isMe: boolean; position: number }, extra = '') => [r.isMe ? 'me' : '', podiumOf(r.position) ? 'podium' : '', extra].filter(Boolean).join(' ')

/** Your place pinned at the board's foot while your row is not among those shown. */
function MineFoot({ children }: { children: ReactNode }) {
  return (
    <div className="fit-foot notice row between board-mine" data-testid="board-mine">
      {children}
    </div>
  )
}

/** The Show more button, busy while the next page loads. */
function MoreButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button type="button" className="btn sm ghost board-more" onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
      {tr(busy ? 'loading' : 'showMore')}
    </button>
  )
}

function RankedTable({ kind, boardKey, country, title, current }: { kind: RankedKind; boardKey: string; country: string | null; title: string; current: boolean }) {
  const openChallenge = useStore((s) => s.openChallenge)
  const b = useBoard<BoardRow, BoardSummary | null>(`${kind}|${boardKey}|${country}`, (offset) => api.board(kind, boardKey, country, offset), () => api.boardSummary(kind, boardKey, country))
  const { rows, summary } = b
  const meShown = !!rows?.some((r) => r.isMe)
  const race = !!rows?.some((r) => r.revealed && r.payload)
  const level = levelRows((rows ?? []).map((r) => `${r.points}|${r.lost}|${r.goalDiff}|${r.goalsFor}`))
  return (
    <section className="panel fit-panel" data-testid={`board-${kind}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="small muted" data-testid="board-summary">
          {summary ? `${tr('played', { n: summary.played.toLocaleString() })}${summary.top !== null ? tr('topScore', { n: summary.top }) : ''}${tr(summary.open ? 'postsOpen' : 'closed')}${summary.revealed ? tr('picksRevealed') : ''}` : ''}
        </span>
      </div>
      <div className="fit-scroll">
        <BoardState rows={rows} error={b.error} offline={b.offline} retry={b.retry} empty={tr('nobodyPosted', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })} hint={current && summary?.open !== false ? tr('beFirst') : undefined} />
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head board-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{tr('colManager')}</th>
                <th>{tr('colTeam')}</th>
                <th className="num">{tr('colPts')}</th>
                <th className="num">{tr('colWdl')}</th>
                <th className="num">{tr('colGd')}</th>
                <th>{tr('colResult')}</th>
                {race && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.position}-${r.name}`} className={rowClass(r)} aria-current={r.isMe || undefined}>
                  <RankCell position={r.position} level={level[i]} />
                  <ManagerCell name={r.name} country={r.country} isMe={r.isMe} />
                  <td className="board-team">{r.team}</td>
                  <td className="num board-score">{r.points}</td>
                  <td className="num">
                    <Wdl won={r.won} drawn={r.drawn} lost={r.lost} />
                  </td>
                  <td className="num">{signedGd(r.goalDiff)}</td>
                  <td className="small">{tr('resultLine', { tier: tierText(r.tier), pos: r.leaguePosition })}</td>
                  {race && (
                    <td className="end">
                      {r.revealed && r.payload && (
                        <button className="btn sm" onClick={() => void openChallenge(r.payload!)}>
                          {tr('raceRun')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.more && <MoreButton onClick={() => void b.loadMore()} busy={b.busy} />}
      </div>
      {!meShown && summary?.myPosition && (
        <MineFoot>
          <b>{tr('youAt', { pos: summary.myPosition })}</b>
          <span>{tr('pts', { n: summary.myPoints })}</span>
        </MineFoot>
      )}
    </section>
  )
}

function AlltimeTable({ country, order }: { country: string | null; order: AlltimeOrder }) {
  const session = useOnline((s) => s.session)
  const b = useBoard<AlltimeRow, AlltimeMine | null>(`${order}|${country}`, (offset) => api.alltime(order, country, offset), () => api.alltimeMine(order, country))
  const { rows } = b
  const mine = b.summary
  const level = levelRows((rows ?? []).map((r) => (order === 'points' ? `${r.totalPoints}|${r.bestStreak}` : `${r.bestStreak}|${r.totalPoints}`)))
  return (
    <section className="panel fit-panel" data-testid="board-alltime">
      <div className="panel-head">
        <h3>{tr('alltimeTitle')}</h3>
        <span className="small muted">{tr(order === 'points' ? 'byPoints' : 'byStreak')}</span>
      </div>
      <div className="fit-scroll">
        <BoardState rows={rows} error={b.error} offline={b.offline} retry={b.retry} empty={tr('nobodyDaily', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })} />
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head board-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{tr('colManager')}</th>
                <th className="num">{tr('colPoints')}</th>
                <th className="num">{tr('colDailies')}</th>
                <th className="num">{tr('colAvg')}</th>
                <th className="num">{tr('colBestStreak')}</th>
                <th className="num">{tr('colStreakNow')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.position}-${r.name}`} className={rowClass(r)} aria-current={r.isMe || undefined}>
                  <RankCell position={r.position} level={level[i]} />
                  <ManagerCell name={r.name} country={r.country} isMe={r.isMe} />
                  <td className={`num${order === 'points' ? ' board-score' : ''}`}>{r.totalPoints.toLocaleString()}</td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.average}</td>
                  <td className={`num${order === 'streak' ? ' board-score' : ''}`}>{r.bestStreak}</td>
                  <td className="num">{r.currentStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.more && <MoreButton onClick={() => void b.loadMore()} busy={b.busy} />}
      </div>
      {mine && !rows?.some((r) => r.isMe) && (
        <MineFoot>
          <b>{tr('youOf', { pos: mine.position, total: mine.players.toLocaleString() })}</b>
          <span>{tr('mineLine', { pts: mine.totalPoints.toLocaleString(), n: mine.played, streak: mine.bestStreak })}</span>
        </MineFoot>
      )}
      {!session && <div className="fit-foot small muted">{tr('signInAlltime')}</div>}
    </section>
  )
}

function WeeklyPlay({ weekKey }: { weekKey: string }) {
  const { universe: u, game, startGame, go, profile, loadedLeagues } = useStorePick('universe', 'game', 'startGame', 'go', 'profile', 'loadedLeagues')
  const pin = useOnline((s) => (s.pins.week === weekKey ? s.pins.weekly : null))
  if (!u || !loadedLeagues.includes('england')) return null
  const decision = weeklyStartSettings(u, weekKey, profile.managerName.trim() || 'Touchline XI', pin)
  const s = decision.settings
  const underWay = !!game && game.settings.seed === s.seed && game.settings.mode === 'quick' && game.phase !== 'summary'
  const play = async () => {
    if (underWay) return go('game')
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !(await askConfirm(tr('weeklyConfirm', { mode: tr(game.settings.mode === 'daily' ? 'modeDaily' : 'modeQuick'), team: game.settings.teamName }), { ok: tr('startOk'), danger: true }))) return
    startGame(s)
  }
  return (
    <div className="col world-weekly" data-testid="weekly-card">
      <div>
        <b>{tr('playThisWeek')}</b>
        <div className="small muted">
          {rich(tr('weeklyBlurb', { formation: formationName(s.formationId), club: u.clubById[s.hostClubId]?.name ?? s.hostClubId, season: seasonLabel(s.leagueSeason) }), B)}
          {pin && !decision.ranked && ` ${PIN_NOTE[pinStanding(pin, decision.source) as Exclude<PinStanding, 'ranked'>] ?? ''}`}
        </div>
      </div>
      <button className="btn primary block" onClick={play} data-testid="weekly-play">
        {tr(underWay ? 'continueWeekly' : 'playWeekly')}
      </button>
    </div>
  )
}

/** W-D-L in the result colours: wins green, draws amber, defeats red. */
function Wdl({ won, drawn, lost }: { won: number; drawn: number; lost: number }) {
  return (
    <span className="wdl" role="img" aria-label={tr('wdlAria', { won, drawn, lost })}>
      <span className="res-w">{won}</span>-<span className="res-d">{drawn}</span>-<span className="res-l">{lost}</span>
    </span>
  )
}

function ChaseTable({ scope, country, week }: { scope: ChaseScope; country: string | null; week: string }) {
  const openChallenge = useStore((s) => s.openChallenge)
  const u = useStore((s) => s.universe)
  const b = useBoard<ChaseRow, ChaseSummary | null>(`${scope}|${week}|${country}`, (offset) => api.chaseBoard(scope, week, country, offset), () => api.chaseSummary(scope, week, country))
  const { rows, summary } = b
  const league = (id: string) => u?.available.find((l) => l.id === id)?.shortName ?? id
  const meShown = !!rows?.some((r) => r.isMe)
  const rec = summary?.record
  const level = levelRows((rows ?? []).map((r) => `${r.dropped}|${r.lost}|${r.goalDiff}|${r.goalsFor}`))
  return (
    <section className="panel fit-panel" data-testid="board-chase">
      <div className="panel-head">
        <h3>{tr(scope === 'week' ? 'chaseWeek' : 'chaseAlltime')}</h3>
        <span className="small muted" data-testid="chase-summary">
          {summary ? `${tr('chaseCounts', { players: summary.players, playersText: summary.players.toLocaleString(), runs: summary.runs, runsText: summary.runs.toLocaleString() })}${summary.flawless ? tr('flawlessCount', { n: summary.flawless }) : ''}` : ''}
        </span>
      </div>
      {rec && (
        <div className="notice chase-record" data-testid="chase-record">
          <b>{tr('closestEver')}</b> <Wdl won={rec.won} drawn={rec.drawn} lost={rec.lost} /> {tr('recordPts', { n: rec.points, perfect: rec.won === rec.games ? `, ${perfectTarget(rec.games)}` : '' })} <Flag code={rec.country} />
          {tr('recordWho', { name: rec.name, team: rec.team, league: league(rec.leagueId) })}
          {summary && summary.recordFlawless > 1 ? tr('flawlessInAll', { n: summary.recordFlawless }) : ''}
        </div>
      )}
      <div className="fit-scroll">
        <BoardState rows={rows} error={b.error} offline={b.offline} retry={b.retry} empty={tr('nobodyChase', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })} hint={scope === 'week' ? tr('beFirstChase') : undefined} />
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head board-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{tr('colManager')}</th>
                <th>{tr('colTeam')}</th>
                <th>{tr('colLeague')}</th>
                <th className="num">{tr('colPts')}</th>
                <th className="num">{tr('colWdl')}</th>
                <th className="num">{tr('colGd')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.position}-${r.name}`} className={rowClass(r, r.perfect ? 'chase-perfect' : '')} aria-current={r.isMe || undefined}>
                  <RankCell position={r.position} level={level[i]} />
                  <ManagerCell name={r.name} country={r.country} isMe={r.isMe} />
                  <td className="board-team">{r.team}</td>
                  <td className="small" title={tr('chaseRowTip', { ratings: tr(r.ratings === 'prime' ? 'prime' : 'season'), bench: r.benchPicks ? tr('benchOf', { n: r.benchPicks }) : tr('noBench') })}>
                    {league(r.leagueId)}
                    {r.ratings === 'prime' ? tr('primeSuffix') : ''}
                  </td>
                  <td className="num board-score" title={r.dropped ? tr('shortOf', { n: r.dropped, max: r.games * 3 }) : tr('everyPoint')}>
                    {r.points}
                  </td>
                  <td className="num">
                    <Wdl won={r.won} drawn={r.drawn} lost={r.lost} />
                  </td>
                  <td className="num">{signedGd(r.goalDiff)}</td>
                  <td className="end">
                    {r.perfect && (
                      <span className="chip good" data-testid="chase-flawless">
                        {tr('flawless', { target: perfectTarget(r.games) })}
                      </span>
                    )}
                    {r.payload && (
                      <button className="btn sm ghost" onClick={() => void openChallenge(r.payload!)} title={tr('raceTip')}>
                        {tr('race')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.more && <MoreButton onClick={() => void b.loadMore()} busy={b.busy} />}
      </div>
      {!meShown && summary?.myPosition && summary.my && (
        <MineFoot>
          <b>{tr('youAt', { pos: summary.myPosition })}</b>
          <span>
            {recordLabel(summary.my.won, summary.my.drawn, summary.my.lost)} · {tr('pts', { n: summary.my.points })}
          </span>
        </MineFoot>
      )}
    </section>
  )
}

/** The side panel's "Start a chase run": the league and shape, today's attempts left, and the button. */
function ChasePlay() {
  const { universe: u, game, go, profile } = useStorePick('universe', 'game', 'go', 'profile')
  const session = useOnline((s) => s.session)
  const [league, setLeague] = useState('england')
  const [formation, setFormation] = useState('4-3-3')
  const [ratings, setRatings] = useState<'season' | 'prime'>(CHASE_DEFAULT_OPTIONS.ratings)
  const [bench, setBench] = useState(CHASE_DEFAULT_OPTIONS.benchPicks)
  const [status, setStatus] = useState<ChaseStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (session) void api.chaseStatus().then((s) => live && setStatus(s), () => undefined)
    else setStatus(null)
    return () => {
      live = false
    }
  }, [session])
  if (!u) return null
  const underWay = !!game && isChaseGame(game.settings) && game.phase !== 'summary'
  const left = status ? status.left : null
  const start = async () => {
    if (underWay) return go('game')
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !(await askConfirm(tr('chaseConfirm', { mode: tr(game.settings.mode === 'daily' ? 'modeDaily' : 'modeQuick'), team: game.settings.teamName }), { ok: tr('startOk'), danger: true }))) return
    setBusy(true)
    setMessage(null)
    let r: Awaited<ReturnType<typeof api.startChaseRun>>
    try {
      r = await api.startChaseRun(league, formation, { ratings, benchPicks: bench }, profile.managerName.trim() || 'Touchline XI')
    } catch (e) {
      r = { ok: false, message: onlineErrorText(e) }
    }
    setBusy(false)
    if (!r.ok) {
      setMessage(r.message)
      if (r.signIn) go('account')
    }
  }
  return (
    <div className="col world-weekly" data-testid="chase-card">
      <div>
        <b>{tr('chase38')}</b>
        <div className="small muted">{tr('chaseBlurb', { runs: CHASE_ATTEMPTS_PER_DAY, hours: CHASE_ATTEMPT_HOURS })}</div>
      </div>
      {!underWay && (
        <div className="row wrap chase-pick">
          <label className="field">
            {tr('colLeague')}
            <select className="input" value={league} onChange={(e) => setLeague(e.target.value)} data-testid="chase-league">
              {u.available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tr('shape')}
            <select className="input" value={formation} onChange={(e) => setFormation(e.target.value)} data-testid="chase-formation">
              {CHASE_FORMATIONS.map((f) => (
                <option key={f} value={f}>
                  {formationName(f)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tr('ratings')}
            <select className="input" value={ratings} onChange={(e) => setRatings(e.target.value === 'season' ? 'season' : 'prime')} data-testid="chase-ratings">
              <option value="prime">{tr('prime')}</option>
              <option value="season">{tr('season')}</option>
            </select>
          </label>
          <label className="field">
            {tr('bench')}
            <select className="input" value={bench} onChange={(e) => setBench(Number(e.target.value))} data-testid="chase-bench">
              {[0, 1, 2, 3, 4, 5].map((b) => (
                <option key={b} value={b}>
                  {tr('benchPlaces', { n: b })}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {session && left !== null && !underWay && (
        <div className="small muted" data-testid="chase-left">
          {left ? tr('runsLeft', { n: left, cap: status?.cap ?? CHASE_ATTEMPTS_PER_DAY }) : tr('noRunsLeft')}
          {status?.best ? tr('yourBest', { record: recordLabel(status.best.won, status.best.drawn, status.best.lost) }) : ''}
        </div>
      )}
      {message && <div className="notice warn small">{message}</div>}
      <button className="btn primary block" onClick={() => void start()} disabled={busy || (!underWay && left === 0)} data-testid="chase-start">
        {tr(underWay ? 'continueChase' : busy ? 'dealing' : session ? 'startChase' : 'signInChase')}
      </button>
    </div>
  )
}

/** A casual board (the Daily Arena, the Weekly Challenge, the Run-in of the week): its rows, your place pinned at the foot. */
function CasualTable({ board, boardKey, country, title, current }: { board: CasualKind; boardKey: string; country: string | null; title: string; current: boolean }) {
  const openChallenge = useStore((s) => s.openChallenge)
  const b = useBoard<CasualRow, CasualSummary | null>(`${board}|${boardKey}|${country}`, (offset) => api.casualBoard(board, boardKey, country, offset), () => api.casualSummary(board, boardKey, country))
  const { rows, summary } = b
  const arena = board === 'arena'
  const meShown = !!rows?.some((r) => r.isMe)
  // An arena or Weekly run is a link anyone can race once posting has closed; a run-in has no link
  const race = board !== 'runin' && !!rows?.some((r) => r.revealed && r.payload)
  const level = levelRows((rows ?? []).map((r) => `${r.score}|${r.won}|${r.drawn}|${r.lost}|${r.goalDiff}|${r.goalsFor}|${r.goalsAgainst}`))
  return (
    <section className="panel fit-panel" data-testid={`board-${board}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="small muted" data-testid="board-summary">
          {summary ? `${tr('played', { n: summary.played.toLocaleString() })}${summary.trophies ? tr('casualTrophies', { n: summary.trophies, board }) : ''}${tr(summary.open ? 'postsOpen' : 'closed')}${summary.revealed && board !== 'runin' ? tr('picksRevealed') : ''}` : ''}
        </span>
      </div>
      <div className="fit-scroll">
        <BoardState rows={rows} error={b.error} offline={b.offline} retry={b.retry} empty={tr('nobodyPosted', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })} hint={current && summary?.open !== false ? tr('beFirst') : undefined} />
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head board-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{tr('colManager')}</th>
                {board !== 'runin' && <th>{tr('colTeam')}</th>}
                <th className="num">{tr(arena ? 'colWon' : 'colPts')}</th>
                <th className="num">{tr(arena ? 'colGoals' : 'colWdl')}</th>
                <th className="num">{tr('colGd')}</th>
                <th>{tr('colResult')}</th>
                {race && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.position}-${r.name}`} className={rowClass(r, r.trophy ? 'board-trophy' : '')} aria-current={r.isMe || undefined}>
                  <RankCell position={r.position} level={level[i]} />
                  <ManagerCell name={r.name} country={r.country} isMe={r.isMe} />
                  {board !== 'runin' && <td className="board-team">{r.team}</td>}
                  <td className="num board-score">{r.score}</td>
                  <td className="num">{arena ? `${r.goalsFor}-${r.goalsAgainst}` : <Wdl won={r.won} drawn={r.drawn} lost={r.lost} />}</td>
                  <td className="num">{signedGd(r.goalDiff)}</td>
                  <td className="small">
                    {r.trophy && <span className="chip good board-trophy-chip">{tr('casualTrophy', { board })}</span>}
                    {arena ? r.detail : board === 'runin' ? tr('runInResult', { pos: r.leaguePosition ?? 0, outcome: r.trophy ? 'met' : r.detail === 'SACKED' ? 'sacked' : 'missed' }) : tr('resultLine', { tier: tierText(r.detail), pos: r.leaguePosition ?? 0 })}
                  </td>
                  {race && (
                    <td className="end">
                      {r.revealed && r.payload && (
                        <button className="btn sm" onClick={() => void openChallenge(r.payload!)}>
                          {tr('raceRun')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.more && <MoreButton onClick={() => void b.loadMore()} busy={b.busy} />}
      </div>
      {!meShown && summary?.myPosition && (
        <MineFoot>
          <b>{tr('youAt', { pos: summary.myPosition })}</b>
          <span>{tr(arena ? 'wonN' : 'pts', { n: summary.myScore })}</span>
        </MineFoot>
      )}
    </section>
  )
}

/** A side-panel card: what the board is for, your standing on it today, and the one button to play it. */
function PlayCard({ title, line, done, action, onClick, disabled, testId }: { title: string; line: ReactNode; done: string | null; action: string; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <div className="col world-weekly world-play" data-testid={testId}>
      <div>
        <b>{title}</b>
        <div className="small muted">{line}</div>
        {done && <div className="small world-play-done" data-testid={`${testId}-done`}>{done}</div>}
      </div>
      <button type="button" className={`btn block${done ? '' : ' primary'}`} onClick={onClick} disabled={disabled} data-testid={`${testId}-go`}>
        {action}
      </button>
    </div>
  )
}

/** Today's Daily from its board: it continues where it was left, else opens the Daily's setup (as Home's card does). */
function DailyPlay() {
  const { universe: u, game, parked, go, resumeGame, profile, loadedLeagues } = useStorePick('universe', 'game', 'parked', 'go', 'resumeGame', 'profile', 'loadedLeagues')
  const pin = useOnline((st) => (st.pins.day === new Date().toISOString().slice(0, 10) ? st.pins.daily : null))
  if (!u || !loadedLeagues.includes('england')) return null
  const seed = todaysDailySeed()
  // Online and pinned: the ranked puzzle, as Home's card reads it
  const s = dailyStartSettings(u, seed, 'Touchline XI', pin).settings
  const isToday = (g: typeof game) => !!g && g.settings.mode === 'daily' && g.settings.seed === seed && g.phase !== 'summary'
  const result = profile.dailyResults[`daily-${new Date().toISOString().slice(0, 10)}`]
  const underWay = isToday(game) || isToday(parked.quick)
  const play = () => (isToday(game) ? go('game') : isToday(parked.quick) ? resumeGame('quick') : go('setup', 'daily'))
  return (
    <PlayCard
      testId="world-play-daily"
      title={tr('playTodayDaily')}
      line={rich(tr('dailyCardLine', { formation: formationName(s.formationId), club: u.clubById[s.hostClubId]?.name ?? s.hostClubId, season: seasonLabel(s.leagueSeason) }), B)}
      done={result && !underWay ? tr('playedToday', { n: result.points, tier: tierText(result.tier) }) : null}
      action={tr(underWay ? 'continueDailyWorld' : result ? 'playAgainPractice' : 'playDailyWorld')}
      onClick={play}
    />
  )
}

/** Today's Daily Arena from its board: the run continues wherever it is; another unfinished arena run is only dropped on a yes. */
function ArenaDailyPlay() {
  const { universe: u, game, parked, go, resumeGame, profile, loadedLeagues, startGame } = useStorePick('universe', 'game', 'parked', 'go', 'resumeGame', 'profile', 'loadedLeagues', 'startGame')
  if (!u || !loadedLeagues.includes('england')) return null
  const seed = arenaDailySeed()
  const today = dailyArenaSettings(seed)
  const done = profile.arenaDaily?.results[seed]
  const isToday = (g: typeof game) => !!g && !!g.settings.arena?.daily && g.settings.seed === seed && g.phase !== 'summary'
  const underWay = isToday(game) ? 'active' : isToday(parked.arena) ? 'parked' : null
  const play = async () => {
    if (underWay === 'active') return go('game')
    if (underWay === 'parked') return resumeGame('arena')
    const open = [game, parked.arena].find((g) => g && slotOf(g) === 'arena' && g.phase !== 'summary')
    if (open && !(await askConfirm(tr('arenaAbandonWorld', { team: open.settings.teamName }), { ok: tr('startOk'), danger: true }))) return
    if (!open && done && !(await askConfirm(tr('arenaAgainWorld', { label: done.label }), { ok: tr('playAgainOk') }))) return
    startGame(dailyArenaGameSettings(u, seed))
  }
  return (
    <PlayCard
      testId="world-play-arena"
      title={tr('playTodayArena')}
      line={tr(today.format === 'gauntlet' ? 'arenaCardGauntlet' : 'arenaCardCup', { size: today.size ?? 16, wheel: u.available.find((l) => l.id === today.leagueId)?.name ?? today.leagueId })}
      done={done && !underWay ? tr('playedArenaToday', { label: done.label }) : null}
      action={tr(underWay ? 'continueArenaWorld' : done ? 'playAgainPractice' : 'playArenaWorld')}
      onClick={() => void play()}
    />
  )
}

/** This week's Weekly Challenge from its board: under way it continues, else its setup opens (the week's packs load there). */
function ThemedWeekPlay() {
  const { universe: u, game, parked, go, resumeGame, profile } = useStorePick('universe', 'game', 'parked', 'go', 'resumeGame', 'profile')
  if (!u) return null
  const seed = weeklySeed()
  const plan = weeklyPlan(u, seed)
  const done = profile.weekly?.results[seed]
  const isThisWeek = (g: typeof game) => !!g && g.settings.mode === 'weekly' && g.settings.seed === seed && g.phase !== 'summary'
  const underWay = isThisWeek(game) || isThisWeek(parked.quick)
  const play = () => (isThisWeek(game) ? go('game') : isThisWeek(parked.quick) ? resumeGame('quick') : go('setup', 'weekly'))
  return (
    <PlayCard
      testId="world-play-themed"
      title={tr('playThemedWeek')}
      line={plan ? tr('themedCardLine', { theme: weeklyThemeText(plan.theme) }) : tr('themedCardFallback')}
      done={done && !underWay ? tr('playedThemed', { n: done.points, tier: tierText(done.tier) }) : null}
      action={tr(underWay ? 'continueThemed' : done ? 'playAgainPractice' : 'playThemedGo')}
      onClick={play}
    />
  )
}

/** The side panel's card for the Run-in of the week: the week's job, and Play (its league loads first). */
function RunInWeekPlay() {
  const { universe: u, game, go, startRunInWeek, loadedLeagues, ensureLeagues, parked, resumeGame } = useStorePick('universe', 'game', 'go', 'startRunInWeek', 'loadedLeagues', 'ensureLeagues', 'parked', 'resumeGame')
  const seed = runInWeekSeed()
  const plan = weeklyRunInPlan(seed)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (plan) void ensureLeagues([plan.leagueId])
  }, [ensureLeagues, plan?.leagueId])
  if (!u || !plan) return null
  const job = loadedLeagues.includes(plan.leagueId) ? weeklyRunInJob(u, seed) : null
  const open = [game, parked.runin].find((g) => g && slotOf(g) === 'runin' && g.phase !== 'summary')
  const underWay = !!open && isWeeklyRunIn(open.settings) && open.settings.seed === seed
  const play = async () => {
    if (underWay) return open === game ? go('game') : resumeGame('runin')
    if (open && !(await askConfirm(tr('runInWeekConfirm', { team: open.settings.teamName }), { ok: tr('takeJobOk'), danger: true }))) return
    setBusy(true)
    await startRunInWeek(seed)
    setBusy(false)
  }
  return (
    <div className="col world-weekly" data-testid="runin-week-card">
      <div>
        <b>{tr('playRunInWeek')}</b>
        <div className="small muted">
          {job ? (
            <>
              {rich(tr('runInWeekJob', { brief: templateText(job.template), club: u.clubById[job.clubId]?.name ?? job.clubId, season: seasonLabel(job.season), pos: job.projected.position, week: job.takeover }), B)}{' '}
            </>
          ) : (
            tr('runInWeekLoading')
          )}
          {tr('runInWeekBlurb')}
        </div>
      </div>
      <button className="btn primary block" onClick={() => void play()} disabled={busy || !job} data-testid="runin-week-play">
        {underWay ? tr('continueRunInWeek') : busy ? tr('loading') : tr('playRunInWeek')}
      </button>
    </div>
  )
}

const BOARDS: Array<{ id: Tab; label: () => string; meta: () => string }> = [
  { id: 'daily', label: () => tr('todaysDaily'), meta: () => tr('dailyMeta') },
  { id: 'weekly', label: () => tr('thisWeeksChallenge'), meta: () => tr('weeklyMeta') },
  { id: 'alltime', label: () => tr('alltimeTitle'), meta: () => tr('alltimeMeta') },
  { id: 'chase', label: () => tr('chaseLabel'), meta: () => tr('chaseMeta') },
  { id: 'arena', label: () => tr('casualTitle', { board: 'arena' }), meta: () => tr('arenaMeta') },
  { id: 'themed', label: () => tr('casualTitle', { board: 'themed' }), meta: () => tr('themedMeta') },
  { id: 'runin', label: () => tr('casualTitle', { board: 'runin' }), meta: () => tr('runinMeta') },
]

/**
 * The world leaderboard (screen `world`): today's Daily, this week's challenge, all-time Daily totals, the 38-0 chase
 * and the casual boards (the Daily Arena, the Weekly Challenge, the Run-in of the week), a country filter on each. A shell screen: two boxed panels side by side with no page scroll on a desktop (the board scrolls
 * inside its panel under a sticky header, your own row pinned at its foot); stacked on a phone.
 */
export function WorldBoard() {
  const go = useStore((s) => s.go)
  const configured = useOnline((s) => s.configured)
  const account = useOnline((s) => s.account)
  const session = useOnline((s) => s.session)
  const [tab, setTabState] = useState<Tab>(rememberedTab)
  const setTab = (t: Tab) => {
    setTabState(t)
    rememberWorldTab(t)
  }
  const [chaseScope, setChaseScope] = useState<ChaseScope>('week')
  const [country, setCountry] = useState<string | null>(null)
  const [order, setOrder] = useState<AlltimeOrder>('points')
  const today = new Date().toISOString().slice(0, 10)
  const [day, setDay] = useState(today)
  const thisWeek = weekKeyOf(new Date())
  const lastWeek = weekKeyOf(new Date((weekStartOf(thisWeek)?.getTime() ?? Date.now()) - DAY))
  const [week, setWeek] = useState(thisWeek)
  const [arenaDay, setArenaDay] = useState(today)
  const [casualWeek, setCasualWeek] = useState(thisWeek)
  useEffect(() => {
    if (configured) void api.startOnline()
  }, [configured])
  const help =
    tab === 'arena'
      ? tr('helpArena')
      : tab === 'themed' || tab === 'runin'
        ? tr('helpCasualWeek', { board: tab })
        : tab === 'chase'
          ? tr('helpChase')
          : tr('helpBoards')
  return (
    <div className="page world-page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>{tr('worldLeaderboard')}</h1>
          <div className="screen-meta">
            <span>{tr('worldMeta')}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          {tr('backHome')}
        </button>
      </div>
      {!api.onlineAvailable() ? (
        <div className="panel">
          <p className="muted">{tr('notAvailable')}</p>
        </div>
      ) : (
        <div className="screen-body fill">
        <div className="grid world-grid">
          <aside className="panel fit-panel" data-testid="world-side">
            <div className="panel-head">
              <h3>{tr('boards')}</h3>
              {/* A short desktop window: the help below becomes this tip, so the box never shows half a line above its foot */}
              <span className="world-help-tip">
                <Info label={tr('howRanked')}>{help}</Info>
              </span>
            </div>
            <div className="fit-scroll col">
              <div className="world-boards" role="tablist" aria-label={tr('boards')} aria-orientation="vertical" onKeyDown={onTabListKey}>
                {BOARDS.map((b) => (
                  <button key={b.id} type="button" role="tab" aria-selected={tab === b.id} tabIndex={tab === b.id ? 0 : -1} className={`world-board-pick${tab === b.id ? ' active' : ''}`} title={b.meta()} onClick={() => setTab(b.id)} data-testid={`world-tab-${b.id}`}>
                    <b>{b.label()}</b>
                    <span>{b.meta()}</span>
                  </button>
                ))}
              </div>
              {/* The board's Play card first, so what to do next sits under the boards (the weekly's and the run-in's stay with their week switch) */}
              {tab === 'daily' && day === today && <DailyPlay />}
              {tab === 'arena' && arenaDay === today && <ArenaDailyPlay />}
              {tab === 'themed' && casualWeek === thisWeek && <ThemedWeekPlay />}
              <div className="field">
                {tr('country')}
                <CountrySelect value={country} onChange={setCountry} emptyLabel={tr('everywhere')} testId="board-country" />
              </div>
              {account?.country && account.country !== country && (
                <button className="btn sm ghost" onClick={() => setCountry(account.country)}>
                  <CountryFlag code={account.country} size={16} /> {tr('myCountry')}
                </button>
              )}
              {tab === 'daily' && (
                <label className="field">
                  {tr('day')}
                  <input className="input" type="date" value={day} max={today} min={new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value || today)} aria-label={tr('day')} />
                </label>
              )}
              {tab === 'weekly' && <Segmented label={tr('weekChoice')} value={week} onChange={setWeek} options={[{ value: thisWeek, label: tr('thisWeek') }, { value: lastWeek, label: tr('lastWeek') }]} />}
              {tab === 'weekly' && weeklyIsOpen(thisWeek, new Date()) && week === thisWeek && <WeeklyPlay weekKey={thisWeek} />}
              {tab === 'alltime' && <Segmented label={tr('orderBy')} value={order} onChange={setOrder} options={[{ value: 'points', label: tr('totalPoints') }, { value: 'streak', label: tr('colBestStreak') }]} />}
              {tab === 'chase' && <Segmented label={tr('chaseScope')} value={chaseScope} onChange={setChaseScope} options={[{ value: 'week', label: tr('thisWeek'), testId: 'chase-scope-week' }, { value: 'alltime', label: tr('allTime'), testId: 'chase-scope-alltime' }]} />}
              {tab === 'chase' && <ChasePlay />}
              {tab === 'arena' && (
                <label className="field">
                  {tr('day')}
                  <input className="input" type="date" value={arenaDay} max={today} min={new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)} onChange={(e) => setArenaDay(e.target.value || today)} aria-label={tr('day')} data-testid="arena-day" />
                </label>
              )}
              {(tab === 'themed' || tab === 'runin') && <Segmented label={tr('weekChoice')} value={casualWeek} onChange={setCasualWeek} options={[{ value: thisWeek, label: tr('thisWeek') }, { value: lastWeek, label: tr('lastWeek') }]} />}
              {tab === 'runin' && casualWeek === thisWeek && <RunInWeekPlay />}
              <p className="help world-help">{help}</p>
            </div>
            {!session && (
              <div className="fit-foot">
                <button className="btn sm primary block" onClick={() => go('account')} data-testid="world-signin">
                  {tr('signInWorld')}
                </button>
              </div>
            )}
          </aside>
          {tab === 'daily' && <RankedTable kind="daily" boardKey={day} country={country} current={day === today} title={day === today ? tr('todaysDaily') : tr('dailyOf', { day })} />}
          {tab === 'weekly' && <RankedTable kind="weekly" boardKey={week} country={country} current={week === thisWeek && weeklyIsOpen(thisWeek, new Date())} title={week === thisWeek ? tr('thisWeeksChallenge') : tr('weekOf', { week })} />}
          {tab === 'alltime' && <AlltimeTable country={country} order={order} />}
          {tab === 'chase' && <ChaseTable scope={chaseScope} country={country} week={thisWeek} />}
          {tab === 'arena' && <CasualTable board="arena" boardKey={arenaDay} country={country} current={arenaDay === today} title={arenaDay === today ? tr('todaysArena') : tr('arenaOf', { day: arenaDay })} />}
          {(tab === 'themed' || tab === 'runin') && <CasualTable board={tab} boardKey={casualWeek} country={country} current={casualWeek === thisWeek} title={tr(casualWeek === thisWeek ? 'casualThisWeek' : 'casualWeekOf', { board: tab, week: casualWeek })} />}
        </div>
        </div>
      )}
    </div>
  )
}
