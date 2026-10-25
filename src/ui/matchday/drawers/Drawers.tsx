/**
 * The top bar's drawers: Tactics (the shape and roles, read-only: the lineup is
 * keyed by slot), Instructions (in and out of possession), Shouts (from the
 * 70th minute), Tweaks (set-piece takers among the men on the pitch) and
 * Substitutions (pick off, pick on, queue several, make them in one window).
 * Each Apply sends one change where the top bar's chip says it lands.
 */
import { useState, type ReactNode } from 'react'
import { getFormation } from '@engine/formations'
import { MAX_SUBS, MAX_WINDOWS, SHOUTS, type Shout } from '@engine/match'
import { ROLE_BY_ID, DEFAULT_ROLE } from '@engine/roles'
import { LINE_HELP, PASSING_HELP, PRESSING_HELP, TEMPO_HELP, WIDTH_HELP } from '@engine/tactics'
import type { PlayerSeason, SquadPlayer, Tactics } from '@engine/types'
import { Segmented } from '../../components/bits'
import { positionCode, roleCode, surname } from '../../match/shirts'
import { SHOUTS_CLOSED, setPiecesDiffer, instructionDiff, type DrawerId, type Sub } from '../controls'
import { ConditionIcon } from '../ConditionIcon'
import { Shirt } from '../Shirt'
import type { SideView } from '../types'
import type { ManagerHand } from '../useManagerHand'
import { Drawer } from './Drawer'

export interface DrawerProps {
  hand: ManagerHand
  view: SideView
  get: (id: string) => PlayerSeason | undefined
  squad: Record<string, SquadPlayer>
  /** Live condition of a man at the clock, when known. */
  condition: (psId: string) => number | null
  /** The man selected on the strip or a shirt, offered first when taking someone off. */
  selected: string | null
}

/** The chip again in the drawer, and the two buttons. */
function Foot({ hand, onApply, canApply, label = 'Apply' }: { hand: ManagerHand; onApply: () => void; canApply: boolean; label?: string }) {
  return (
    <>
      <span className={`md-chip ${hand.landing.kind}`}>
        <i aria-hidden />
        {hand.landing.text}
      </span>
      <button type="button" className="btn sm ghost" onClick={hand.close}>
        Cancel
      </button>
      <button type="button" className="btn sm primary" onClick={onApply} disabled={!canApply || !hand.editable}>
        {label}
      </button>
    </>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="md-field">
      <div className="md-field-head">
        <b>{label}</b>
        {help && <span className="help">{help}</span>}
      </div>
      {children}
    </div>
  )
}

export function TacticsDrawer({ hand, view, get }: DrawerProps) {
  const t = hand.tactics
  const formation = getFormation(t.formationId)
  const onAt = new Set(hand.onPitch)
  return (
    <Drawer title="Tactics" sub={`${view.name} · ${formation.name}`} onClose={hand.close} foot={<span className="small muted">Shape and roles are set before kick-off: the team sheet is keyed by position.</span>}>
      <table className="md-tactics-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Role</th>
            <th>Player</th>
          </tr>
        </thead>
        <tbody>
          {formation.slots.map((slot) => {
            const role = ROLE_BY_ID[t.roles[slot.id] ?? DEFAULT_ROLE[slot.position]]
            const man = hand.onPitch.find((id) => onAt.has(id) && hand.slotOf(id) === slot.id)
            return (
              <tr key={slot.id}>
                <td className="mono">{positionCode(formation, slot.id)}</td>
                <td>
                  <span className="md-role">{roleCode(t, slot.id, slot.position)}</span> {role?.name ?? ''}
                </td>
                <td>{man ? surname(get(man)?.name) : <span className="muted">empty</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="small muted">{hand.markTarget ? `Man-marking ${get(hand.markTarget)?.name ?? 'their danger man'}.` : 'No man-marking job this match.'}</p>
    </Drawer>
  )
}

export function InstructionsDrawer({ hand }: DrawerProps) {
  const [t, setT] = useState<Tactics>(hand.tactics)
  const changed = instructionDiff(hand.tactics, t).length > 0
  const set = (patch: Partial<Tactics>) => setT({ ...t, ...patch })
  return (
    <Drawer title="Instructions" sub="Team instructions for the rest of the match" onClose={hand.close} foot={<Foot hand={hand} canApply={changed} onApply={() => hand.submit({ tactics: t }) && hand.close()} />}>
      <div className="md-group">In possession</div>
      <Field label="Tempo" help={TEMPO_HELP[t.tempo]}>
        <Segmented value={t.tempo} onChange={(v) => set({ tempo: v })} options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'fast', label: 'Fast' }]} />
      </Field>
      <Field label="Width" help={WIDTH_HELP[t.width]}>
        <Segmented value={t.width} onChange={(v) => set({ width: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
      </Field>
      <Field label="Passing" help={PASSING_HELP[t.passing]}>
        <Segmented value={t.passing} onChange={(v) => set({ passing: v })} options={[{ value: 'short', label: 'Short' }, { value: 'mixed', label: 'Mixed' }, { value: 'direct', label: 'Direct' }]} />
      </Field>
      <div className="md-group">Out of possession</div>
      <Field label="Pressing" help={PRESSING_HELP[t.pressing]}>
        <Segmented value={t.pressing} onChange={(v) => set({ pressing: v })} options={[{ value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High' }]} />
      </Field>
      <Field label="Defensive line" help={LINE_HELP[t.defensiveLine]}>
        <Segmented value={t.defensiveLine} onChange={(v) => set({ defensiveLine: v })} options={[{ value: 'deep', label: 'Deep' }, { value: 'standard', label: 'Standard' }, { value: 'high', label: 'High' }]} />
      </Field>
    </Drawer>
  )
}

export function ShoutsDrawer({ hand }: DrawerProps) {
  const current = hand.pendingShout ?? hand.shout
  const [s, setS] = useState<Shout>(current ?? 'keep-shape')
  return (
    <Drawer title="Shouts" sub={hand.shoutsOpen ? 'One shout from the touchline for the last twenty minutes' : SHOUTS_CLOSED} onClose={hand.close} foot={<Foot hand={hand} canApply={hand.shoutsOpen && s !== current} onApply={() => hand.submit({ shout: s }) && hand.close()} />}>
      <div className="md-options" role="radiogroup" aria-label="Touchline shout">
        {(Object.keys(SHOUTS) as Shout[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={s === k} className={`md-option ${s === k ? 'active' : ''}`} onClick={() => setS(k)} disabled={!hand.shoutsOpen}>
            <b>{SHOUTS[k].label}</b>
            <span className="help">{SHOUTS[k].hint}</span>
            {current === k && <span className="md-tag">{hand.pendingShout ? 'pending' : 'in force'}</span>}
          </button>
        ))}
      </div>
    </Drawer>
  )
}

const SET_PIECES = [
  { key: 'penalties', label: 'Penalties', attr: (p: PlayerSeason) => Math.round((p.attributes.shooting + p.attributes.mentality) / 2) },
  { key: 'freeKicks', label: 'Free kicks', attr: (p: PlayerSeason) => p.attributes.shooting },
  { key: 'corners', label: 'Corners', attr: (p: PlayerSeason) => p.attributes.passing },
] as const

export function TweaksDrawer({ hand, get }: DrawerProps) {
  const [sp, setSp] = useState<Tactics['setPieces']>(hand.tactics.setPieces ?? {})
  const men = hand.onPitch.map(get).filter((p): p is PlayerSeason => !!p && p.positions[0] !== 'GK')
  const changed = setPiecesDiffer(hand.tactics.setPieces, sp)
  return (
    <Drawer title="Tweaks" sub="Set-piece takers among the men on the pitch" onClose={hand.close} foot={<Foot hand={hand} canApply={changed} onApply={() => hand.submit({ tactics: { ...hand.tactics, setPieces: sp } }) && hand.close()} />}>
      {SET_PIECES.map((k) => {
        const sorted = [...men].sort((a, b) => k.attr(b) - k.attr(a))
        const current = sp?.[k.key] ?? ''
        return (
          <Field key={k.key} label={k.label}>
            <select className="md-select wide" value={sorted.some((p) => p.id === current) ? current : ''} onChange={(e) => setSp({ ...sp, [k.key]: e.target.value || undefined })}>
              <option value="">Auto: best on the pitch</option>
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({k.attr(p)})
                </option>
              ))}
            </select>
          </Field>
        )
      })}
    </Drawer>
  )
}

export function SubsDrawer({ hand, view, get, squad, condition, selected }: DrawerProps) {
  const [queue, setQueue] = useState<Sub[]>([])
  const [off, setOff] = useState<string | null>(selected && hand.onPitch.includes(selected) ? selected : null)
  const queuedOff = new Set(queue.map((s) => s.off))
  const queuedOn = new Set(queue.map((s) => s.on))
  const room = hand.subCap - queue.length
  const ballRolling = hand.landing.kind !== 'now' || hand.minute >= 1
  const counters = `${hand.subsLeft}/${MAX_SUBS} subs · ${hand.windowsLeft}/${MAX_WINDOWS} stoppages`
  const pick = (on: string) => {
    if (!off || room <= 0) return
    setQueue([...queue, { off, on }])
    setOff(null)
  }
  const note =
    hand.landing.kind === 'stop' && hand.landing.stop === 45
      ? 'Changes at the break spend no stoppage.'
      : hand.landing.kind === 'now' && hand.windowsLeft <= 0
        ? 'No stoppages left: the referee will not stop play for another change.'
        : hand.landing.kind === 'now'
          ? 'Every change made together uses one stoppage.'
          : null
  return (
    <Drawer
      wide
      title="Substitutions"
      sub={counters}
      onClose={hand.close}
      foot={<Foot hand={hand} label={queue.length > 1 ? `Make ${queue.length} changes` : 'Make changes'} canApply={queue.length > 0 && ballRolling} onApply={() => hand.submit({ substitutions: queue }) && hand.close()} />}
    >
      {!ballRolling && <p className="small muted">Substitutions wait until the ball is rolling.</p>}
      {note && ballRolling && <p className="small muted">{note}</p>}
      {(hand.pendingSubs.length > 0 || queue.length > 0) && (
        <ul className="md-queue">
          {hand.pendingSubs.map((s) => (
            <li key={`p-${s.on}`} className="muted">
              {surname(get(s.on)?.name)} for {surname(get(s.off)?.name)} <span className="md-tag">at the stop</span>
            </li>
          ))}
          {queue.map((s) => (
            <li key={s.on}>
              <b>{surname(get(s.on)?.name)}</b> for {surname(get(s.off)?.name)}
              <button type="button" className="btn sm ghost" onClick={() => setQueue(queue.filter((x) => x !== s))} aria-label={`Undo ${get(s.on)?.name} for ${get(s.off)?.name}`}>
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="md-subs">
        <div>
          <div className="md-group">Take off</div>
          <div className="md-pick" role="listbox" aria-label="On the pitch">
            {hand.onPitch
              .filter((id) => !queuedOff.has(id))
              .map((id) => {
                const p = get(id)
                const cond = condition(id)
                return (
                  <button key={id} type="button" role="option" aria-selected={off === id} className={`md-pick-row ${off === id ? 'active' : ''}`} onClick={() => setOff(off === id ? null : id)} disabled={room <= 0 || !ballRolling}>
                    <Shirt colour={p?.positions[0] === 'GK' ? view.keeper : view.colour} number={view.numbers[id]} size={20} />
                    <span className="nm">{p?.name ?? id}</span>
                    <span className="pos mono">{p?.positions[0]}</span>
                    {cond !== null && <ConditionIcon value={cond} />}
                  </button>
                )
              })}
          </div>
        </div>
        <div>
          <div className="md-group">{off ? `On for ${surname(get(off)?.name)}` : 'Bring on'}</div>
          <div className="md-pick" role="listbox" aria-label="Bench">
            {hand.bench
              .filter((id) => !queuedOn.has(id))
              .map((id) => {
                const p = get(id)
                const cond = squad[id]?.condition
                return (
                  <button key={id} type="button" role="option" aria-selected={false} className="md-pick-row" onClick={() => pick(id)} disabled={!off || room <= 0}>
                    <Shirt colour={p?.positions[0] === 'GK' ? view.keeper : view.colour} number={view.numbers[id]} size={20} />
                    <span className="nm">{p?.name ?? id}</span>
                    <span className="pos mono">{p?.positions.join(' ')}</span>
                    {cond !== undefined && <ConditionIcon value={cond} />}
                  </button>
                )
              })}
            {hand.bench.length === 0 && <div className="small muted">Nobody available on the bench.</div>}
          </div>
        </div>
      </div>
      {room <= 0 && <p className="small muted">{hand.subCap === 0 ? 'No more changes at this point.' : 'That is every change this window can take.'}</p>}
    </Drawer>
  )
}

export function ActiveDrawer(p: DrawerProps & { id: DrawerId }) {
  switch (p.id) {
    case 'tactics':
      return <TacticsDrawer {...p} />
    case 'instructions':
      return <InstructionsDrawer {...p} />
    case 'shouts':
      return <ShoutsDrawer {...p} />
    case 'tweaks':
      return <TweaksDrawer {...p} />
    case 'subs':
      return <SubsDrawer {...p} />
  }
}
