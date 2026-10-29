/**
 * The substitution board inside the substitutions sheet, Football Manager
 * style: our XI on a small pitch in its formation slots and the bench as cards
 * beside it (under it on a phone). Drag a bench card onto a starter (or a
 * starter onto a bench card) to stage the change; while a man is held every
 * slot glows for how he fits it. Tap one and then the other does the same, and
 * so does the keyboard (Enter or Space picks up, the arrows move, Enter drops,
 * Escape lets go), with each step announced. Staged changes are listed with
 * Undo, and the team rating and the slot's role rating preview them. Pointer
 * events, not HTML5 drag, so a finger, a pen and a mouse all work; under a
 * finger the man in hand rides above it and is the one aimed with (`aimPoint`).
 *
 * The board only stages: the sheet sends the staged list through the hand's
 * `submit`, exactly as the lists before it did.
 */
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { getFormation } from '@engine/formations'
import type { FormationSlot, PlayerSeason, SquadPlayer } from '@engine/types'
import { positionCode, roleCode, surname } from '../../match/shirts'
import type { Sub } from '../controls'
import { ConditionIcon } from '../ConditionIcon'
import { OnArrow } from '../icons'
import { labelRoom, panelPoints } from '../model'
import { Shirt } from '../Shirt'
import { FIT_WORDS, aimPoint, fitGlow, lineupAfter, moveOnBoard, slotRole, slotRoleRating, stageSub, teamRating, type FitGlow, type StageRefusal } from '../subBoard'
import type { SideView } from '../types'
import type { ManagerHand } from '../useManagerHand'
import { VerticalPitch } from '../VerticalPitch'
import { translator } from '../../i18n'
import { roleName } from '../../i18n/engineText'
import { match } from '../../i18n/en/match'

const tx = translator(match)

type Kind = 'bench' | 'slot'
interface Held {
  kind: Kind
  /** A bench man's id, or a slot id. */
  id: string
  via: 'drag' | 'tap'
}

const REFUSED: Record<StageRefusal, () => string> = {
  'no-room': () => tx('refusedNoRoom'),
  'not-on-pitch': () => tx('refusedNotOnPitch'),
  'not-on-bench': () => tx('refusedNotOnBench'),
  'already-on': () => tx('refusedAlreadyOn'),
  same: () => tx('refusedSame'),
}

/** Pixels a pointer travels before a press becomes a drag (below it, it is a tap). */
const DRAG_START = 6

export interface SubBoardProps {
  hand: ManagerHand
  view: SideView
  get: (id: string) => PlayerSeason | undefined
  squad: Record<string, SquadPlayer>
  condition: (psId: string) => number | null
  /** The man selected on the strip: his slot starts picked. */
  selected: string | null
  queue: Sub[]
  setQueue: (q: Sub[]) => void
  /** How many changes the board can stage (`boardRoom`). */
  room: number
  disabled: boolean
  hideRatings: boolean
}

export function SubBoard({ hand, view, get, squad, condition, selected, queue, setQueue, room, disabled, hideRatings }: SubBoardProps) {
  const tactics = hand.tactics
  const formation = getFormation(tactics.formationId)
  const points = useMemo(() => panelPoints(formation, tactics), [formation, tactics])
  const gaps = useMemo(() => labelRoom(points), [points])
  const slotById = useMemo(() => new Map(formation.slots.map((s) => [s.id, s])), [formation])

  // Who stands where: the men on the pitch, then the stop's pending changes already in their slots
  const original = new Map<string, string>()
  for (const id of hand.onPitch) {
    const slot = hand.slotOf(id)
    if (slot) original.set(slot, id)
  }
  const pendingAt = new Map<string, Sub>()
  for (const s of hand.pendingSubs) {
    const slot = hand.slotOf(s.off)
    if (slot && !original.has(slot)) pendingAt.set(slot, s)
  }
  const stagedFor = new Map(queue.map((s) => [s.off, s]))
  const shownAt = (slotId: string): string | undefined => {
    const o = original.get(slotId)
    return o ? (stagedFor.get(o)?.on ?? o) : pendingAt.get(slotId)?.on
  }
  const staged = new Set(queue.map((s) => s.on))
  const bench = hand.bench.filter((id) => !staged.has(id))

  // Live condition where the dashboard knows it, else the squad's: the team rating's modifiers read it
  const state = (id: string): SquadPlayer | undefined => {
    const s = squad[id]
    const c = condition(id)
    return s && c !== null ? { ...s, condition: c } : s
  }
  const men = [...[...original].map(([slotId, psId]) => ({ slotId, psId })), ...[...pendingAt].map(([slotId, s]) => ({ slotId, psId: s.on }))]
  const before = teamRating(tactics, lineupAfter(men, []), get, state)
  const after = teamRating(tactics, lineupAfter(men, queue), get, state)

  const [held, setHeld] = useState<Held | null>(() => {
    const slot = selected ? hand.slotOf(selected) : undefined
    return slot && original.get(slot) === selected ? { kind: 'slot', id: slot, via: 'tap' } : null
  })
  const [hover, setHover] = useState<string | null>(null)
  const [say, setSay] = useState('')
  // The dragged man's ghost: mounted once when a drag starts, then moved by writing its transform straight to the
  // element (`ghostRef`), so a pointer move does not re-render the board and recompute its team ratings every frame
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const ghostAt = useRef<{ x: number; y: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: Kind; id: string; pointerId: number; x0: number; y0: number; started: boolean; touch: boolean } | null>(null)
  const swallowClick = useRef(false)

  const canTake = (slotId: string) => !disabled && !!original.get(slotId)
  const slotName = (slot: FormationSlot) => positionCode(formation, slot.id)
  const nameOf = (id: string | undefined) => surname(id ? get(id)?.name : undefined)
  const roleNum = (p: PlayerSeason | undefined, slot: FormationSlot) => (p ? Math.round(slotRoleRating(p, tactics, slot)) : null)

  /** The pair a drop makes: always (slot, bench man). */
  const pair = (a: { kind: Kind; id: string }, b: { kind: Kind; id: string }) => (a.kind === 'slot' ? { slotId: a.id, on: b.id } : { slotId: b.id, on: a.id })

  const drop = (from: { kind: Kind; id: string }, to: { kind: Kind; id: string }) => {
    if (from.kind === to.kind) return
    const { slotId, on } = pair(from, to)
    const off = original.get(slotId)
    const slot = slotById.get(slotId)
    if (!off || !slot) return
    const shown = shownAt(slotId)!
    const r = stageSub(queue, { off: shown, on }, { onPitch: hand.onPitch, bench: hand.bench, cap: room })
    if (r.refused) {
      setSay(REFUSED[r.refused]())
      return
    }
    setQueue(r.subs)
    const p = get(on)
    const left = room - r.subs.length
    setSay(tx('sayStaged', { on: nameOf(on), off: nameOf(off), slot: slotName(slot), fit: p ? `, ${FIT_WORDS[fitGlow(p, slot.position)]}` : '', left: Math.max(0, left) }))
  }

  const pickUp = (h: Held) => {
    setHeld(h)
    setHover(null)
    const who = h.kind === 'bench' ? nameOf(h.id) : nameOf(shownAt(h.id))
    setSay(tx(h.kind === 'bench' ? 'sayPickedBench' : 'sayPickedSlot', { who }))
  }
  const letGo = (quiet = false) => {
    setHeld(null)
    setHover(null)
    if (!quiet) setSay(tx('sayLetGo'))
  }

  // ------------------------------------------------------------------ tap (and Enter or Space on a focused card)
  const tap = (kind: Kind, id: string) => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    if (disabled) return
    if (held && held.kind !== kind) {
      drop(held, { kind, id })
      letGo(true)
      return
    }
    if (held && held.id === id) return letGo()
    pickUp({ kind, id, via: 'tap' })
  }

  // ------------------------------------------------------------------ drag
  const targetAt = (x: number, y: number, kind: Kind): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
    if (!el || !root.current?.contains(el) || el.dataset.drop === kind || (el as HTMLButtonElement).disabled) return null
    return el.dataset.id ?? null
  }
  const down = (e: ReactPointerEvent<HTMLElement>, kind: Kind, id: string) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag.current = { kind, id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType === 'touch' }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety: the move and up still reach the card under the pointer
    }
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.started) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_START) return
      d.started = true
      setHeld({ kind: d.kind, id: d.id, via: 'drag' })
      setSay(tx('sayDragging', { who: d.kind === 'bench' ? nameOf(d.id) : nameOf(shownAt(d.id)) }))
    }
    e.preventDefault()
    const at = { x: e.clientX, y: e.clientY }
    ghostAt.current = at
    if (ghostRef.current) ghostRef.current.style.transform = `translate(${at.x}px, ${at.y}px)`
    else if (!ghost) setGhost(at)
    const aim = aimPoint(e.clientX, e.clientY, e.pointerType)
    const t = targetAt(aim.x, aim.y, d.kind)
    setHover((h) => (h === t ? h : t))
  }
  const up = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    if (!d.started) return
    // The click that follows a drag is not a tap
    swallowClick.current = true
    window.setTimeout(() => (swallowClick.current = false), 0)
    const aim = aimPoint(e.clientX, e.clientY, e.pointerType)
    const t = targetAt(aim.x, aim.y, d.kind)
    ghostAt.current = null
    setGhost(null)
    if (t) drop(d, { kind: d.kind === 'bench' ? 'slot' : 'bench', id: t })
    else setSay(tx('sayDroppedNowhere'))
    setHeld(null)
    setHover(null)
  }
  const cancel = () => {
    if (!drag.current) return
    drag.current = null
    ghostAt.current = null
    setGhost(null)
    letGo(true)
  }
  const handlers = (kind: Kind, id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => down(e, kind, id),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: cancel,
    onClick: () => tap(kind, id),
    onFocus: () => held && held.kind !== kind && setHover(id),
  })

  // ------------------------------------------------------------------ keyboard: arrows move, Escape lets go
  const focusOn = (kind: Kind, id: string) => root.current?.querySelector<HTMLElement>(`[data-drop="${kind}"][data-id="${CSS.escape(id)}"]`)?.focus()
  const keys = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && held) {
      e.preventDefault()
      e.stopPropagation()
      const back = held
      letGo()
      focusOn(back.kind, back.id)
      return
    }
    if (!e.key.startsWith('Arrow')) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-drop]')
    if (!el) return
    const here = el.dataset.drop as Kind
    // Holding a man, the arrows go to the other side's targets; otherwise they move within the group in focus
    const group: Kind = held ? (held.kind === 'bench' ? 'slot' : 'bench') : here
    const current = group === here ? (el.dataset.id ?? null) : hover
    let next: string | null = null
    if (group === 'slot') {
      const open = points.filter((p) => canTake(p.id))
      const from = current && open.some((p) => p.id === current) ? current : null
      // A man just picked up starts over the slot his role rating is best in
      const best = (): string | null => {
        if (!heldMan || !open.length) return null
        const rate = (id: string) => slotRoleRating(heldMan, tactics, slotById.get(id)!)
        return open.reduce((a, b) => (rate(b.id) > rate(a.id) ? b : a)).id
      }
      next = from ? moveOnBoard(open, from, e.key) : (best() ?? moveOnBoard(open, null, e.key))
    } else {
      const ids = bench
      if (!ids.length) return
      const i = current ? ids.indexOf(current) : -1
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1
      next = i < 0 ? ids[0] : ids[(i + step + ids.length) % ids.length]
    }
    if (!next) return
    e.preventDefault()
    focusOn(group, next)
    if (held) setHover(next)
  }

  // ------------------------------------------------------------------ the preview line
  const heldMan = held ? (held.kind === 'bench' ? get(held.id) : get(shownAt(held.id) ?? '')) : undefined
  const glowFor = (slot: FormationSlot): FitGlow | null => (held?.kind === 'bench' && heldMan && canTake(slot.id) ? fitGlow(heldMan, slot.position) : null)
  const benchGlow = (p: PlayerSeason | undefined): FitGlow | null => {
    if (held?.kind !== 'slot' || !p) return null
    const slot = slotById.get(held.id)
    return slot ? fitGlow(p, slot.position) : null
  }
  const preview = (() => {
    if (!held || !hover) return null
    const { slotId, on } = pair(held, { kind: held.kind === 'bench' ? 'slot' : 'bench', id: hover })
    const slot = slotById.get(slotId)
    const offId = shownAt(slotId)
    const pOn = get(on)
    if (!slot || !offId || !pOn) return null
    const trial = stageSub(queue, { off: offId, on }, { onPitch: hand.onPitch, bench: hand.bench, cap: room })
    return { slot, role: roleName(slotRole(tactics, slot)), off: get(offId), on: pOn, fit: fitGlow(pOn, slot.position), team: trial.refused ? null : teamRating(tactics, lineupAfter(men, trial.subs), get, state), refused: trial.refused }
  })()
  const num = (n: number | null | undefined, digits = 0) => (hideRatings || n === null || n === undefined ? '?' : n.toFixed(digits))
  const delta = (a: number, b: number) => (b > a + 0.05 ? 'up' : b < a - 0.05 ? 'down' : 'same')

  return (
    <div className={`sub-board ${held ? 'holding' : ''}`} data-testid="sub-board" ref={root} onKeyDown={keys}>
      <div className="sub-pitch">
        <VerticalPitch label={tx('pitchLabel', { name: view.name, formation: formation.name })} ratio={1.18}>
          {formation.slots.map((slot, i) => {
            const { left, top } = points[i]
            const id = shownAt(slot.id)
            const p = id ? get(id) : undefined
            const pending = !original.has(slot.id) && pendingAt.has(slot.id)
            const isStaged = !!id && staged.has(id)
            const glow = glowFor(slot)
            const cond = id ? (isStaged || pending ? (squad[id]?.condition ?? null) : condition(id)) : null
            const takeable = canTake(slot.id)
            const isHeld = held?.kind === 'slot' && held.id === slot.id
            const gap = gaps[slot.id]
            const rr = held?.kind === 'bench' && heldMan && takeable ? roleNum(heldMan, slot) : null
            return (
              <button
                key={slot.id}
                type="button"
                className={`sub-slot ${glow ? `glow-${glow}` : ''} ${isStaged ? 'staged' : ''} ${pending ? 'pending' : ''} ${isHeld ? 'held' : ''} ${hover === slot.id ? 'over' : ''}`}
                style={{ left: `${left}%`, top: `${top}%`, maxWidth: gap === null ? undefined : `min(84px, calc(${gap.toFixed(1)}% - 2px))` }}
                data-testid="sub-slot"
                data-drop="slot"
                data-id={slot.id}
                data-fit={glow ?? undefined}
                disabled={!takeable}
                aria-pressed={isHeld}
                aria-label={`${slotName(slot)}, ${roleName(slotRole(tactics, slot))}: ${p?.name ?? tx('empty')}${isStaged ? tx('comingOn') : ''}${pending ? tx('comingOnStop') : ''}${glow && heldMan ? `. ${heldMan.name}: ${FIT_WORDS[glow]}${hideRatings ? '' : tx('roleRating', { r: rr })}` : ''}`}
                {...handlers('slot', slot.id)}
              >
                <span className="sub-slot-shirt">
                  <Shirt colour={slot.position === 'GK' ? view.keeper : view.colour} number={id ? view.numbers[id] : undefined} size={26} dim={!id} />
                  {(isStaged || pending) && (
                    <span className="sub-slot-on">
                      <OnArrow />
                    </span>
                  )}
                  {rr !== null && <span className={`sub-fit-num ${glow ?? ''}`}>{num(rr)}</span>}
                </span>
                <span className="sub-slot-name">{surname(p?.name)}</span>
                <span className="sub-slot-meta">
                  <span className="md-role">{roleCode(tactics, slot.id, slot.position)}</span>
                  {cond !== null && <ConditionIcon value={cond} />}
                </span>
              </button>
            )
          })}
        </VerticalPitch>
      </div>

      <div className="sub-side">
        <div className="sub-preview" data-testid="sub-preview">
          {preview ? (
            <>
              <span className="sub-preview-slot">
                <b className="mono">{slotName(preview.slot)}</b> {preview.role}
              </span>
              <span>
                {surname(preview.off?.name)} <span className="mono">{num(preview.off ? slotRoleRating(preview.off, tactics, preview.slot) : null)}</span>
                <span aria-hidden> → </span>
                <b>{surname(preview.on.name)}</b> <span className={`mono fit-text ${preview.fit}`}>{num(slotRoleRating(preview.on, tactics, preview.slot))}</span> <span className={`fit-text ${preview.fit}`}>{FIT_WORDS[preview.fit]}</span>
              </span>
              <span className="sub-team">
                {tx('team')} <span className="mono">{num(before, 1)}</span>
                {preview.team !== null ? (
                  <>
                    <span aria-hidden> → </span>
                    <b className={`mono ${hideRatings ? '' : delta(before, preview.team)}`}>{num(preview.team, 1)}</b>
                  </>
                ) : (
                  <span className="muted"> · {REFUSED[preview.refused!]()}</span>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="muted small">{tx(held ? (held.kind === 'bench' ? 'hintDrop' : 'hintPickOn') : disabled ? 'hintNoChanges' : 'hintDrag')}</span>
              <span className="sub-team">
                {tx('teamRating')} <span className="mono">{num(before, 1)}</span>
                {queue.length > 0 && (
                  <>
                    <span aria-hidden> → </span>
                    <b className={`mono ${hideRatings ? '' : delta(before, after)}`} data-testid="sub-team-after">
                      {num(after, 1)}
                    </b>
                  </>
                )}
              </span>
            </>
          )}
        </div>

        <div className="md-group">{tx('bench')}</div>
        <div className="sub-bench" role="group" aria-label={tx('bench')}>
          {bench.map((id) => {
            const p = get(id)
            const cond = squad[id]?.condition
            const glow = benchGlow(p)
            const heldSlot = held?.kind === 'slot' ? slotById.get(held.id) : undefined
            const isHeld = held?.kind === 'bench' && held.id === id
            return (
              <button
                key={id}
                type="button"
                className={`sub-bench-card ${glow ? `glow-${glow}` : ''} ${isHeld ? 'held' : ''} ${hover === id ? 'over' : ''}`}
                data-testid="sub-bench-card"
                data-drop="bench"
                data-id={id}
                data-fit={glow ?? undefined}
                disabled={disabled}
                aria-pressed={isHeld}
                aria-label={`${p?.name ?? id}, ${p?.positions.join(' ') ?? ''}${cond !== undefined ? tx('conditionOf', { c: cond }) : ''}${glow && heldSlot ? tx('atSlot', { slot: slotName(heldSlot), fit: FIT_WORDS[glow] }) : ''}`}
                {...handlers('bench', id)}
              >
                <Shirt colour={p?.positions[0] === 'GK' ? view.keeper : view.colour} number={view.numbers[id]} size={22} />
                <span className="nm">{surname(p?.name)}</span>
                <span className="pos mono">{p?.positions.join(' ')}</span>
                {glow && heldSlot && p ? <span className={`sub-fit-num ${glow}`}>{num(roleNum(p, heldSlot))}</span> : !hideRatings && p ? <span className="ovr mono">{p.overall}</span> : null}
                {cond !== undefined && <ConditionIcon value={cond} />}
              </button>
            )
          })}
          {bench.length === 0 && <div className="small muted">{tx(hand.bench.length ? 'benchAllOn' : 'benchEmpty')}</div>}
        </div>

        {(hand.pendingSubs.length > 0 || queue.length > 0) && (
          <>
            <div className="md-group">{tx('changes')}</div>
            <ul className="md-queue sub-queue" aria-label={tx('changesToMake')}>
              {hand.pendingSubs.map((s) => (
                <li key={`p-${s.on}`} className="muted">
                  <span>
                    {nameOf(s.on)} ↔ {nameOf(s.off)}
                  </span>
                  <span className="md-tag">{tx('atTheStop')}</span>
                </li>
              ))}
              {queue.map((s) => {
                const slotId = hand.slotOf(s.off)
                const slot = slotId ? slotById.get(slotId) : undefined
                return (
                  <li key={s.on} data-testid="sub-pending">
                    <OnArrow />
                    <span>
                      <b>{nameOf(s.on)}</b> ↔ {nameOf(s.off)}
                      {slot && <span className="mono muted"> {slotName(slot)}</span>}
                    </span>
                    <button
                      type="button"
                      className="btn sm ghost"
                      data-testid="sub-undo"
                      onClick={() => {
                        setQueue(queue.filter((x) => x !== s))
                        setSay(tx('sayUndone', { who: nameOf(s.off) }))
                      }}
                      aria-label={tx('undoSub', { on: get(s.on)?.name, off: get(s.off)?.name })}
                    >
                      {tx('undo')}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      <div className="sr-only" aria-live="polite" data-testid="sub-announce">
        {say}
      </div>
      {ghost && held?.via === 'drag' && heldMan && (
        <div className={`sub-ghost ${drag.current?.touch ? 'lifted' : ''}`} ref={ghostRef} style={{ transform: `translate(${(ghostAt.current ?? ghost).x}px, ${(ghostAt.current ?? ghost).y}px)` }} aria-hidden>
          <Shirt colour={heldMan.positions[0] === 'GK' ? view.keeper : view.colour} number={view.numbers[heldMan.id]} size={26} />
          <span>{surname(heldMan.name)}</span>
        </div>
      )}
    </div>
  )
}
