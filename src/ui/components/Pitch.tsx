import type { Formation, PlayerSeason, SquadPlayer } from '@engine/types'
import { describeFit } from '@engine/positions'
import { discRating } from '@game/logic/slotSheet'
import { FIT_AMBER, FIT_RED, fitRingColour } from '../format'

export interface PitchProps {
  formation: Formation
  lineup: Record<string, string>
  getPlayer: (id: string) => PlayerSeason | undefined
  getState?: (id: string) => SquadPlayer | undefined
  onSlotClick?: (slotId: string) => void
  selectedSlot?: string | null
  eligibleSlots?: string[]
  hideRatings?: boolean
  showRoles?: Record<string, string>
}

export function Pitch({ formation, lineup, getPlayer, getState, onSlotClick, selectedSlot, eligibleSlots, hideRatings, showRoles }: PitchProps) {
  return (
    <div className="pitch-wrap" role="group" aria-label="Formation">
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
        // The slot picker lists the same number (discRating), so the sheet and the disc agree
        const eff = p ? discRating(p, slot.position) : 0
        // Accomplished is a small out-of-position cost (amber, acc.); awkward or worse a big one (red, awk.)
        const fit = p ? describeFit(p, slot.position) : 'natural'
        // The fit colour gives way to the injured/suspended red ring and the selected/eligible highlights; the label still names the fit
        const ring = p ? fitRingColour(fit, { warn, highlighted: !!eligible || selectedSlot === slot.id }) : undefined
        // y is from own goal (bottom) to opposition goal (top)
        const left = `${slot.x}%`
        const top = `${100 - slot.y}%`
        return (
          <div key={slot.id} className="slot" style={{ left, top }} onClick={() => onSlotClick?.(slot.id)} role="button" tabIndex={0} aria-label={`${slot.position} ${p ? p.name : 'empty'}`} onKeyDown={(e) => e.key === 'Enter' && onSlotClick?.(slot.id)}>
            <div className={`disc ${p ? '' : 'empty'} ${eligible ? 'eligible' : ''} ${selectedSlot === slot.id ? 'selected' : ''} ${warn ? 'flag-warn' : ''}`} style={ring ? { borderColor: ring } : undefined}>
              {p ? (hideRatings ? '?' : eff) : slot.position}
            </div>
            <div className="label">{p ? p.name : ''}</div>
            {p && <div className="sub">{showRoles?.[slot.id] ?? slot.position}{fit !== 'natural' ? (fit === 'accomplished' ? ' · acc.' : ' · awk.') : ''}</div>}
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
      <span>Disc: rating in that slot</span>
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
