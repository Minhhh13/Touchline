import { useState } from 'react'
import { Handshake } from 'lucide-react'
import { useStore } from '@game/store'
import { AGENT_MOOD_HELP, AGENT_MOOD_LABEL, agentView, evaluateOffer, openingOffer, talksClosedUntil, type ContractOffer, type Stance, type TermKey } from '@game/logic/contracts'
import { playerLookup } from '@game/logic/players'
import { STATUSES, type SquadStatus } from '@engine/status'
import { Bar, Info } from './bits'
import { wage } from '../format'
import { translator } from '../i18n'
import { dugout } from '../i18n/en/dugout'
import { statusLabel, statusLower } from '../i18n/engineText'
import { logicLine } from '../i18n/logicText'

const t = translator(dugout)
const TERMS: TermKey[] = ['wage', 'years', 'signingFee', 'release', 'appearance', 'goal']
const STANCE_CHIP: Record<Stance, string> = { negotiable: '', locked: 'warn', excluded: 'bad' }
const MOOD_CHIP = { greedy: 'warn', fair: '', loyal: 'good' } as const

/**
 * Contract talks with one squad player: the offer on the left, his demands and
 * how close the offer comes on the right. Every number comes from
 * `src/game/logic/contracts.ts`; the screen only edits the offer and sends it.
 */
export function ContractTalks({ id, onBack }: { id: string; onBack: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [offer, setOffer] = useState<ContractOffer | null>(() => (u && game ? openingOffer(game, u, id) : null))
  const [msg, setMsg] = useState<string | null>(null)
  if (!u || !game || !offer) return null
  const p = playerLookup(game, u)(id)
  const verdict = evaluateOffer(game, u, id, offer)
  if (!p || !verdict) return null
  const d = verdict.demand
  const closed = talksClosedUntil(game, u, id)
  const fails = game.negotiations?.[p.playerId]?.fails ?? 0
  const set = (patch: Partial<ContractOffer>) => setOffer({ ...offer, ...patch })
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v)))
  const pct = Math.min(100, Math.round((verdict.score / Math.max(1, d.wage)) * 100))
  return (
    <div className="talks" data-testid="contract-talks">
      <div className="grid two talks-grid">
        <div className="card">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <b>{t('yourOffer')}</b>
            <span className="small muted">{t('nowLeft', { w: wage(p.wage), n: game.contracts[id]?.years ?? 1 })}</span>
          </div>
          <div className="talks-form">
            <label className="field">
              {t('wageField')}
              <input className="input sm" type="number" min={1} step={1} value={offer.wage} onChange={(e) => set({ wage: num(e.target.value) })} data-testid="offer-wage" />
            </label>
            <label className="field">
              {t('seasonsField')}
              <select className="input sm" value={offer.years} onChange={(e) => set({ years: Number(e.target.value) })} data-testid="offer-years">
                {Array.from({ length: d.maxYears }, (_, i) => i + 1).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('statusField')}
              <select className="input sm" value={offer.status} onChange={(e) => set({ status: e.target.value as SquadStatus })}>
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {statusLabel(st)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t('feeField')}
              <input className="input sm" type="number" min={0} step={0.5} value={offer.signingFee} onChange={(e) => set({ signingFee: num(e.target.value) })} data-testid="offer-fee" />
            </label>
            <label className="field">
              {t('releaseField')}
              <input className="input sm" type="number" min={0} step={1} placeholder={t('noneField')} disabled={d.stances.release === 'excluded'} value={offer.release ?? ''} onChange={(e) => set({ release: e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value) })} data-testid="offer-release" />
            </label>
            <label className="field">
              {t('perApp')}
              <input className="input sm" type="number" min={0} step={1} value={offer.appearance} onChange={(e) => set({ appearance: num(e.target.value) })} data-testid="offer-appearance" />
            </label>
            <label className="field">
              {t('perGoal')}
              <input className="input sm" type="number" min={0} step={1} value={offer.goal} onChange={(e) => set({ goal: num(e.target.value) })} />
            </label>
          </div>
        </div>
        <div className="card">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <span className="head-title">
              <b>{t('hisDemands')}</b>
              <Info label={t('aboutContractTalks')}>{t('contractTalksInfo')}</Info>
            </span>
            <span className={`chip ${MOOD_CHIP[d.mood]}`} title={AGENT_MOOD_HELP[d.mood]} data-testid="agent-mood">
              {t('agentMood', { mood: AGENT_MOOD_LABEL[d.mood] })}
            </span>
          </div>
          <dl className="kv tight" style={{ marginTop: 'var(--space-2)' }}>
            <dt>{t('heAsks')}</dt>
            <dd data-testid="ask-wage">
              {t('asksAs', { w: wage(d.wage), status: statusLower(offer.status) })}
            </dd>
            {d.wageFloor !== undefined && (
              <>
                <dt>{t('wageFloor')}</dt>
                <dd>{wage(d.wageFloor)}</dd>
              </>
            )}
            <dt>{t('length')}</dt>
            <dd>{t('lengthRange', { n: d.maxYears })}</dd>
          </dl>
          <div className="row wrap" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
            {TERMS.map((k) => (
              <span key={k} className={`chip ${STANCE_CHIP[d.stances[k]]}`} title={t('stanceTip', { term: t(`term_${k}`), stance: t(`stance_${d.stances[k]}`).toLowerCase() })}>
                {t('stanceChip', { term: t(`term_${k}`), stance: t(`stance_${d.stances[k]}`) })}
              </span>
            ))}
          </div>
          {d.why.length > 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{sentence(d.why.join('; '))}</div>}
          <div className="meter-row" style={{ marginTop: 'var(--space-3)' }} data-testid="offer-meter">
            <span className="small">{t('offerWorth')}</span>
            <Bar value={pct} colour={verdict.accepted ? 'var(--good)' : pct >= 90 ? 'var(--meter-mid)' : 'var(--bad)'} />
            <span className="mono small">{wage(verdict.score)}</span>
          </div>
          <div className={`small ${verdict.accepted ? 'good-text' : 'muted'}`} style={{ marginTop: 'var(--space-1)' }}>
            {verdict.accepted ? t('wouldSign') : verdict.reasons[0]}
          </div>
        </div>
      </div>
      {msg && <div className="notice" style={{ marginTop: 'var(--space-3)' }}>{msg}</div>}
      <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
        {fails > 0 && closed === null && <span className="small muted">{t('turnedDown', { n: fails })}</span>}
        <button className="btn ghost sm" onClick={onBack}>
          {t('back')}
        </button>
        <button
          className="btn primary sm"
          data-testid="offer-contract"
          disabled={closed !== null}
          title={closed !== null ? t('reopenAfter', { week: closed }) : undefined}
          onClick={() => {
            const out = store.proposeContract(id, offer)
            setMsg(out.message)
            if (out.accepted) {
              const next = openingOffer(useStore.getState().game!, u, id)
              if (next) setOffer(next)
            }
          }}
        >
          <Handshake size={14} aria-hidden="true" /> {t('offerContract')}
        </button>
      </div>
    </div>
  )
}

/** The player modal's Contract card: his terms, his agent, the talks and the agent's search for a buyer. */
export function ContractCard({ id, onTalks }: { id: string; onTalks: () => void }) {
  const store = useStore()
  const { universe: u, game } = store
  const [msg, setMsg] = useState<string | null>(null)
  if (!u || !game) return null
  const c = game.contracts[id]
  const view = agentView(game, u, id)
  if (!c || !view) return null
  const closed = talksClosedUntil(game, u, id)
  const clauses = c.clauses
  const terms = [clauses?.release ? t('termRelease', { m: clauses.release }) : '', clauses?.appearance ? t('termApp', { k: clauses.appearance }) : '', clauses?.goal ? t('termGoal', { k: clauses.goal }) : '', c.sellOn ? t('termSellOn', { pct: Math.round(c.sellOn.pct * 100) }) : ''].filter(Boolean)
  return (
    <div className="card" data-testid="contract-card">
      <div className="row between wrap" style={{ gap: 'var(--space-2)' }}>
        <span className="head-title">
          <b>{t('contract')}</b>
          <Info label={t('aboutAgents')}>{t('agentsInfo', { help: AGENT_MOOD_HELP[view.mood] })}</Info>
        </span>
        <span className={`chip ${MOOD_CHIP[view.mood]}`}>{t('agentMood', { mood: AGENT_MOOD_LABEL[view.mood] })}</span>
      </div>
      <div className="small" style={{ marginTop: 'var(--space-2)' }}>
        {c.loan ? t('onLoan') : t('seasonsLeft', { n: c.years, terms: terms.length ? ` · ${terms.join(' · ')}` : '' })}
      </div>
      {!c.loan && <div className="small muted">{logicLine(view.why)}</div>}
      {msg && <div className="notice" style={{ marginTop: 'var(--space-2)' }}>{msg}</div>}
      {!c.loan && (
        <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button className="btn sm" data-testid="open-talks" onClick={onTalks} disabled={closed !== null} title={closed !== null ? t('reopenAfter', { week: closed }) : t('newTerms')}>
            {closed !== null ? t('talksClosed', { week: closed }) : t('contractTalks')}
          </button>
          <button className={`btn sm ${view.shopped ? 'primary' : ''}`} aria-pressed={view.shopped} data-testid="find-buyer" onClick={() => setMsg(store.setShopped(id, !view.shopped).message)}>
            {t(view.shopped ? 'stopShopping' : 'findBuyer')}
          </button>
        </div>
      )}
    </div>
  )
}

/** The demand's reasons are clauses ('at 31 or over he asks 10% less; happy here: 5% less'): one sentence, capitalised. */
function sentence(clauses: string): string {
  return `${clauses.charAt(0).toUpperCase()}${clauses.slice(1)}.`
}
