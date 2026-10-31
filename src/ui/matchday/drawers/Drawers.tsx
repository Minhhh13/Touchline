/**
 * The top bar's drawers: Tactics (the shape and roles, read-only: the lineup is
 * keyed by slot), Instructions (in and out of possession), Shouts (from the
 * 70th minute), Tweaks (set-piece takers among the men on the pitch) and
 * Substitutions (the substitution board: drag, tap or key a substitute onto a
 * starter, stage several, make them in one window).
 * Each Apply sends one change where the top bar's chip says it lands.
 */
import { useState, type ReactNode } from 'react'
import { getFormation } from '@engine/formations'
import { MAX_SUBS, MAX_WINDOWS, SHOUTS, type Shout } from '@engine/match'
import { ROLE_BY_ID, DEFAULT_ROLE } from '@engine/roles'
import type { PlayerSeason, SquadPlayer, Tactics } from '@engine/types'
import { Segmented } from '../../components/bits'
import { positionCode, roleCode, surname } from '../../match/shirts'
import { shoutsClosed, setPiecesDiffer, instructionDiff, type DrawerId, type Sub } from '../controls'
import { lineHelp, passingHelp, pressingHelp, shoutHint, shoutLabel, tempoHelp, widthHelp } from '../tacticText'
import { boardRoom, countersAfter } from '../subBoard'
import type { SideView } from '../types'
import type { ManagerHand } from '../useManagerHand'
import { Drawer } from './Drawer'
import { SubBoard } from './SubBoard'
import { translator } from '../../i18n'
import { roleName } from '../../i18n/engineText'
import { match } from '../../i18n/en/match'
import { onRadioGroupKey, radioTabIndex } from '../../a11y'

const tx = translator(match)

export interface DrawerProps {
  hand: ManagerHand
  view: SideView
  get: (id: string) => PlayerSeason | undefined
  squad: Record<string, SquadPlayer>
  /** Live condition of a man at the clock, when known. */
  condition: (psId: string) => number | null
  /** The man selected on the strip or a shirt, offered first when taking someone off. */
  selected: string | null
  /** The save hides ratings (hard or blind): the board shows its fit colours but no numbers. */
  hideRatings?: boolean
}

/** The chip again in the drawer, and the two buttons. */
function Foot({ hand, onApply, canApply, label = tx('apply'), testId }: { hand: ManagerHand; onApply: () => void; canApply: boolean; label?: string; testId?: string }) {
  return (
    <>
      <span className={`md-chip ${hand.landing.kind}`}>
        <i aria-hidden />
        {hand.landing.text}
      </span>
      <button type="button" className="btn sm ghost" onClick={hand.close}>
        {tx('cancel')}
      </button>
      <button type="button" className="btn sm primary" onClick={onApply} disabled={!canApply || !hand.editable} data-testid={testId}>
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
    <Drawer title={tx('tactics')} sub={`${view.name} · ${formation.name}`} onClose={hand.close} foot={<span className="small muted">{tx('tacticsFoot')}</span>}>
      <table className="md-tactics-table">
        <thead>
          <tr>
            <th>{tx('colPos')}</th>
            <th>{tx('colRole')}</th>
            <th>{tx('colPlayer')}</th>
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
                  <span className="md-role">{roleCode(t, slot.id, slot.position)}</span> {role ? roleName(role) : ''}
                </td>
                <td>{man ? surname(get(man)?.name) : <span className="muted">{tx('empty')}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="small muted">{hand.markTarget ? tx('manMarking', { name: get(hand.markTarget)?.name ?? tx('dangerMan') }) : tx('noManMarking')}</p>
    </Drawer>
  )
}

export function InstructionsDrawer({ hand }: DrawerProps) {
  const [t, setT] = useState<Tactics>(hand.tactics)
  const changed = instructionDiff(hand.tactics, t).length > 0
  const set = (patch: Partial<Tactics>) => setT({ ...t, ...patch })
  return (
    <Drawer title={tx('instructions')} sub={tx('instructionsSub')} onClose={hand.close} foot={<Foot hand={hand} canApply={changed} onApply={() => hand.submit({ tactics: t }) && hand.close()} />}>
      <div className="md-group">{tx('inPossession')}</div>
      <Field label={tx('tempo')} help={tempoHelp(t.tempo)}>
        <Segmented label={tx('tempo')} value={t.tempo} onChange={(v) => set({ tempo: v })} options={[{ value: 'slow', label: tx('slow') }, { value: 'standard', label: tx('standard') }, { value: 'fast', label: tx('fast') }]} />
      </Field>
      <Field label={tx('width')} help={widthHelp(t.width)}>
        <Segmented label={tx('width')} value={t.width} onChange={(v) => set({ width: v })} options={[{ value: 'narrow', label: tx('narrow') }, { value: 'standard', label: tx('standard') }, { value: 'wide', label: tx('wide') }]} />
      </Field>
      <Field label={tx('passing')} help={passingHelp(t.passing)}>
        <Segmented label={tx('passing')} value={t.passing} onChange={(v) => set({ passing: v })} options={[{ value: 'short', label: tx('short') }, { value: 'mixed', label: tx('mixed') }, { value: 'direct', label: tx('direct') }]} />
      </Field>
      <div className="md-group">{tx('outOfPossession')}</div>
      <Field label={tx('pressing')} help={pressingHelp(t.pressing)}>
        <Segmented label={tx('pressing')} value={t.pressing} onChange={(v) => set({ pressing: v })} options={[{ value: 'low', label: tx('low') }, { value: 'mid', label: tx('mid') }, { value: 'high', label: tx('high') }]} />
      </Field>
      <Field label={tx('defensiveLine')} help={lineHelp(t.defensiveLine)}>
        <Segmented label={tx('defensiveLine')} value={t.defensiveLine} onChange={(v) => set({ defensiveLine: v })} options={[{ value: 'deep', label: tx('deep') }, { value: 'standard', label: tx('standard') }, { value: 'high', label: tx('high') }]} />
      </Field>
    </Drawer>
  )
}

export function ShoutsDrawer({ hand }: DrawerProps) {
  const current = hand.pendingShout ?? hand.shout
  const [s, setS] = useState<Shout>(current ?? 'keep-shape')
  return (
    <Drawer title={tx('shouts')} sub={hand.shoutsOpen ? tx('shoutsSub') : shoutsClosed()} onClose={hand.close} foot={<Foot hand={hand} canApply={hand.shoutsOpen && s !== current} onApply={() => hand.submit({ shout: s }) && hand.close()} />}>
      <div className="md-options" role="radiogroup" aria-label={tx('touchlineShout')} onKeyDown={onRadioGroupKey}>
        {(Object.keys(SHOUTS) as Shout[]).map((k, i, all) => (
          <button key={k} type="button" role="radio" aria-checked={s === k} tabIndex={radioTabIndex(i, all.indexOf(s))} className={`md-option ${s === k ? 'active' : ''}`} onClick={() => setS(k)} disabled={!hand.shoutsOpen}>
            <b>{shoutLabel(k)}</b>
            <span className="help">{shoutHint(k)}</span>
            {current === k && <span className="md-tag">{tx(hand.pendingShout ? 'pending' : 'inForce')}</span>}
          </button>
        ))}
      </div>
    </Drawer>
  )
}

const SET_PIECES = [
  { key: 'penalties', label: () => tx('penalties'), attr: (p: PlayerSeason) => Math.round((p.attributes.shooting + p.attributes.mentality) / 2) },
  { key: 'freeKicks', label: () => tx('freeKicks'), attr: (p: PlayerSeason) => p.attributes.shooting },
  { key: 'corners', label: () => tx('corners'), attr: (p: PlayerSeason) => p.attributes.passing },
] as const

export function TweaksDrawer({ hand, get }: DrawerProps) {
  const [sp, setSp] = useState<Tactics['setPieces']>(hand.tactics.setPieces ?? {})
  const men = hand.onPitch.map(get).filter((p): p is PlayerSeason => !!p && p.positions[0] !== 'GK')
  const changed = setPiecesDiffer(hand.tactics.setPieces, sp)
  return (
    <Drawer title={tx('tweaks')} sub={tx('tweaksSub')} onClose={hand.close} foot={<Foot hand={hand} canApply={changed} onApply={() => hand.submit({ tactics: { ...hand.tactics, setPieces: sp } }) && hand.close()} />}>
      {SET_PIECES.map((k) => {
        const sorted = [...men].sort((a, b) => k.attr(b) - k.attr(a))
        const current = sp?.[k.key] ?? ''
        return (
          <Field key={k.key} label={k.label()}>
            <select className="md-select wide" value={sorted.some((p) => p.id === current) ? current : ''} onChange={(e) => setSp({ ...sp, [k.key]: e.target.value || undefined })}>
              <option value="">{tx('autoBest')}</option>
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

export function SubsDrawer({ hand, view, get, squad, condition, selected, hideRatings = false }: DrawerProps) {
  const [queue, setQueue] = useState<Sub[]>([])
  const ballRolling = hand.landing.kind !== 'now' || hand.minute >= 1
  const counters = tx('counters', { subs: hand.subsLeft, maxSubs: MAX_SUBS, windows: hand.windowsLeft, maxWindows: MAX_WINDOWS })
  // The subs this window can take, and none in play once the three stoppages are spent (as the engine counts them)
  const room = boardRoom({ subCap: hand.subCap, landing: hand.landing.kind, windowsLeft: hand.windowsLeft, windowOpen: hand.windowOpen })
  const next = countersAfter({ subsLeft: hand.subsLeft, windowsLeft: hand.windowsLeft, landing: hand.landing.kind, windowOpen: hand.windowOpen, staged: queue.length })
  const note =
    hand.landing.kind === 'stop' && hand.landing.stop === 45
      ? tx('noteBreak')
      : hand.landing.kind === 'now' && hand.windowsLeft <= 0 && !hand.windowOpen
        ? tx('noteNoStoppages')
        : hand.landing.kind === 'now'
          ? tx('noteOneStoppage')
          : null
  return (
    <Drawer
      wide
      className="board"
      title={tx('substitutions')}
      sub={counters}
      onClose={hand.close}
      foot={
        <>
          {queue.length > 0 && (
            <span className="small muted sub-after" data-testid="sub-after">
              {tx(hand.landing.kind === 'now' ? 'afterNow' : 'after', { subs: next.subsLeft, maxSubs: MAX_SUBS, windows: next.windowsLeft, maxWindows: MAX_WINDOWS })}
            </span>
          )}
          <Foot hand={hand} testId="sub-confirm" label={tx('makeChanges', { n: queue.length })} canApply={queue.length > 0 && ballRolling} onApply={() => hand.submit({ substitutions: queue }) && hand.close()} />
        </>
      }
    >
      {!ballRolling && <p className="small muted">{tx('waitBallRolling')}</p>}
      {note && ballRolling && <p className="small muted sub-note">{note}</p>}
      <SubBoard hand={hand} view={view} get={get} squad={squad} condition={condition} selected={selected} queue={queue} setQueue={setQueue} room={room} disabled={!ballRolling || !hand.editable} hideRatings={hideRatings} />
      {room <= 0 && queue.length === 0 && ballRolling && <p className="small muted">{tx(hand.subCap === 0 ? 'noMoreAtPoint' : 'windowFull')}</p>}
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
