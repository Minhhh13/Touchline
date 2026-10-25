/**
 * A side's XI on a pitch standing up, attacking up for both sides as Football
 * Manager draws it: a shirt with the number, the live rating, the role code and
 * the surname, card marks, a sub arrow on a changed slot and a greyed slot for a
 * man sent off or injured with nobody to replace him. Click a man for his heat map.
 */
import { getFormation } from '@engine/formations'
import { tacticsAt } from '@engine/matchFeed'
import { roleCode, surname } from '../../match/shirts'
import { slotPoint } from '../../match/pitchGeometry'
import { Shirt } from '../Shirt'
import { VerticalPitch, upright } from '../VerticalPitch'
import { CardIcon, OnArrow } from '../icons'
import { slotViews } from '../model'
import type { PanelProps } from '../types'
import { RatingPill, TeamCode } from './bits'

export function FormationPanel({ d, side }: PanelProps & { side: 'home' | 'away' }) {
  const fs = side === 'home' ? d.feed.home : d.feed.away
  const view = side === 'home' ? d.home : d.away
  const minute = Math.max(0, d.minute)
  const tactics = tacticsAt(d.feed, side, minute + 1)
  const formation = getFormation(tactics.formationId)
  const slots = slotViews(formation, fs.appearances, d.feed.events, minute)
  return (
    <section className="md-panel md-formation" aria-label={`${view.name} formation`}>
      <header className="md-panel-head">
        <TeamCode view={view} />
        <b>{formation.name}</b>
        <span className="muted">in possession</span>
      </header>
      <VerticalPitch label={`${view.name} in a ${formation.name}`}>
        {slots.map((s) => {
          const slot = formation.slots.find((x) => x.id === s.slotId)!
          // Both sides drawn attacking up, from the side's own point of view
          const pt = slotPoint(slot, tactics, 'home')
          const { left, top } = upright(pt.x, pt.y)
          const name = s.psId ? d.getName(s.psId) : undefined
          const rating = s.psId ? d.ratings[s.psId] : undefined
          const selected = !!s.psId && d.selected === s.psId
          return (
            <button
              key={s.slotId}
              type="button"
              className={`md-man ${s.out ? 'out' : ''} ${selected ? 'selected' : ''}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => s.psId && d.select(s.psId)}
              disabled={!s.psId}
              aria-pressed={selected}
              title={`${name ?? 'Empty'}${s.subbedOn ? `, on ${s.onAt}'` : ''}`}
            >
              <span className="md-man-shirt">
                <Shirt colour={s.position === 'GK' ? view.keeper : view.colour} number={s.psId ? view.numbers[s.psId] : undefined} size={24} dim={s.out} />
                {s.subbedOn && (
                  <span className="md-man-sub">
                    <OnArrow />
                  </span>
                )}
                {(s.yellow || s.red) && (
                  <span className="md-man-card">
                    <CardIcon red={s.red} />
                  </span>
                )}
                <RatingPill value={rating} />
              </span>
              <span className="md-man-name">
                <span className="md-role">{roleCode(tactics, s.slotId, s.position)}</span> {surname(name)}
              </span>
            </button>
          )
        })}
      </VerticalPitch>
    </section>
  )
}
