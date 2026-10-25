import { useEffect, useRef, useState } from 'react'
import { useStore, SAVE_KEY } from '@game/store'
import { ACHIEVEMENTS } from '@engine/awards'
import { TIER_LABEL } from '@engine/season'
import { badgeStates, topBadges } from '@engine/badges'
import { fetchClubLeagues } from '@engine/universe'
import type { LeaderboardEntry } from '@game/types'
import { MODE_TITLE, arenaFormatLabel } from '@game/logic/modes'
import { arenaClubName } from '@game/logic/arena'
import { ARENA_TIER_LABEL } from '@engine/knockout'
import { BOARD_FILTERS, filterBoard, leaguesWon, normaliseCabinet, type BoardFilter } from '@game/logic/cabinet'
import { ClubBadge, Flag, Segmented } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'
import { downloadDataUrl, renderManagerCard } from '../shareCard'

const FILTER_KEY = 'touchline-record-filter'

function readFilter(): BoardFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    return BOARD_FILTERS.some((f) => f.value === v) ? (v as BoardFilter) : 'all'
  } catch {
    return 'all'
  }
}

function exportSave(): void {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) return
  const blob = new Blob([raw], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `touchline-save-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProfileScreen() {
  const { profile, universe: u, go, setManagerName, setTheme, showToast } = useStore()
  const unlocked = Object.keys(profile.achievements).length
  // Quick and Daily runs on the same wheel (seed) sit together: the table is already best-first, so a seed's first row
  // is its best. Season and Dynasty entries share one seed across their years, which is not the same wheel twice.
  const runsBySeed = new Map<string, LeaderboardEntry[]>()
  for (const e of profile.leaderboard) if (e.mode === 'quick' || e.mode === 'daily') runsBySeed.set(e.seed, [...(runsBySeed.get(e.seed) ?? []), e])
  const fileRef = useRef<HTMLInputElement>(null)
  // Trophy Room: leagues won in come from the titled hosts' leagues, the loaded clubs first, then the packs' club lists
  const cabinet = normaliseCabinet(profile.cabinet ?? {})
  const [clubLeagues, setClubLeagues] = useState<Record<string, { leagueId: string; name: string }> | null>(null)
  const won = leaguesWon(cabinet, profile.leaderboard, (id) => u?.clubById[id]?.leagueId ?? clubLeagues?.[id]?.leagueId)
  const needsClubLeagues = won.unresolved.length > 0 && !clubLeagues
  useEffect(() => {
    if (!needsClubLeagues) return
    let live = true
    fetchClubLeagues()
      .then((m) => live && setClubLeagues(m))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [needsClubLeagues])
  const badges = badgeStates(cabinet, { leaguesWon: won.leagues.length })
  const [filter, setFilterState] = useState<BoardFilter>(readFilter)
  const setFilter = (f: BoardFilter) => {
    setFilterState(f)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      // A per-viewer convenience: without storage the filter just resets next visit
    }
  }
  const board = filterBoard(profile.leaderboard, filter)
  const downloadCard = () => {
    const best = profile.leaderboard.slice(0, 3).map((e) => ({
      title: `${e.teamName} · ${e.points} pts · ${ordinal(e.position)}`,
      detail: `${TIER_LABEL[e.tier]} · ${u?.clubById[e.hostClubId] ? clubName(u, e.hostClubId) : (clubLeagues?.[e.hostClubId]?.name ?? e.hostClubId)} ${seasonLabel(e.leagueSeason)} · ${MODE_TITLE[e.mode] ?? e.mode}`,
    }))
    const url = renderManagerCard({ name: profile.managerName.trim() || 'The Gaffer', seasons: profile.seasonsSimulated, cabinet, badges: topBadges(badges), best, dataStamp: u ? `Data ${u.generatedAt}` : 'Trophy Room' })
    downloadDataUrl(url, 'touchline-manager-card.png')
  }
  const importSave = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { state?: { profile?: unknown } }
      if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') throw new Error('not a Touchline save')
      if (!confirm('Replace everything in this browser with the imported save? This cannot be undone.')) return
      localStorage.setItem(SAVE_KEY, text)
      location.reload()
    } catch (e) {
      showToast(`Could not import: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const wipe = () => {
    if (!confirm('Delete every saved game, your record and achievements from this browser?')) return
    localStorage.removeItem(SAVE_KEY)
    location.reload()
  }
  return (
    <div className="page">
      <div className="row between wrap" style={{ marginBottom: 10 }}>
        <h1>Your record</h1>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="grid two">
        <div className="col">
          <div className="panel col">
            <h3>Manager</h3>
            <label className="field">
              Name
              <input className="input" value={profile.managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="The Gaffer" />
            </label>
            <div className="field">
              Theme
              <Segmented value={profile.theme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto' }, { value: 'dark', label: 'Floodlit' }, { value: 'light', label: 'Daylight' }]} />
            </div>
            <div className="kv">
              <dt>Games started</dt>
              <dd>{profile.gamesPlayed}</dd>
              <dt>Seasons simulated</dt>
              <dd>{profile.seasonsSimulated}</dd>
              <dt>Daily streak</dt>
              <dd>{profile.dailyStreak}</dd>
              <dt>Achievements</dt>
              <dd>
                {unlocked} / {ACHIEVEMENTS.length}
              </dd>
              <dt>Head-to-head seasons</dt>
              <dd>{cabinet.h2h.played}</dd>
            </div>
          </div>
          <div className="panel" data-testid="trophy-cabinet">
            <h3>Trophy cabinet</h3>
            <div className="row wrap" style={{ gap: 14 }}>
              {(
                [
                  ['🏆', 'League titles', cabinet.league],
                  ['🥇', 'Cups', cabinet.cup],
                  ['🌍', 'Continental Cups', cabinet.continental],
                  ['🏆🏆', 'Doubles', cabinet.doubles],
                  ['👑', 'Trebles', cabinet.trebles],
                  ['💎', '38-0s', cabinet.perfect],
                  ['🛡️', 'Invincibles', cabinet.invincible],
                  ['💯', 'Centurions', cabinet.centurions],
                  // The arena's own shelf: never in the league and cup totals
                  ['🏟️', 'Arena cups', cabinet.cups.won],
                ] as const
              ).map(([icon, label, n]) => (
                <div key={label} className="col" style={{ alignItems: 'center', minWidth: 90, opacity: n ? 1 : 0.45 }}>
                  <span style={{ fontSize: 26 }}>{icon}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>{n}</span>
                  <span className="small muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel col" data-testid="trophy-room">
            <div className="row between wrap">
              <h3>Trophy Room</h3>
              <button className="btn sm" data-testid="manager-card" onClick={downloadCard}>
                Download manager card
              </button>
            </div>
            <div className="badges">
              {badges.map((b) => (
                <div key={b.badge.id} className={`badge-tile ${b.value ? '' : 'locked'}`} data-testid="badge" data-tier={b.tier ?? 'none'} title={`${b.badge.title}: ${b.value} ${b.badge.counts}`}>
                  <span className={`badge-ring ${b.tier ?? ''}`}>{b.badge.icon}</span>
                  <span>
                    <div className="title">{b.badge.title}</div>
                    <div className="desc">
                      {b.value} {b.badge.counts}
                    </div>
                    <div className="small muted">{b.tier ? `${b.tier[0].toUpperCase()}${b.tier.slice(1)} · ${b.progress}` : b.progress}</div>
                  </span>
                </div>
              ))}
            </div>
            {won.leagues.length > 0 && <div className="small muted" data-testid="leagues-won">Leagues won in: {won.leagues.map((id) => u?.available.find((l) => l.id === id)?.name ?? id).join(', ')}</div>}
            {cabinet.rebuilt && <div className="small muted" data-testid="cabinet-rebuilt">Badges beyond the five trophy counts are counted from your 50 best seasons before the Trophy Room.</div>}
          </div>
          <div className="panel">
            <h3>Achievements</h3>
            <div className="achievements">
              {ACHIEVEMENTS.map((a) => {
                const date = profile.achievements[a.id]
                return (
                  <div key={a.id} className={`ach ${date ? '' : 'locked'}`}>
                    <span className="icon">{a.icon}</span>
                    <span>
                      <div className="title">{a.title}</div>
                      <div className="desc">{a.description}</div>
                      {date && <div className="small muted">{date}</div>}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="panel col">
          <h3>Save data</h3>
          <p className="help">Everything lives in this browser. Export a file to back it up or move it to another device, import one to restore it.</p>
          <div className="row wrap">
            <button className="btn" onClick={exportSave}>
              Export save file
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import save file
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = '' }} />
            <button className="btn ghost danger" onClick={wipe}>
              Delete all data
            </button>
          </div>
        </div>
        <div className="panel">
          <div className="row between wrap" style={{ marginBottom: 8 }}>
            <h3>Best seasons</h3>
            <span data-testid="board-filter">
              <Segmented value={filter} onChange={setFilter} options={[...BOARD_FILTERS]} />
            </span>
          </div>
          {profile.leaderboard.length === 0 && <div className="muted small">Nothing yet. Spin the wheel.</div>}
          {profile.leaderboard.length > 0 && board.length === 0 && <div className="muted small">No {BOARD_FILTERS.find((f) => f.value === filter)?.label} seasons yet.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Team</th>
                <th>Mode</th>
                <th>League</th>
                <th className="num">Pts</th>
                <th className="num">W-D-L</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {board.map((e) => {
                const runs = runsBySeed.get(e.seed) ?? [e]
                const rank = runs.indexOf(e) + 1
                return (
                <tr key={e.id}>
                  <td>
                    <span className="row wrap" style={{ gap: 6 }}>
                      <ClubBadge clubId={e.hostClubId} size={20} /> {e.teamName}
                      {e.nation && <Flag nation={e.nation} />}
                      {runs.length > 1 && (rank === 1 ? <span className="chip gold" data-testid="best-on-wheel">Best on this wheel · {runs.length} runs</span> : <span className="chip">{ordinal(rank)} of {runs.length} on this wheel</span>)}
                      {e.challenge && <span className={`chip ${e.points > e.challenge.points ? 'good' : e.points < e.challenge.points ? 'bad' : ''}`}>vs {e.challenge.name} {e.challenge.points}</span>}
                    </span>
                    <div className="small muted">{u ? clubName(u, e.hostClubId) : e.hostClubId}</div>
                    {e.moment && <div className="small muted" data-testid="entry-moment">{e.moment}</div>}
                  </td>
                  <td>{MODE_TITLE[e.mode] ?? e.mode}</td>
                  <td>{seasonLabel(e.leagueSeason)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {e.points}
                  </td>
                  <td className="num">
                    {e.won}-{e.drawn}-{e.lost}
                  </td>
                  <td>
                    {TIER_LABEL[e.tier]} · {ordinal(e.position)}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="panel" data-testid="best-runs">
          <h3>Best runs</h3>
          {!profile.arenaRuns?.length && <div className="muted small">No arena runs yet. Try the Cup Final from Home.</div>}
          {!!profile.arenaRuns?.length && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Format</th>
                  <th>Result</th>
                  <th className="num">GF-GA</th>
                </tr>
              </thead>
              <tbody>
                {profile.arenaRuns.map((e) => (
                  <tr key={e.id}>
                    {/* The team cell wraps, so on a phone the format, result and score stay in view */}
                    <td style={{ whiteSpace: 'normal' }}>
                      <span className="row wrap" style={{ gap: 6 }}>
                        {e.hostClubId && <ClubBadge clubId={e.hostClubId} size={20} />} {e.teamName}
                      </span>
                      <div className="small muted">
                        {e.last && u ? `${e.fellTo ? 'Lost to' : 'Beat'} ${arenaClubName(u, e.last)}` : e.date} · seed {e.seed}
                      </div>
                    </td>
                    <td>{arenaFormatLabel(e)}</td>
                    <td>{ARENA_TIER_LABEL[e.tier]}</td>
                    <td className="num">
                      {e.goalsFor}-{e.goalsAgainst}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
