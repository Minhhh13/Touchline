import { useRef, type ReactNode } from 'react'
import { CalendarDays, Crown, Download, Flame, Globe, Lock, Medal, Trophy, Trash2, Upload } from 'lucide-react'
import { useStore, exportSaveJson, readSaveFile, storeImportedSave, wipeSave } from '@game/store'
import { ACHIEVEMENTS } from '@engine/awards'
import type { LeaderboardEntry } from '@game/types'
import { ClubBadge, Flag, Info, Segmented, Stat } from '../components/bits'
import { LeagueFlag } from '../components/Flag'
import { AchievementIcon } from '../components/icons'
import { clubName, ordinal, seasonLabel, tierName } from '../format'
import { modeLabel } from '../screenText'
import { TIP_IDS, tipsSeenCount } from '@game/logic/tips'
import { AccountLink } from '../online/AccountPanel'
import { emptyBests, recordLabel } from '@game/logic/perfect'

function exportSave(): void {
  // The game in memory, as plain JSON: it exports even when the browser's storage is full
  const blob = new Blob([exportSaveJson()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `touchline-save-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ProfileScreen() {
  const { profile, universe: u, go, setManagerName, setTheme, showToast, resetTips } = useStore()
  const tipsSeen = tipsSeenCount(profile)
  const bests = profile.quickBests ?? emptyBests()
  const unlocked = Object.keys(profile.achievements).length
  // Quick and Daily runs on the same wheel (seed) sit together: the table is already best-first, so a seed's first row
  // is its best. Season and Dynasty entries share one seed across their years, which is not the same wheel twice.
  const runsBySeed = new Map<string, LeaderboardEntry[]>()
  for (const e of profile.leaderboard) if (e.mode === 'quick' || e.mode === 'daily') runsBySeed.set(e.seed, [...(runsBySeed.get(e.seed) ?? []), e])
  const fileRef = useRef<HTMLInputElement>(null)
  const importSave = async (file: File) => {
    try {
      // Plain JSON from any build, or a compressed save; a file that is neither, or does not fit, leaves this save alone
      const save = readSaveFile(await file.text())
      if (!confirm('Replace everything in this browser with the imported save? This cannot be undone.')) return
      storeImportedSave(save)
      location.reload()
    } catch (e) {
      showToast(`Could not import: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const wipe = () => {
    if (!confirm('Delete every saved game, your record and achievements from this browser?')) return
    wipeSave()
    location.reload()
  }
  const trophies: Array<[ReactNode, string, number]> = [
    [<Trophy size={26} />, 'League titles', profile.trophies?.league ?? 0],
    [<Medal size={26} />, 'Cups', profile.trophies?.cup ?? 0],
    [<Globe size={26} />, 'Continental Cups', profile.trophies?.continental ?? 0],
    [<><Trophy size={22} /><Trophy size={22} /></>, 'Doubles', profile.trophies?.doubles ?? 0],
    [<Crown size={26} />, 'Trebles', profile.trophies?.trebles ?? 0],
  ]
  return (
    <div className="page">
      <div className="screen-head">
        <div className="screen-title">
          <h1>Profile</h1>
          <div className="screen-meta">
            <span>{profile.managerName ? `${profile.managerName}, manager` : 'Your record, trophies and settings'}</span>
          </div>
        </div>
        <button className="btn ghost" onClick={() => go('home')}>
          ← Home
        </button>
      </div>
      <div className="screen-body fill">
      <div className="grid two">
        <div className="col">
          <div className="panel col">
            <h3 style={{ margin: 0 }}>Manager</h3>
            <label className="field">
              Name
              <input className="input" value={profile.managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="The Gaffer" />
            </label>
            <div className="field">
              <span>
                Theme <Info label="About the theme">Auto follows your device's light or dark setting. The sun and moon in the top bar flips it too.</Info>
              </span>
              <Segmented value={profile.theme} onChange={setTheme} options={[{ value: 'auto', label: 'Auto', hint: "Follows your device's light or dark setting" }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </div>
            <div className="stat-strip profile-stats">
              <Stat label="Games" value={profile.gamesPlayed} />
              <Stat label="Seasons" value={profile.seasonsSimulated} />
              <Stat
                label="Daily streak"
                value={
                  <span className="icon-title">
                    <Flame size={20} className={profile.dailyStreak ? 'streak-on' : ''} aria-hidden="true" />
                    {profile.dailyStreak}
                  </span>
                }
              />
              <Stat label="Achievements" value={`${unlocked}/${ACHIEVEMENTS.length}`} />
            </div>
            <div className="toolbar">
              <button
                className="btn sm"
                data-testid="reset-tips"
                disabled={tipsSeen === 0}
                onClick={() => {
                  resetTips()
                  showToast('The coach marks will show again where they first appeared.')
                }}
              >
                Show tips again
              </button>
              <span className="small muted">
                {tipsSeen} of {TIP_IDS.length} tips dismissed
              </span>
            </div>
          </div>
          <div className="panel">
            <h3>Trophy cabinet</h3>
            <div className="cabinet">
              {trophies.map(([icon, label, n]) => (
                <div key={label} className={`cabinet-slot ${n ? '' : 'empty'}`}>
                  <span className="cabinet-icon">{icon}</span>
                  <span className="cabinet-n">{n}</span>
                  <span className="small muted">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" data-testid="quick-bests">
            <h3>The 38-0 chase</h3>
            <div className="kv">
              <dt>Best record</dt>
              <dd data-testid="best-record">{bests.bestRecord ? `${recordLabel(bests.bestRecord.won, bests.bestRecord.drawn, bests.bestRecord.lost)} · ${bests.bestRecord.points} pts` : '—'}</dd>
              <dt>Longest perfect run</dt>
              <dd data-testid="best-run">{bests.longestPerfectRun ? `${bests.longestPerfectRun}-0` : '—'}</dd>
              <dt>Perfect seasons</dt>
              <dd data-testid="perfect-seasons">{bests.perfectSeasons ?? 0}</dd>
            </div>
            <p className="help" style={{ margin: '8px 0 0' }}>Quick Draft and Daily seasons in this browser. The goal: win every game.</p>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Achievements</h3>
              <span className="small muted">
                {unlocked}/{ACHIEVEMENTS.length}
              </span>
            </div>
            <div className="achievements">
              {ACHIEVEMENTS.map((a) => {
                const date = profile.achievements[a.id]
                return (
                  <div key={a.id} className={`ach ${date ? '' : 'locked'}`}>
                    <span className="icon" aria-hidden="true">
                      <AchievementIcon id={a.id} />
                      {!date && (
                        <span className="ach-lock">
                          <Lock size={11} />
                        </span>
                      )}
                    </span>
                    <span>
                      <div className="title">{a.title}</div>
                      <div className="desc">{a.description}</div>
                      {date && (
                        <div className="ach-date">
                          <CalendarDays size={11} aria-hidden="true" /> {date}
                        </div>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="col">
          <AccountLink />
          <div className="panel col">
            <div className="panel-head" style={{ marginBottom: 0 }}>
              <span className="head-title">
                <h3>Save data</h3>
                <Info label="About save data">Everything lives in this browser. Export a file to back it up or move it to another device; import one to restore it.</Info>
              </span>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={exportSave}>
                <Download size={16} aria-hidden="true" /> Export save file
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden="true" /> Import save file
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSave(f); e.target.value = '' }} />
              <button className="btn ghost danger" onClick={wipe}>
                <Trash2 size={16} aria-hidden="true" /> Delete all data
              </button>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <h3>Best seasons</h3>
              {profile.leaderboard.length > 0 && <span className="small muted">{profile.leaderboard.length} run{profile.leaderboard.length === 1 ? '' : 's'}</span>}
            </div>
            {profile.leaderboard.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  <Trophy size={26} />
                </span>
                <h3>Nothing yet</h3>
                <p className="muted small">Spin the wheel; your best seasons land here.</p>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl best-tbl">
                  <thead>
                    <tr>
                      <th>Team</th>
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
                              <ClubBadge clubId={e.hostClubId} size={20} /> <b>{e.teamName}</b>
                              {e.nation && <Flag nation={e.nation} />}
                            </span>
                            <div className="small muted">
                              {u ? clubName(u, e.hostClubId) : e.hostClubId} · {u?.clubById[e.hostClubId] && <LeagueFlag leagueId={u.clubById[e.hostClubId].leagueId} label={u.leagues.find((l) => l.id === u.clubById[e.hostClubId].leagueId)?.name} />} {seasonLabel(e.leagueSeason)} · {modeLabel(e.mode)}
                            </div>
                            {(runs.length > 1 || e.challenge) && (
                              <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                                {runs.length > 1 && (rank === 1 ? <span className="chip gold" data-testid="best-on-wheel">Best on this wheel · {runs.length} runs</span> : <span className="chip">{ordinal(rank)} of {runs.length} on this wheel</span>)}
                                {e.challenge && <span className={`chip ${e.points > e.challenge.points ? 'good' : e.points < e.challenge.points ? 'bad' : ''}`}>vs {e.challenge.name} {e.challenge.points}</span>}
                              </div>
                            )}
                          </td>
                          <td className="num" style={{ fontWeight: 700 }}>
                            {e.points}
                          </td>
                          <td className="num">
                            {e.won}-{e.drawn}-{e.lost}
                          </td>
                          <td>
                            {tierName(e.tier, e.position)}
                            <div className="small muted">{ordinal(e.position)}</div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
