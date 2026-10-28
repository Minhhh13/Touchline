import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Formation, PlayerSeason, SquadPlayer } from '@engine/types'
import { describeFit } from '@engine/positions'
import { slotRating, slotRatingLine } from '@game/logic/slotRating'
import { FIT_AMBER, FIT_RED, fitRingColour } from '../format'
import { surname } from '../match/shirts'
import { MAT, labelFont, labelRooms } from '../match/pitchLabels'
import { roleCodeByName, roleLine } from '../match/roleNames'
import { forgetWidths, textWidth } from '../match/textWidth'
import { isActivationKey } from '../a11y'
import { translator } from '../i18n'
import { draft } from '../i18n/en/draft'

const t = translator(draft)

/** The widest a slot's label may be, and what it falls back to before the pitch is measured. */
const LABEL_MAX = 110
const PITCH_GUESS = 300

/** Each slot's label room in px: clear of every neighbour's disc and label, and the touchline (pitchLabels.ts). */
function slotRooms(formation: Formation, width: number, roles: boolean): Record<string, number> {
  return labelRooms(formation.slots.map((sl) => ({ id: sl.id, x: sl.x, y: sl.y, foot: sl.y <= 10 })), width, LABEL_MAX, roles)
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
  /** The player who has just been placed (any pick landing): his disc pops in once. Presentation only. */
  landedId?: string | null
  showRoles?: Record<string, string>
  /** Codes for `showRoles` (the last resort when neither the full role nor its short name fits the slot); the full one is in the tooltip. */
  roleCodes?: Record<string, string>
}

export function Pitch({ formation, lineup, getPlayer, getState, onSlotClick, selectedSlot, eligibleSlots, hideRatings, revealId, landedId, showRoles, roleCodes }: PitchProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(PITCH_GUESS)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(Math.round(el.getBoundingClientRect().width) || PITCH_GUESS))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The labels are measured in the web font: once it has loaded, measure again
  const [, setFace] = useState(0)
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => {
      if (!live) return
      forgetWidths()
      setFace((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [])
  const roles = !!showRoles
  const rooms = useMemo(() => slotRooms(formation, width, roles), [formation, width, roles])
  // The labels' type is 10px on a small pitch, 11px otherwise
  const font = labelFont(width - MAT * 2)
  return (
    <div className={`pitch-wrap${roles ? ' has-roles' : ''}`} role="group" aria-label={t('formation')} ref={ref}>
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
        const fitNote = fit !== 'natural' ? t(fit === 'accomplished' ? 'fitAcc' : 'fitAwk') : ''
        const role = showRoles?.[slot.id] ?? slot.position
        const name = p ? (textWidth(p.name, font) <= room - 1 ? p.name : surname(p.name)) : ''
        // The role line: the full role when it fits, else its short name ("Inside" for "Inside Forward"), else the code
        const sub = roleLine(role, (text) => textWidth(text, font) <= room, fitNote, roleCodes?.[slot.id] ?? roleCodeByName(role))
        const label = `${slot.position} ${p ? `${p.name}${rated && !hideRatings ? `, ${slotRatingLine(rated, slot.position)}` : ''}` : t('empty')}`
        return (
          // A pressable pitch makes the disc the button (its target never overlaps a team-mate's label room, WCAG 2.5.8);
          // a tap on the name still lands on the slot. A read-only pitch is one labelled picture per slot
          <div key={slot.id} className={`slot${foot ? ' foot' : ''}`} style={{ left, top, '--room': `${Math.round(room)}px` } as CSSProperties} title={p ? `${p.name} · ${role}${fitNote}${rated && !hideRatings ? ` · ${slotRatingLine(rated, slot.position)}` : ''}` : undefined} onClick={() => onSlotClick?.(slot.id)} role={onSlotClick ? undefined : 'img'} aria-label={onSlotClick ? undefined : label}>
            <div className={`disc ${p ? '' : 'empty'} ${eligible ? 'eligible' : ''} ${selectedSlot === slot.id ? 'selected' : ''} ${warn ? 'flag-warn' : ''}${p && !hideRatings && id === revealId ? ' reveal' : p && id === landedId ? ' landed' : ''}`} style={ring ? { borderColor: ring } : undefined} role={onSlotClick ? 'button' : undefined} tabIndex={onSlotClick ? 0 : undefined} aria-label={onSlotClick ? label : undefined} onKeyDown={onSlotClick ? (e) => { if (isActivationKey(e.key)) { e.preventDefault(); onSlotClick(slot.id) } } : undefined}>
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
      <span>{t('legendDisc')}</span>
      <span>
        <i className="ring" /> {t('legendNatural')}
      </span>
      <span>
        <i className="ring" style={{ borderColor: FIT_AMBER }} /> {t('legendAcc')}
      </span>
      <span>
        <i className="ring" style={{ borderColor: FIT_RED }} /> {t('legendAwk')}
      </span>
      <span>
        <i className="ring" style={{ borderColor: 'var(--danger)' }} /> {t('legendOut')}
      </span>
    </div>
  )
}
