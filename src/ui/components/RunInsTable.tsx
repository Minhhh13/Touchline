import { useStore } from '@game/store'
import { RUN_IN_BRIEF_SHORT } from '@game/logic/runin'
import { ClubBadge } from './bits'
import { clubName, ordinal, seasonLabel } from '../format'

/** The Record page's Run-ins: newest first, the brief met or missed, and how the real club did. */
export function RunInsTable() {
  const u = useStore((s) => s.universe)
  const runs = useStore((s) => s.profile.runIns) ?? []
  return (
    <div className="panel" data-testid="runins">
      <h3>Run-ins</h3>
      {!runs.length && <div className="muted small">No run-ins yet. Take a job from Home: ten games to save a season.</div>}
      {!!runs.length && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Job</th>
              <th>Brief</th>
              <th className="num">Finish</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((e) => (
              <tr key={e.id}>
                {/* The job cell wraps, so on a phone the brief and the finish stay in view */}
                <td style={{ whiteSpace: 'normal' }}>
                  <span className="row wrap" style={{ gap: 6 }}>
                    <ClubBadge clubId={e.hostClubId} size={20} /> {clubName(u, e.hostClubId)} {seasonLabel(e.leagueSeason)}
                  </span>
                  <div className="small muted">
                    From {ordinal(e.from.position)} on {e.from.points} at MW {e.from.matchweek}
                    {e.real ? ` · really ${ordinal(e.real.position)} on ${e.real.points}` : ''} · seed {e.seed}
                  </div>
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  <span className={`chip ${e.met ? 'good' : 'bad'}`}>
                    {RUN_IN_BRIEF_SHORT[e.template]} {e.met ? '✓' : e.sacked ? '· sacked' : '✗'}
                  </span>
                </td>
                <td className="num">
                  {ordinal(e.position)} · {e.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
