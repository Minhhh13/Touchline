import { ClipboardList, FileSignature, Stethoscope } from 'lucide-react'
import { useStorePick } from '../useStorePick'
import { askConfirm } from '../confirm'
import type { Boxes } from '../components/Boxes'
import { surnameOf } from '@game/logic/talks'
import { contractsOverview, squadPlanner } from '@game/logic/planner'
import { medicalReport } from '@game/logic/medical'
import { STAFF } from '@engine/staff'
import { Info, Pos } from '../components/bits'
import { wage } from '../format'
import { translator } from '../i18n'
import { rich } from '../i18n/rich'
import { dugout } from '../i18n/en/dugout'

const t = translator(dugout)

const surname = surnameOf
const BAND_CHIP = { low: '', medium: 'warn', high: 'bad' } as const

/**
 * The Planner tab: depth and needs by position with who is next in, a
 * contracts overview, and the medical view. A view only; the numbers come from
 * `src/game/logic/planner.ts` and `medical.ts`.
 */
/** `boxes` is the Dugout's Boxes control for this tab: an unticked box is left out and the others widen. */
export function PlannerTab({ onPlayer, boxes }: { onPlayer: (id: string) => void; boxes?: Boxes }) {
  const { universe: u, game, letContractGo, showToast } = useStorePick('universe', 'game', 'letContractGo', 'showToast')
  if (!u || !game) return null
  const rows = squadPlanner(game, u)
  const contracts = contractsOverview(game, u)
  const med = medicalReport(game, u)
  const used = rows.filter((r) => r.used)
  const spare = rows.filter((r) => !r.used)
  const needs = used.filter((r) => r.need).length
  const on = (id: string) => boxes?.on(id) ?? true
  const grid = boxes?.grid([{ track: 'minmax(0, 1fr)', ids: ['squad-planner'] }, { track: 'minmax(0, 1fr)', ids: ['contracts'] }, { track: 'minmax(0, 1fr)', ids: ['medical'] }]) ?? { className: '', style: undefined }
  return (
    <div className={`grid three fill squad-views ${grid.className}`} style={grid.style} data-testid="planner">
      {on('squad-planner') && (
      <div className="panel" data-testid="squad-planner">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <ClipboardList size={18} aria-hidden="true" /> {t('squadPlanner')}
            </h3>
            <Info label={t('aboutPlanner')}>{t('plannerInfo')}</Info>
          </span>
          <span className={`chip ${needs ? 'warn' : 'good'}`}>{needs ? t('needs', { n: needs }) : t('covered')}</span>
        </div>
        <div className="plan-rows">
          {[...used, ...spare].map((r) => (
            <div key={r.position} className={`plan-row ${r.used ? '' : 'spare'}`} data-testid={`plan-${r.position}`}>
              <div className="row between" style={{ gap: 'var(--space-2)' }}>
                <span className="row" style={{ gap: 'var(--space-2)' }}>
                  <Pos p={r.position} />
                  <span className="small muted">{t('naturalCover', { naturals: r.naturals, cover: r.depth.length })}</span>
                </span>
                {r.need && <span className="chip warn">{r.need}</span>}
              </div>
              <div className="small plan-names">
                {r.depth.length === 0 && <span className="muted">{t('nobody')}</span>}
                {r.depth.slice(0, 5).map((d) => (
                  <button key={d.id} type="button" className={`chip ${d.inXI ? 'info' : ''} ${d.available ? '' : 'dim'}`} title={t('depthTip', { name: d.name, age: d.age, cover: d.natural ? '' : t('canCoverSuffix'), unavailable: d.available ? '' : t('unavailableSuffix') })} onClick={() => onPlayer(d.id)}>
                    {surname(d.name)} {d.rating}
                    {d.age >= 30 ? <span className="muted">{t('ageY', { age: d.age })}</span> : null}
                  </button>
                ))}
              </div>
              {r.used && (
                <div className="small muted">
                  {r.next ? rich(t('nextIn', { who: t('nextInWho', { name: r.next.name, rating: r.next.rating }) }), { b: (c) => <b className="next-in">{c}</b> }) : t('nextInNobody')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
      {on('contracts') && (
      <div className="panel" data-testid="contracts-overview">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <FileSignature size={18} aria-hidden="true" /> {t('contracts')}
            </h3>
            <Info label={t('aboutContracts')}>{t('contractsInfo')}</Info>
          </span>
          <span className="small muted">
            {t('expiringOff', { n: contracts.expiring, w: wage(contracts.wagesLeaving) })}
          </span>
        </div>
        {contracts.rows.some((c) => c.outOfContract) && (
          <div className="med-out" data-testid="renewal-list">
            <div className="eyebrow">{t('renewalHead')}</div>
            {contracts.rows
              .filter((c) => c.outOfContract)
              .map((c) => (
                <div key={c.id} className="room-row" data-testid="renewal-row">
                  <span className="who">
                    <b>{c.name}</b>
                    <span className="small muted">
                      {c.age} · {c.position} · {wage(c.wage)}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 'var(--space-2)' }}>
                    <button type="button" className="btn sm" data-testid="renewal-talk" onClick={() => onPlayer(c.id)}>
                      {t('offerTerms')}
                    </button>
                    <button type="button" className="btn sm ghost" data-testid="renewal-release" onClick={() => void askConfirm(t('letGoConfirm', { name: c.name }), { ok: t('letGo'), danger: true }).then((ok) => { if (ok) showToast(letContractGo(c.id).message) })}>
                      {t('letGo')}
                    </button>
                  </span>
                </div>
              ))}
          </div>
        )}
        <div className="tbl-wrap">
          <table className="tbl contracts-overview">
            <thead>
              <tr>
                <th>{t('player')}</th>
                <th className="num">{t('age')}</th>
                <th className="num">{t('yrs')}</th>
                <th className="num">{t('wageCol')}</th>
                <th>{t('role')}</th>
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
                  <td className="num">{c.outOfContract ? <span className="chip warn" title={t('talksTip')}>{t('talks')}</span> : c.loan ? <span className="chip">{t('loan')}</span> : c.declined ? <span className="chip bad">{t('out')}</span> : c.renewed ? <span className="chip good">{t('newChip')}</span> : c.expiring ? <span className="chip warn" title={t('lastTip')}>{t('last')}</span> : c.years}</td>
                  <td className="num">{wage(c.wage)}</td>
                  <td className="one-line">{c.statusLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
      {on('medical') && (
      <div className="panel" data-testid="medical">
        <div className="panel-head">
          <span className="head-title">
            <h3 className="icon-title">
              <Stethoscope size={18} aria-hidden="true" /> {t('medical')}
            </h3>
            <Info label={t('aboutInjury')}>{t('injuryInfo')}</Info>
          </span>
          <span className="small muted">{t('physio', { title: STAFF.physio.tiers[med.physio].title })}</span>
        </div>
        {med.out.length > 0 && (
          <div className="med-out">
            <div className="eyebrow">{t('injured')}</div>
            {med.out.map((o) => (
              <button key={o.id} type="button" className="room-row" onClick={() => onPlayer(o.id)}>
                <span className="who">
                  <b>{o.name}</b>
                  <span className="small muted">{o.description}</span>
                </span>
                <span className="chip bad">{t('wk', { n: o.weeksOut })}</span>
              </button>
            ))}
          </div>
        )}
        <div className="eyebrow" style={{ marginTop: med.out.length ? 'var(--space-3)' : 0 }}>{t('riskNext')}</div>
        <div className="plist lined">
          {med.risks.map((r) => (
            <button key={r.id} type="button" className="room-row" onClick={() => onPlayer(r.id)} data-testid="risk-row">
              <span className="who">
                <b>{r.name}</b>
                <span className="small muted one-line">{r.reasons.length ? r.reasons.join(' · ') : t('nothingToNote')}</span>
              </span>
              <span className={`chip ${BAND_CHIP[r.band]}`} title={t('riskTip', { match: r.matchPct, training: r.trainingPct })}>
                {t('bandPct', { band: t(`band_${r.band}`), pct: r.matchPct })}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
