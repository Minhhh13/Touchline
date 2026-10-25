import { useState } from 'react'
import { Handshake } from 'lucide-react'
import { useStore } from '@game/store'
import { AGENT_MOOD_HELP, AGENT_MOOD_LABEL, agentView, evaluateOffer, openingOffer, talksClosedUntil, type ContractOffer, type Stance, type TermKey } from '@game/logic/contracts'
import { playerLookup } from '@game/logic/players'
import { STATUS_LABEL, STATUSES, type SquadStatus } from '@engine/status'
import { Bar, Info } from './bits'
import { wage } from '../format'

const TERM_LABEL: Record<TermKey, string> = { wage: 'Wage', years: 'Length', signingFee: 'Signing fee', release: 'Release clause', appearance: 'Appearance bonus', goal: 'Goal bonus' }
const STANCE_CHIP: Record<Stance, string> = { negotiable: '', locked: 'warn', excluded: 'bad' }
const STANCE_LABEL: Record<Stance, string> = { negotiable: 'Open', locked: 'Locked', excluded: 'Off the table' }
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
            <b>Your offer</b>
            <span className="small muted">Now {wage(p.wage)} · {game.contracts[id]?.years ?? 1} season{(game.contracts[id]?.years ?? 1) === 1 ? '' : 's'} left</span>
          </div>
          <div className="talks-form">
            <label className="field">
              Wage £k/wk
              <input className="input sm" type="number" min={1} step={1} value={offer.wage} onChange={(e) => set({ wage: num(e.target.value) })} data-testid="offer-wage" />
            </label>
            <label className="field">
              Seasons
              <select className="input sm" value={offer.years} onChange={(e) => set({ years: Number(e.target.value) })} data-testid="offer-years">
                {Array.from({ length: d.maxYears }, (_, i) => i + 1).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select className="input sm" value={offer.status} onChange={(e) => set({ status: e.target.value as SquadStatus })}>
                {STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Signing fee £M
              <input className="input sm" type="number" min={0} step={0.5} value={offer.signingFee} onChange={(e) => set({ signingFee: num(e.target.value) })} data-testid="offer-fee" />
            </label>
            <label className="field">
              Release clause £M
              <input className="input sm" type="number" min={0} step={1} placeholder="None" disabled={d.stances.release === 'excluded'} value={offer.release ?? ''} onChange={(e) => set({ release: e.target.value === '' || Number(e.target.value) <= 0 ? undefined : Number(e.target.value) })} data-testid="offer-release" />
            </label>
            <label className="field">
              Per appearance £k
              <input className="input sm" type="number" min={0} step={1} value={offer.appearance} onChange={(e) => set({ appearance: num(e.target.value) })} data-testid="offer-appearance" />
            </label>
            <label className="field">
              Per goal £k
              <input className="input sm" type="number" min={0} step={1} value={offer.goal} onChange={(e) => set({ goal: num(e.target.value) })} />
            </label>
          </div>
        </div>
        <div className="card">
          <div className="row between" style={{ gap: 'var(--space-2)' }}>
            <span className="head-title">
              <b>His demands</b>
              <Info label="About contract talks">The offer is weighed in pounds a week: the wage, a signing fee spread over the contract, bonuses at the football his status expects, a release clause he could leave on, and for a player of 30 or more the security of a long deal. It is accepted when it reaches his ask and every locked term is met. A turned-down offer costs 5 morale; three end talks for four weeks.</Info>
            </span>
            <span className={`chip ${MOOD_CHIP[d.mood]}`} title={AGENT_MOOD_HELP[d.mood]} data-testid="agent-mood">
              {AGENT_MOOD_LABEL[d.mood]} agent
            </span>
          </div>
          <div className="kv tight" style={{ marginTop: 'var(--space-2)' }}>
            <dt>He asks</dt>
            <dd data-testid="ask-wage">
              {wage(d.wage)} as {STATUS_LABEL[offer.status].toLowerCase()}
            </dd>
            {d.wageFloor !== undefined && (
              <>
                <dt>Wage floor</dt>
                <dd>{wage(d.wageFloor)}</dd>
              </>
            )}
            <dt>Length</dt>
            <dd>1 to {d.maxYears} seasons</dd>
          </div>
          <div className="row wrap" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
            {(Object.keys(TERM_LABEL) as TermKey[]).map((k) => (
              <span key={k} className={`chip ${STANCE_CHIP[d.stances[k]]}`} title={`${TERM_LABEL[k]}: ${STANCE_LABEL[d.stances[k]].toLowerCase()}`}>
                {TERM_LABEL[k]}: {STANCE_LABEL[d.stances[k]]}
              </span>
            ))}
          </div>
          {d.why.length > 0 && <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>{d.why.join('; ')}.</div>}
          <div className="meter-row" style={{ marginTop: 'var(--space-3)' }} data-testid="offer-meter">
            <span className="small">Offer worth</span>
            <Bar value={pct} colour={verdict.accepted ? 'var(--good)' : pct >= 90 ? 'var(--meter-mid)' : 'var(--bad)'} />
            <span className="mono small">{wage(verdict.score)}</span>
          </div>
          <div className={`small ${verdict.accepted ? 'good-text' : 'muted'}`} style={{ marginTop: 'var(--space-1)' }}>
            {verdict.accepted ? 'He would sign this.' : verdict.reasons[0]}
          </div>
        </div>
      </div>
      {msg && <div className="notice" style={{ marginTop: 'var(--space-3)' }}>{msg}</div>}
      <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)', justifyContent: 'flex-end' }}>
        {fails > 0 && closed === null && <span className="small muted">{fails} offer{fails === 1 ? '' : 's'} turned down</span>}
        <button className="btn ghost sm" onClick={onBack}>
          ← Back
        </button>
        <button
          className="btn primary sm"
          data-testid="offer-contract"
          disabled={closed !== null}
          title={closed !== null ? `Talks reopen after matchweek ${closed}` : undefined}
          onClick={() => {
            const out = store.proposeContract(id, offer)
            setMsg(out.message)
            if (out.accepted) {
              const next = openingOffer(useStore.getState().game!, u, id)
              if (next) setOffer(next)
            }
          }}
        >
          <Handshake size={14} aria-hidden="true" /> Offer contract
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
  const terms = [clauses?.release ? `release £${clauses.release}M` : '', clauses?.appearance ? `£${clauses.appearance}k an app` : '', clauses?.goal ? `£${clauses.goal}k a goal` : '', c.sellOn ? `${Math.round(c.sellOn.pct * 100)}% sell-on` : ''].filter(Boolean)
  return (
    <div className="card" data-testid="contract-card">
      <div className="row between wrap" style={{ gap: 'var(--space-2)' }}>
        <span className="head-title">
          <b>Contract</b>
          <Info label="About agents">{AGENT_MOOD_HELP[view.mood]} Finding a buyer brings offers in a window as if he were listed; his agent takes 5% of the fee.</Info>
        </span>
        <span className={`chip ${MOOD_CHIP[view.mood]}`}>{AGENT_MOOD_LABEL[view.mood]} agent</span>
      </div>
      <div className="small" style={{ marginTop: 'var(--space-2)' }}>
        {c.loan ? 'On loan until the summer.' : `${c.years} season${c.years === 1 ? '' : 's'} left${terms.length ? ` · ${terms.join(' · ')}` : ''}`}
      </div>
      {!c.loan && <div className="small muted">{view.why}</div>}
      {msg && <div className="notice" style={{ marginTop: 'var(--space-2)' }}>{msg}</div>}
      {!c.loan && (
        <div className="row wrap" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button className="btn sm" data-testid="open-talks" onClick={onTalks} disabled={closed !== null} title={closed !== null ? `Talks reopen after matchweek ${closed}` : 'Offer him new terms'}>
            {closed !== null ? `Talks closed to MW ${closed}` : 'Contract talks'}
          </button>
          <button className={`btn sm ${view.shopped ? 'primary' : ''}`} aria-pressed={view.shopped} data-testid="find-buyer" onClick={() => setMsg(store.setShopped(id, !view.shopped).message)}>
            {view.shopped ? 'Stop shopping him' : 'Find a buyer'}
          </button>
        </div>
      )}
    </div>
  )
}
