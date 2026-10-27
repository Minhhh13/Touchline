import { useStore } from '@game/store'
import { RUN_IN_BRIEF_SHORT } from '@game/logic/runin'
import { ClubBadge } from './bits'
import { clubName, ordinal, seasonLabel } from '../format'
import { translator } from '../i18n'
import { runin } from '../i18n/en/runin'

const t = translator(runin)

/** The Record page's Run-ins: newest first, the brief met or missed, and how the real club did. */
export function RunInsTable() {
  const u = useStore((s) => s.universe)
  const runs = useStore((s) => s.profile.runIns) ?? []
  return (
    <div className="panel" data-testid="runins">
      <h3>{t('runIns')}</h3>
      {!runs.length && <div className="muted small">{t('noRunIns')}</div>}
      {!!runs.length && (
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('colJob')}</th>
              <th>{t('colBrief')}</th>
              <th className="num">{t('colFinish')}</th>
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
                    {t('fromLine', { pos: e.from.position, pts: e.from.points, week: e.from.matchweek })}
                    {e.real ? t('reallyLine', { pos: e.real.position, pts: e.real.points }) : ''}{t('seedLine', { seed: e.seed })}
                  </div>
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  <span className={`chip ${e.met ? 'good' : 'bad'}`}>
                    {RUN_IN_BRIEF_SHORT[e.template]} {e.met ? '✓' : e.sacked ? t('sacked') : '✗'}
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
