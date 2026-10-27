import { useEffect, useState } from 'react'
import { useStore, slotOf } from '@game/store'
import { TIER_LABEL } from '@engine/season'
import type { SeasonTier } from '@engine/types'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import type { AlltimeMine, AlltimeOrder, AlltimeRow, BoardRow, BoardSummary, ChaseRow, ChaseScope, ChaseStatus, ChaseSummary, RankedKind } from '../../online/boards'
import { PAGE } from '../../online/boards'
import { countryFlag } from '../../online/core/country'
import { weekKeyOf, weekStartOf, weeklyIsOpen } from '../../online/weekly'
import { weeklyStartSettings } from '../../online/daily'
import { PIN_NOTE, pinStanding, type PinStanding } from '../../online/engineRoute'
import { CHASE_ATTEMPT_HOURS, CHASE_ATTEMPTS_PER_DAY, CHASE_DEFAULT_OPTIONS, CHASE_FORMATIONS, isChaseGame } from '../../online/chase'
import { perfectTarget, recordLabel } from '@game/logic/perfect'
import { Info, Segmented } from '../components/bits'
import { seasonLabel } from '../format'
import { CountrySelect } from './AccountPanel'
import { countryName } from './countries'
import { onlineErrorText } from '../../online/postText'
import { translator } from '../i18n'
import { online } from '../i18n/en/online'
import { B, rich } from '../i18n/rich'

const tr = translator(online)

type Tab = 'daily' | 'weekly' | 'alltime' | 'chase'
const TABS: readonly Tab[] = ['daily', 'weekly', 'alltime', 'chase']

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
const tierText = (t: string) => TIER_LABEL[t as SeasonTier] ?? t

function Flag({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <span title={countryName(code)} style={{ marginRight: 4 }}>
      {countryFlag(code)}
    </span>
  )
}

function RankedTable({ kind, boardKey, country, title }: { kind: RankedKind; boardKey: string; country: string | null; title: string }) {
  const openChallenge = useStore((s) => s.openChallenge)
  const session = useOnline((s) => s.session)
  const [rows, setRows] = useState<BoardRow[] | null>(null)
  const [summary, setSummary] = useState<BoardSummary | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    Promise.all([api.board(kind, boardKey, country), api.boardSummary(kind, boardKey, country)]).then(
      ([r, s]) => {
        if (!live) return
        setRows(r)
        setSummary(s)
        setMore(r.length === PAGE)
      },
      (e: unknown) => live && setError(onlineErrorText(e)),
    )
    return () => {
      live = false
    }
  }, [kind, boardKey, country, session])
  const loadMore = async () => {
    if (!rows) return
    let next: typeof rows
    try {
      next = await api.board(kind, boardKey, country, rows.length)
    } catch (e) {
      // A dropped connection keeps the rows shown and says why the next page did not come
      setError(onlineErrorText(e))
      return
    }
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  const meShown = !!rows?.some((r) => r.isMe)
  const race = !!rows?.some((r) => r.revealed && r.payload)
  return (
    <section className="panel fit-panel" data-testid={`board-${kind}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <span className="small muted" data-testid="board-summary">
          {summary ? `${tr('played', { n: summary.played.toLocaleString() })}${summary.top !== null ? tr('topScore', { n: summary.top }) : ''}${tr(summary.open ? 'postsOpen' : 'closed')}${summary.revealed ? tr('picksRevealed') : ''}` : ''}
        </span>
      </div>
      <div className="fit-scroll">
        {error && <div className="notice warn" data-testid="board-error">{tr('boardError', { error })}</div>}
        {!rows && !error && <div className="muted small">{tr('loading')}</div>}
        {rows && rows.length === 0 && <div className="muted small">{tr('nobodyPosted', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })}</div>}
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head">
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
              {rows.map((r) => (
                <tr key={`${r.position}-${r.name}`} className={r.isMe ? 'me' : ''}>
                  <td className="num">{r.position}</td>
                  <td>
                    <Flag code={r.country} />
                    {r.name}
                    {r.isMe && <span className="chip info" style={{ marginLeft: 6 }}>{tr('you')}</span>}
                  </td>
                  <td>{r.team}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {r.points}
                  </td>
                  <td className="num">
                    {r.won}-{r.drawn}-{r.lost}
                  </td>
                  <td className="num">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                  <td className="small">
                    {tr('resultLine', { tier: tierText(r.tier), pos: r.leaguePosition })}
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
        {more && (
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void loadMore()}>
            {tr('showMore')}
          </button>
        )}
      </div>
      {!meShown && summary?.myPosition && (
        <div className="fit-foot notice row between" data-testid="board-mine">
          <b>{tr('youAt', { pos: summary.myPosition })}</b>
          <span>{tr('pts', { n: summary.myPoints })}</span>
        </div>
      )}
    </section>
  )
}

function AlltimeTable({ country, order }: { country: string | null; order: AlltimeOrder }) {
  const session = useOnline((s) => s.session)
  const [rows, setRows] = useState<AlltimeRow[] | null>(null)
  const [mine, setMine] = useState<AlltimeMine | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    Promise.all([api.alltime(order, country), api.alltimeMine(order, country)]).then(
      ([r, m]) => {
        if (!live) return
        setRows(r)
        setMine(m)
        setMore(r.length === PAGE)
      },
      (e: unknown) => live && setError(onlineErrorText(e)),
    )
    return () => {
      live = false
    }
  }, [order, country, session])
  const loadMore = async () => {
    if (!rows) return
    let next: typeof rows
    try {
      next = await api.alltime(order, country, rows.length)
    } catch (e) {
      // A dropped connection keeps the rows shown and says why the next page did not come
      setError(onlineErrorText(e))
      return
    }
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  return (
    <section className="panel fit-panel" data-testid="board-alltime">
      <div className="panel-head">
        <h3>{tr('alltimeTitle')}</h3>
        <span className="small muted">{tr(order === 'points' ? 'byPoints' : 'byStreak')}</span>
      </div>
      <div className="fit-scroll">
        {error && <div className="notice warn" data-testid="board-error">{tr('boardError', { error })}</div>}
        {!rows && !error && <div className="muted small">{tr('loading')}</div>}
        {rows && rows.length === 0 && <div className="muted small">{tr('nobodyDaily', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })}</div>}
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head">
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
              {rows.map((r) => (
                <tr key={`${r.position}-${r.name}`} className={r.isMe ? 'me' : ''}>
                  <td className="num">{r.position}</td>
                  <td>
                    <Flag code={r.country} />
                    {r.name}
                    {r.isMe && <span className="chip info" style={{ marginLeft: 6 }}>{tr('you')}</span>}
                  </td>
                  <td className="num" style={{ fontWeight: order === 'points' ? 700 : 400 }}>
                    {r.totalPoints.toLocaleString()}
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.average}</td>
                  <td className="num" style={{ fontWeight: order === 'streak' ? 700 : 400 }}>
                    {r.bestStreak}
                  </td>
                  <td className="num">{r.currentStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {more && (
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void loadMore()}>
            {tr('showMore')}
          </button>
        )}
      </div>
      {mine && !rows?.some((r) => r.isMe) && (
        <div className="fit-foot notice row between wrap" data-testid="board-mine">
          <b>
            {tr('youOf', { pos: mine.position, total: mine.players.toLocaleString() })}
          </b>
          <span>
            {tr('mineLine', { pts: mine.totalPoints.toLocaleString(), n: mine.played, streak: mine.bestStreak })}
          </span>
        </div>
      )}
      {!session && <div className="fit-foot small muted">{tr('signInAlltime')}</div>}
    </section>
  )
}

function WeeklyPlay({ weekKey }: { weekKey: string }) {
  const { universe: u, game, startGame, go, profile, loadedLeagues } = useStore()
  const pin = useOnline((s) => (s.pins.week === weekKey ? s.pins.weekly : null))
  if (!u || !loadedLeagues.includes('england')) return null
  const decision = weeklyStartSettings(u, weekKey, profile.managerName.trim() || 'Touchline XI', pin)
  const s = decision.settings
  const underWay = !!game && game.settings.seed === s.seed && game.settings.mode === 'quick' && game.phase !== 'summary'
  const play = () => {
    if (underWay) return go('game')
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !confirm(tr('weeklyConfirm', { mode: tr(game.settings.mode === 'daily' ? 'modeDaily' : 'modeQuick'), team: game.settings.teamName }))) return
    startGame(s)
  }
  return (
    <div className="col world-weekly" data-testid="weekly-card">
      <div>
        <b>{tr('playThisWeek')}</b>
        <div className="small muted">
          {rich(tr('weeklyBlurb', { formation: s.formationId, club: u.clubById[s.hostClubId]?.name ?? s.hostClubId, season: seasonLabel(s.leagueSeason) }), B)}
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
  const session = useOnline((s) => s.session)
  const [rows, setRows] = useState<ChaseRow[] | null>(null)
  const [summary, setSummary] = useState<ChaseSummary | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    Promise.all([api.chaseBoard(scope, week, country), api.chaseSummary(scope, week, country)]).then(
      ([r, s]) => {
        if (!live) return
        setRows(r)
        setSummary(s)
        setMore(r.length === PAGE)
      },
      (e: unknown) => live && setError(onlineErrorText(e)),
    )
    return () => {
      live = false
    }
  }, [scope, week, country, session])
  const loadMore = async () => {
    if (!rows) return
    let next: typeof rows
    try {
      next = await api.chaseBoard(scope, week, country, rows.length)
    } catch (e) {
      // A dropped connection keeps the rows shown and says why the next page did not come
      setError(onlineErrorText(e))
      return
    }
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  const league = (id: string) => u?.available.find((l) => l.id === id)?.shortName ?? id
  const meShown = !!rows?.some((r) => r.isMe)
  const rec = summary?.record
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
        {error && <div className="notice warn" data-testid="board-error">{tr('boardError', { error })}</div>}
        {!rows && !error && <div className="muted small">{tr('loading')}</div>}
        {rows && rows.length === 0 && <div className="muted small">{tr('nobodyChase', { from: country ? tr('fromCountry', { country: countryName(country) }) : '' })}</div>}
        {rows && rows.length > 0 && (
          <table className="tbl sticky-head">
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
              {rows.map((r) => (
                <tr key={`${r.position}-${r.name}`} className={`${r.isMe ? 'me' : ''}${r.perfect ? ' chase-perfect' : ''}`}>
                  <td className="num">{r.position}</td>
                  <td>
                    <Flag code={r.country} />
                    {r.name}
                    {r.isMe && <span className="chip info" style={{ marginLeft: 6 }}>{tr('you')}</span>}
                  </td>
                  <td>{r.team}</td>
                  <td className="small" title={tr('chaseRowTip', { ratings: tr(r.ratings === 'prime' ? 'prime' : 'season'), bench: r.benchPicks ? tr('benchOf', { n: r.benchPicks }) : tr('noBench') })}>
                    {league(r.leagueId)}
                    {r.ratings === 'prime' ? tr('primeSuffix') : ''}
                  </td>
                  <td className="num" style={{ fontWeight: 700 }} title={r.dropped ? tr('shortOf', { n: r.dropped, max: r.games * 3 }) : tr('everyPoint')}>
                    {r.points}
                  </td>
                  <td className="num">
                    <Wdl won={r.won} drawn={r.drawn} lost={r.lost} />
                  </td>
                  <td className="num">{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
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
        {more && (
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void loadMore()}>
            {tr('showMore')}
          </button>
        )}
      </div>
      {!meShown && summary?.myPosition && summary.my && (
        <div className="fit-foot notice row between" data-testid="board-mine">
          <b>{tr('youAt', { pos: summary.myPosition })}</b>
          <span>
            {recordLabel(summary.my.won, summary.my.drawn, summary.my.lost)} · {tr('pts', { n: summary.my.points })}
          </span>
        </div>
      )}
    </section>
  )
}

/** The side panel's "Start a chase run": the league and shape, today's attempts left, and the button. */
function ChasePlay() {
  const { universe: u, game, go, profile } = useStore()
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
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !confirm(tr('chaseConfirm', { mode: tr(game.settings.mode === 'daily' ? 'modeDaily' : 'modeQuick'), team: game.settings.teamName }))) return
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
                  {f}
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

const BOARDS: Array<{ id: Tab; label: () => string; meta: () => string }> = [
  { id: 'daily', label: () => tr('todaysDaily'), meta: () => tr('dailyMeta') },
  { id: 'weekly', label: () => tr('thisWeeksChallenge'), meta: () => tr('weeklyMeta') },
  { id: 'alltime', label: () => tr('alltimeTitle'), meta: () => tr('alltimeMeta') },
  { id: 'chase', label: () => tr('chaseLabel'), meta: () => tr('chaseMeta') },
]

/**
 * The world leaderboard (screen `world`): today's Daily, this week's challenge, all-time Daily totals, a country
 * filter on each. A shell screen: two boxed panels side by side with no page scroll on a desktop (the board scrolls
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
  useEffect(() => {
    if (configured) void api.startOnline()
  }, [configured])
  const help =
    tab === 'chase'
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
              <div className="world-boards" role="tablist" aria-label={tr('boards')}>
                {BOARDS.map((b) => (
                  <button key={b.id} type="button" role="tab" aria-selected={tab === b.id} className={`world-board-pick${tab === b.id ? ' active' : ''}`} onClick={() => setTab(b.id)} data-testid={`world-tab-${b.id}`}>
                    <b>{b.label()}</b>
                    <span>{b.meta()}</span>
                  </button>
                ))}
              </div>
              <div className="field">
                {tr('country')}
                <CountrySelect value={country} onChange={setCountry} emptyLabel={tr('everywhere')} testId="board-country" />
              </div>
              {account?.country && account.country !== country && (
                <button className="btn sm ghost" onClick={() => setCountry(account.country)}>
                  {countryFlag(account.country)} {tr('myCountry')}
                </button>
              )}
              {tab === 'daily' && (
                <label className="field">
                  {tr('day')}
                  <input className="input" type="date" value={day} max={today} min={new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value || today)} aria-label={tr('day')} />
                </label>
              )}
              {tab === 'weekly' && <Segmented value={week} onChange={setWeek} options={[{ value: thisWeek, label: tr('thisWeek') }, { value: lastWeek, label: tr('lastWeek') }]} />}
              {tab === 'weekly' && weeklyIsOpen(thisWeek, new Date()) && week === thisWeek && <WeeklyPlay weekKey={thisWeek} />}
              {tab === 'alltime' && <Segmented value={order} onChange={setOrder} options={[{ value: 'points', label: tr('totalPoints') }, { value: 'streak', label: tr('colBestStreak') }]} />}
              {tab === 'chase' && <Segmented value={chaseScope} onChange={setChaseScope} options={[{ value: 'week', label: tr('thisWeek'), testId: 'chase-scope-week' }, { value: 'alltime', label: tr('allTime'), testId: 'chase-scope-alltime' }]} />}
              {tab === 'chase' && <ChasePlay />}
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
          {tab === 'daily' && <RankedTable kind="daily" boardKey={day} country={country} title={day === today ? tr('todaysDaily') : tr('dailyOf', { day })} />}
          {tab === 'weekly' && <RankedTable kind="weekly" boardKey={week} country={country} title={week === thisWeek ? tr('thisWeeksChallenge') : tr('weekOf', { week })} />}
          {tab === 'alltime' && <AlltimeTable country={country} order={order} />}
          {tab === 'chase' && <ChaseTable scope={chaseScope} country={country} week={thisWeek} />}
        </div>
        </div>
      )}
    </div>
  )
}
