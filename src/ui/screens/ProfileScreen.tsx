import { useRef } from 'react'
import { useStore, SAVE_KEY } from '@game/store'
import { ACHIEVEMENTS } from '@engine/awards'
import { TIER_LABEL } from '@engine/season'
import type { LeaderboardEntry } from '@game/types'
import { MODE_TITLE } from '@game/logic/modes'
import { ClubBadge, Flag, Segmented } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'

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
            </div>
          </div>
          <div className="panel">
            <h3>Trophy cabinet</h3>
            <div className="row wrap" style={{ gap: 14 }}>
              {(
                [
                  ['🏆', 'League titles', profile.trophies?.league ?? 0],
                  ['🥇', 'Cups', profile.trophies?.cup ?? 0],
                  ['🌍', 'Continental Cups', profile.trophies?.continental ?? 0],
                  ['🏆🏆', 'Doubles', profile.trophies?.doubles ?? 0],
                  ['👑', 'Trebles', profile.trophies?.trebles ?? 0],
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
          <h3>Best seasons</h3>
          {profile.leaderboard.length === 0 && <div className="muted small">Nothing yet. Spin the wheel.</div>}
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
              {profile.leaderboard.map((e) => {
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
      </div>
    </div>
  )
}
