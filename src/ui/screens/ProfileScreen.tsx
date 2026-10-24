import { useStore } from '@game/store'
import { ACHIEVEMENTS } from '@engine/awards'
import { TIER_LABEL } from '@engine/season'
import { ClubBadge, Segmented } from '../components/bits'
import { clubName, ordinal, seasonLabel } from '../format'

export function ProfileScreen() {
  const { profile, universe: u, go, setManagerName, setTheme } = useStore()
  const unlocked = Object.keys(profile.achievements).length
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
              {profile.leaderboard.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <ClubBadge clubId={e.hostClubId} size={20} /> {e.teamName}
                    </span>
                    <div className="small muted">{u ? clubName(u, e.hostClubId) : e.hostClubId}</div>
                  </td>
                  <td>{e.mode}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
