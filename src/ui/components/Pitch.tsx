import type { Formation, PlayerSeason, SquadPlayer } from '@engine/types'
import { positionFactor } from '@engine/positions'

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
        const pf = p ? positionFactor(p, slot.position) : 1
        const eff = p ? Math.round(p.overall * pf) : 0
        // y is from own goal (bottom) to opposition goal (top)
        const left = `${slot.x}%`
        const top = `${100 - slot.y}%`
        return (
          <div key={slot.id} className="slot" style={{ left, top }} onClick={() => onSlotClick?.(slot.id)} role="button" tabIndex={0} aria-label={`${slot.position} ${p ? p.name : 'empty'}`} onKeyDown={(e) => e.key === 'Enter' && onSlotClick?.(slot.id)}>
            <div className={`disc ${p ? '' : 'empty'} ${eligible ? 'eligible' : ''} ${selectedSlot === slot.id ? 'selected' : ''} ${warn ? 'flag-warn' : ''}`} style={p && pf < 1 ? { borderColor: pf >= 0.86 ? 'var(--gold)' : 'var(--pitch-bad)' } : undefined}>
              {p ? (hideRatings ? '?' : eff) : slot.position}
            </div>
            <div className="label">{p ? p.name : ''}</div>
            {p && <div className="sub">{showRoles?.[slot.id] ?? slot.position}{pf < 1 ? ' ·' : ''}{pf < 1 ? (pf >= 0.86 ? ' acc.' : ' awk.') : ''}</div>}
          </div>
        )
      })}
    </div>
  )
}
