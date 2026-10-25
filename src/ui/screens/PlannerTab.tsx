import { ClipboardList, FileSignature, Stethoscope } from 'lucide-react'
import { useStore } from '@game/store'
import { surnameOf } from '@game/logic/talks'
import { contractsOverview, squadPlanner } from '@game/logic/planner'
import { medicalReport } from '@game/logic/medical'
import { STAFF } from '@engine/staff'
import { Info, Pos } from '../components/bits'
import { wage } from '../format'

const surname = surnameOf
const BAND_CHIP = { low: '', medium: 'warn', high: 'bad' } as const
const BAND_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const

/**
 * The Planner tab: depth and needs by position with who is next in, a
 * contracts overview, and the medical view. A view only; the numbers come from
 * `src/game/logic/planner.ts` and `medical.ts`.
 */
export function PlannerTab({ onPlayer }: { onPlayer: (id: string) => void }) {
  const { universe: u, game } = useStore()
  if (!u || !game) return null
  const rows = squadPlanner(game, u)
  const contracts = contractsOverview(game, u)
  const med = medicalReport(game, u)
  const used = rows.filter((r) => r.used)
  const spare = rows.filter((r) => !r.used)
  const needs = used.filter((r) => r.need).length
  return (
    <div className="grid three fill squad-views" data-testid="planner">
      <div className="panel" data-testid="squad-planner">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <ClipboardList size={18} aria-hidden="true" /> Squad planner
            </h3>
            <Info label="About the squad planner">Everyone who can play each position, rated there, best first. Next in is the best fit player outside the XI. A position needs a signing with fewer natural players than places plus one (two at least), all of them 30 or older, or all out of contract.</Info>
          </span>
          <span className={`chip ${needs ? 'warn' : 'good'}`}>{needs ? `${needs} need${needs === 1 ? 's' : ''}` : 'Covered'}</span>
        </div>
        <div className="plan-rows">
          {[...used, ...spare].map((r) => (
            <div key={r.position} className={`plan-row ${r.used ? '' : 'spare'}`} data-testid={`plan-${r.position}`}>
              <div className="row between" style={{ gap: 'var(--space-2)' }}>
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <Pos p={r.position} />
                  <span className="small muted">{r.naturals} natural · {r.depth.length} cover</span>
                </span>
                {r.need && <span className="chip warn">{r.need}</span>}
              </div>
              <div className="small plan-names">
                {r.depth.length === 0 && <span className="muted">Nobody</span>}
                {r.depth.slice(0, 5).map((d) => (
                  <button key={d.id} type="button" className={`chip ${d.inXI ? 'info' : ''} ${d.available ? '' : 'dim'}`} title={`${d.name}, ${d.age}${d.natural ? '' : ', can cover'}${d.available ? '' : ', unavailable'}`} onClick={() => onPlayer(d.id)}>
                    {surname(d.name)} {d.rating}
                    {d.age >= 30 ? <span className="muted"> · {d.age}</span> : null}
                  </button>
                ))}
              </div>
              {r.used && (
                <div className="small muted">
                  Next in: {r.next ? <b className="next-in">{r.next.name} ({r.next.rating})</b> : 'nobody fit'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="panel" data-testid="contracts-overview">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <FileSignature size={18} aria-hidden="true" /> Contracts
            </h3>
            <Info label="About contracts">Years include this season. Expiring players leave in the summer unless they renew (the renewal comes as a decision in the Inbox); loans go back. Change a status on the Club tab.</Info>
          </span>
          <span className="small muted">
            {contracts.expiring} expiring · {wage(contracts.wagesLeaving)} off
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="tbl contracts-overview">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Age</th>
                <th className="num">Yrs</th>
                <th className="num">Wage</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {contracts.rows.map((c) => (
                <tr key={c.id} className={c.expiring ? 'expiring' : ''}>
                  <td>
                    <button type="button" className="link-btn name" onClick={() => onPlayer(c.id)} title={c.name}>
                      {c.name}
                    </button>
                  </td>
                  <td className="num">{c.age}</td>
                  <td className="num">{c.loan ? <span className="chip">Loan</span> : c.declined ? <span className="chip bad">Out</span> : c.renewed ? <span className="chip good">New</span> : c.expiring ? <span className="chip warn" title="Last season of his contract">Last</span> : c.years}</td>
                  <td className="num">{wage(c.wage)}</td>
                  <td className="one-line">{c.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel" data-testid="medical">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <Stethoscope size={18} aria-hidden="true" /> Medical
            </h3>
            <Info label="About injury risk">The chance of an injury in a full match, from his proneness, his condition and, for an outfielder, low stamina on tired legs. Heavy minutes cost condition. Resting a tired man brings it down.</Info>
          </span>
          <span className="small muted">Physio: {STAFF.physio.tiers[med.physio].title}</span>
        </div>
        {med.out.length > 0 && (
          <div className="med-out">
            <div className="eyebrow">Injured</div>
            {med.out.map((o) => (
              <button key={o.id} type="button" className="room-row" onClick={() => onPlayer(o.id)}>
                <span className="who">
                  <b>{o.name}</b>
                  <span className="small muted">{o.description}</span>
                </span>
                <span className="chip bad">{o.weeksOut} wk</span>
              </button>
            ))}
          </div>
        )}
        <div className="eyebrow" style={{ marginTop: med.out.length ? 'var(--space-3)' : 0 }}>Risk next match</div>
        <div className="plist lined">
          {med.risks.map((r) => (
            <button key={r.id} type="button" className="room-row" onClick={() => onPlayer(r.id)} data-testid="risk-row">
              <span className="who">
                <b>{r.name}</b>
                <span className="small muted one-line">{r.reasons.length ? r.reasons.join(' · ') : 'Nothing to note'}</span>
              </span>
              <span className={`chip ${BAND_CHIP[r.band]}`} title={`${r.matchPct}% a match, ${r.trainingPct}% in training this week`}>
                {BAND_LABEL[r.band]} · {r.matchPct}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
