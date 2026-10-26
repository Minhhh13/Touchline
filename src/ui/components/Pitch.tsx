import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Formation, PlayerSeason, SquadPlayer } from '@engine/types'
import { describeFit } from '@engine/positions'
import { slotRating, slotRatingLine } from '@game/logic/slotRating'
import { FIT_AMBER, FIT_RED, fitRingColour } from '../format'
import { surname } from '../match/shirts'
import { labelRoom } from '../matchday/model'
import { isActivationKey } from '../a11y'

/** Rough text widths (px per character) of the slot label and its role line (both 11px), to pick a form that fits. */
const NAME_CH = 6.4
const SUB_CH = 6.3
/** The widest a slot's label may be, and what it falls back to before the pitch is measured. */
const LABEL_MAX = 110
const PITCH_GUESS = 300

/**
 * Each slot's label room in px: the gap to the nearest team-mate level with him (so two centre-backs' names never run
 * into each other), and never past the touchline.
 */
function slotRooms(formation: Formation, width: number): Record<string, number> {
  const gaps = labelRoom(formation.slots.map((sl) => ({ id: sl.id, left: sl.x, top: 100 - sl.y })), 9)
  const out: Record<string, number> = {}
  for (const sl of formation.slots) {
    const gap = gaps[sl.id]
    const edge = 2 * Math.min(sl.x, 100 - sl.x)
    const pct = Math.min(gap ?? 100, edge + 6)
    out[sl.id] = Math.max(40, Math.min(LABEL_MAX, (pct / 100) * width - 6))
  }
  return out
}

export interface PitchProps {
  formation: Formation
  lineup: Record<string, string>
  getPlayer: (id: string) => PlayerSeason | undefined
  getState?: (id: string) => SquadPlayer | undefined
  onSlotClick?: (slotId: string) => void
  selectedSlot?: string | null
  eligibleSlots?: string[]
  hideRatings?: boolean
  /** The player whose rating just came out of hiding (a blind pick landing): his disc flips the number in. */
  revealId?: string | null
  showRoles?: Record<string, string>
  /** Short forms of `showRoles` (role codes), shown when the full role does not fit the slot; the full one is in the tooltip. */
  roleCodes?: Record<string, string>
}

export function Pitch({ formation, lineup, getPlayer, getState, onSlotClick, selectedSlot, eligibleSlots, hideRatings, revealId, showRoles, roleCodes }: PitchProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(PITCH_GUESS)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width) || PITCH_GUESS))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const rooms = useMemo(() => slotRooms(formation, width), [formation, width])
  return (
    <div className="pitch-wrap" role="group" aria-label="Formation" ref={ref}>
      <svg viewBox="0 0 300 400" preserveAspectRatio="none" aria-hidden="true">
        <g fill="none" style={{ stroke: 'var(--pitch-line)' }} strokeWidth="2">
          <rect x="8" y="8" width="284" height="384" />
          <line x1="8" y1="200" x2="292" y2="200" />
          <circle cx="150" cy="200" r="36" />
          <rect x="70" y="8" width="160" height="60" />
          <rect x="110" y="8" width="80" height="22" />
          <rect x="70" y="332" width="160" height="60" />
          <rect x="110" y="370" width="80" height="22" />
        </g>
      </svg>
      {formation.slots.map((slot) => {
        const id = lineup[slot.id]
        const p = id ? getPlayer(id) : undefined
        const st = id && getState ? getState(id) : undefined
        const eligible = eligibleSlots?.includes(slot.id)
        const warn = !!(st && (st.injury || st.suspension > 0))
        // The number in this slot (overall less the out-of-position cost): the slot pickers lead with the same one, so they agree
        const rated = p ? slotRating(p, slot.position) : null
        const eff = rated?.inSlot ?? 0
        // Accomplished is a small out-of-position cost (amber, acc.); awkward or worse a big one (red, awk.)
        const fit = p ? describeFit(p, slot.position) : 'natural'
        // The fit colour gives way to the injured/suspended red ring and the selected/eligible highlights; the label still names the fit
        const ring = p ? fitRingColour(fit, { warn, highlighted: !!eligible || selectedSlot === slot.id }) : undefined
        // y is from own goal (bottom) to opposition goal (top)
        const left = `${slot.x}%`
        // The keeper sits on the goal line: his name and role go beside the disc, and the disc keeps clear of the bottom edge,
        // so neither is cut off by a short pitch
        const foot = slot.y <= 10
        const top = foot ? `min(${100 - slot.y}%, calc(100% - var(--foot-room, 20px)))` : `${100 - slot.y}%`
        // The label's form: the full name and role when they fit the slot's room, else the surname and the role code
        const room = rooms[slot.id]
        const fitNote = fit !== 'natural' ? (fit === 'accomplished' ? ' · acc.' : ' · awk.') : ''
        const role = showRoles?.[slot.id] ?? slot.position
        const name = p ? (p.name.length * NAME_CH <= room ? p.name : surname(p.name)) : ''
        const sub = (role + fitNote).length * SUB_CH <= room ? role : roleCodes?.[slot.id] ?? role
        return (
          <div key={slot.id} className={`slot${foot ? ' foot' : ''}`} style={{ left, top, '--room': `${Math.round(room)}px` } as CSSProperties} title={p ? `${p.name} · ${role}${fitNote}${rated && !hideRatings ? ` · ${slotRatingLine(rated, slot.position)}` : ''}` : undefined} onClick={() => onSlotClick?.(slot.id)} role={onSlotClick ? 'button' : 'img'} tabIndex={onSlotClick ? 0 : undefined} aria-label={`${slot.position} ${p ? `${p.name}${rated && !hideRatings ? `, ${slotRatingLine(rated, slot.position)}` : ''}` : 'empty'}`} onKeyDown={(e) => { if (onSlotClick && isActivationKey(e.key)) { e.preventDefault(); onSlotClick(slot.id) } }}>
            <div className={`disc ${p ? '' : 'empty'} ${eligible ? 'eligible' : ''} ${selectedSlot === slot.id ? 'selected' : ''} ${warn ? 'flag-warn' : ''}${p && !hideRatings && id === revealId ? ' reveal' : ''}`} style={ring ? { borderColor: ring } : undefined}>
              {p ? (hideRatings ? '?' : eff) : slot.position}
              {/* Out of position: the cost against his overall, so 84 here and 89 on his card read as one number */}
              {rated && !hideRatings && rated.cost > 0 && (
                <span className="disc-cost" style={{ borderColor: fit === 'accomplished' ? FIT_AMBER : FIT_RED }} aria-hidden="true" data-testid="disc-cost">
                  −{rated.cost}
                </span>
              )}
            </div>
            <div className="label">{name}</div>
            {p && (
              <div className="sub">
                {sub}
                {fitNote}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The one-line key under the pitch (the Key toggle): what the disc number and its ring colours mean. */
export function PitchLegend() {
  return (
    <div className="pitch-legend" data-testid="pitch-legend">
      <span>Disc: rating in that slot · −N: out-of-position cost against his overall</span>
      <span>
        <i className="ring" /> natural
      </span>
      <span>
        <i className="ring" style={{ borderColor: FIT_AMBER }} /> acc. small cost
      </span>
      <span>
        <i className="ring" style={{ borderColor: FIT_RED }} /> awk. big cost
      </span>
      <span>
        <i className="ring" style={{ borderColor: 'var(--danger)' }} /> injured or suspended
      </span>
    </div>
  )
}
