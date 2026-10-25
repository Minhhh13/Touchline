import { useEffect, useState } from 'react'
import { useStore, slotOf } from '@game/store'
import { TIER_LABEL } from '@engine/season'
import type { SeasonTier } from '@engine/types'
import { useOnline } from '../../online/state'
import * as api from '../../online/api'
import type { AlltimeMine, AlltimeOrder, AlltimeRow, BoardRow, BoardSummary, RankedKind } from '../../online/boards'
import { PAGE } from '../../online/boards'
import { countryFlag } from '../../online/core/country'
import { weekKeyOf, weekStartOf, weeklyIsOpen } from '../../online/weekly'
import { weeklyStartSettings } from '../../online/daily'
import { Segmented, Tabs } from '../components/bits'
import { ordinal, seasonLabel } from '../format'
import { CountrySelect } from './AccountPanel'
import { countryName } from './countries'

type Tab = 'daily' | 'weekly' | 'alltime'

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

function RankedTable({ kind, boardKey, country }: { kind: RankedKind; boardKey: string; country: string | null }) {
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
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [kind, boardKey, country, session])
  const loadMore = async () => {
    if (!rows) return
    const next = await api.board(kind, boardKey, country, rows.length)
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  if (error) return <div className="notice warn">Could not load the board: {error}</div>
  if (!rows) return <div className="muted small">Loading…</div>
  const meShown = rows.some((r) => r.isMe)
  return (
    <div className="col" data-testid={`board-${kind}`}>
      <div className="small muted">
        {summary ? `${summary.played.toLocaleString()} played${summary.top !== null ? ` · top ${summary.top}` : ''}${summary.open ? ' · posts open' : ' · closed'}${summary.revealed ? ' · picks revealed' : ''}` : ''}
      </div>
      {rows.length === 0 ? (
        <div className="muted small">Nobody has posted here yet{country ? ` from ${countryName(country)}` : ''}.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Manager</th>
                <th>Team</th>
                <th className="num">Pts</th>
                <th className="num">W-D-L</th>
                <th className="num">GD</th>
                <th>Result</th>
                {rows.some((r) => r.revealed && r.payload) && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.position}-${r.name}`} className={r.isMe ? 'board-me' : ''}>
                  <td className="num">{r.position}</td>
                  <td>
                    <Flag code={r.country} />
                    {r.name}
                    {r.isMe && <span className="chip info" style={{ marginLeft: 6 }}>You</span>}
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
                    {tierText(r.tier)} · {ordinal(r.leaguePosition)}
                  </td>
                  {rows.some((x) => x.revealed && x.payload) && (
                    <td>
                      {r.revealed && r.payload && (
                        <button className="btn sm" onClick={() => void openChallenge(r.payload!)}>
                          Race this run
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button className="btn sm ghost" onClick={() => void loadMore()}>
          Show more
        </button>
      )}
      {!meShown && summary?.myPosition && (
        <div className="notice row between" data-testid="board-mine">
          <b>You: {ordinal(summary.myPosition)}</b>
          <span>{summary.myPoints} pts</span>
        </div>
      )}
      {!session && <div className="small muted">Sign in on the Record page to post your own runs here.</div>}
    </div>
  )
}

function AlltimeTable({ country }: { country: string | null }) {
  const session = useOnline((s) => s.session)
  const [order, setOrder] = useState<AlltimeOrder>('points')
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
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [order, country, session])
  const loadMore = async () => {
    if (!rows) return
    const next = await api.alltime(order, country, rows.length)
    setRows([...rows, ...next])
    setMore(next.length === PAGE)
  }
  return (
    <div className="col" data-testid="board-alltime">
      <Segmented value={order} onChange={setOrder} options={[{ value: 'points', label: 'Total points' }, { value: 'streak', label: 'Best streak' }]} />
      <div className="small muted">Every verified Daily counts: the sum of the server's replayed points, and the longest run of consecutive days.</div>
      {error && <div className="notice warn">Could not load the board: {error}</div>}
      {!rows && !error && <div className="muted small">Loading…</div>}
      {rows && rows.length === 0 && <div className="muted small">Nobody has posted a Daily yet{country ? ` from ${countryName(country)}` : ''}.</div>}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Manager</th>
                <th className="num">Points</th>
                <th className="num">Dailies</th>
                <th className="num">Avg</th>
                <th className="num">Best streak</th>
                <th className="num">Streak now</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.position}-${r.name}`} className={r.isMe ? 'board-me' : ''}>
                  <td className="num">{r.position}</td>
                  <td>
                    <Flag code={r.country} />
                    {r.name}
                    {r.isMe && <span className="chip info" style={{ marginLeft: 6 }}>You</span>}
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
        </div>
      )}
      {more && (
        <button className="btn sm ghost" onClick={() => void loadMore()}>
          Show more
        </button>
      )}
      {mine && !rows?.some((r) => r.isMe) && (
        <div className="notice row between wrap" data-testid="board-mine">
          <b>
            You: {ordinal(mine.position)} of {mine.players.toLocaleString()}
          </b>
          <span>
            {mine.totalPoints.toLocaleString()} pts · {mine.played} dailies · best streak {mine.bestStreak}
          </span>
        </div>
      )}
      {!session && <div className="small muted">Sign in on the Record page to add your Dailies to the all-time board.</div>}
    </div>
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
    if (game && slotOf(game) === 'quick' && game.phase !== 'summary' && !confirm(`Start this week's challenge? Your current ${game.settings.mode === 'daily' ? 'Daily Challenge' : 'Quick Draft'} (${game.settings.teamName}) will be abandoned.`)) return
    startGame(s)
  }
  return (
    <div className="panel row between wrap" style={{ marginBottom: 12 }} data-testid="weekly-card">
      <div>
        <b>This week's challenge</b>
        <div className="small muted">
          Everyone gets the same wheel all week: a <b>{s.formationId}</b> as <b>{u.clubById[s.hostClubId]?.name ?? s.hostClubId}</b>, {seasonLabel(s.leagueSeason)}. Your first finished run counts.
          {decision.source === 'missing_data' && ' This week’s ranked puzzle needs data this build does not have: reload.'}
        </div>
      </div>
      <button className="btn primary" onClick={play} data-testid="weekly-play">
        {underWay ? "Continue this week's challenge" : "Play this week's challenge"}
      </button>
    </div>
  )
}

/** The world leaderboard: today's Daily, this week's challenge, all-time Daily totals; a country filter on each. */
export function WorldBoard() {
  const go = useStore((s) => s.go)
  const configured = useOnline((s) => s.configured)
  const account = useOnline((s) => s.account)
  const [tab, setTab] = useState<Tab>('daily')
  const [country, setCountry] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [day, setDay] = useState(today)
  const thisWeek = weekKeyOf(new Date())
  const lastWeek = weekKeyOf(new Date((weekStartOf(thisWeek)?.getTime() ?? Date.now()) - DAY))
  const [week, setWeek] = useState(thisWeek)
  useEffect(() => {
    if (configured) void api.startOnline()
  }, [configured])
  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <h1>World leaderboard</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      {!api.onlineAvailable() ? (
        <div className="panel">
          <p className="muted">Online features are not available in this build. Your own results are on the Record page.</p>
        </div>
      ) : (
        <>
          <Tabs<Tab>
            tabs={[
              { id: 'daily', label: "Today's Daily" },
              { id: 'weekly', label: "This week's challenge" },
              { id: 'alltime', label: 'All-time Daily totals' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="row wrap" style={{ margin: '12px 0', gap: 8 }}>
            <div style={{ minWidth: 200 }}>
              <CountrySelect value={country} onChange={setCountry} emptyLabel="🌍 Everywhere" testId="board-country" />
            </div>
            {account?.country && account.country !== country && (
              <button className="btn sm ghost" onClick={() => setCountry(account.country)}>
                {countryFlag(account.country)} My country
              </button>
            )}
            {tab === 'daily' && (
              <input className="input" type="date" value={day} max={today} min={new Date(Date.now() - 60 * DAY).toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value || today)} style={{ width: 'auto' }} aria-label="Day" />
            )}
            {tab === 'weekly' && <Segmented value={week} onChange={setWeek} options={[{ value: thisWeek, label: 'This week' }, { value: lastWeek, label: 'Last week' }]} />}
          </div>
          {tab === 'daily' && <RankedTable kind="daily" boardKey={day} country={country} />}
          {tab === 'weekly' && (
            <>
              {weeklyIsOpen(thisWeek, new Date()) && week === thisWeek && <WeeklyPlay weekKey={thisWeek} />}
              <RankedTable kind="weekly" boardKey={week} country={country} />
            </>
          )}
          {tab === 'alltime' && <AlltimeTable country={country} />}
          <p className="help" style={{ marginTop: 14 }}>
            Every score here was replayed by the server from the picks, with the game's own engine: the replay is the official result. The seed is public, so a run can be rehearsed; each account posts once per day and per week, and the picks stay hidden until posting closes.
          </p>
        </>
      )}
    </div>
  )
}
