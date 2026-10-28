/**
 * A side's XI on a pitch standing up, attacking up for both sides as Football
 * Manager draws it: a shirt with the number, the live rating, the role code and
 * the surname, card marks, a sub arrow on a changed slot and a greyed slot for a
 * man sent off or injured with nobody to replace him. Click a man for his heat map.
 */
import type { CSSProperties } from 'react'
import { getFormation } from '@engine/formations'
import { tacticsAt } from '@engine/matchFeed'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { roleCode, surname } from '../../match/shirts'
import { Shirt } from '../Shirt'
import { VerticalPitch } from '../VerticalPitch'
import { CardIcon, OnArrow } from '../icons'
import { labelRoom, panelPoints, slotViews } from '../model'
import type { PanelProps } from '../types'
import { RatingPill, TeamCode } from './bits'
import { translator } from '../../i18n'
import { match } from '../../i18n/en/match'

const tx = translator(match)

export function FormationPanel({ d, side }: PanelProps & { side: 'home' | 'away' }) {
  const fs = side === 'home' ? d.feed.home : d.feed.away
  const view = side === 'home' ? d.home : d.away
  const minute = Math.max(0, d.minute)
  const tactics = tacticsAt(d.feed, side, minute + 1)
  const formation = getFormation(tactics.formationId)
  const slots = slotViews(formation, fs.appearances, d.feed.events, minute)
  // In slot order, as slotViews lists them
  const points = panelPoints(formation, tactics)
  const room = labelRoom(points)
  return (
    <section className="md-panel md-formation" aria-label={tx('formationOf', { name: view.name })}>
      <header className="md-panel-head">
        <TeamCode view={view} />
        <b>{formation.name}</b>
        <span className="muted">{tx('inPossessionLower')}</span>
      </header>
      <VerticalPitch label={tx('inA', { name: view.name, formation: formation.name })}>
        {slots.map((s, i) => {
          const { left, top } = points[i]
          const gap = room[s.slotId]
          const name = s.psId ? d.getName(s.psId) : undefined
          const rating = s.psId ? d.ratings[s.psId] : undefined
          const selected = !!s.psId && d.selected === s.psId
          // Picked out from the squad strip (selected, or the keyboard's preview): a ring on his shirt
          const lit = !!s.psId && d.highlight === s.psId
          return (
            <button
              key={s.slotId}
              type="button"
              className={`md-man ${s.out ? 'out' : ''} ${selected ? 'selected' : ''} ${lit ? 'lit' : ''}`}
              data-lit={lit ? 'yes' : undefined}
              // His place as per cent of the layer, moved by transform (`--x`, `--y`, matchday.css), so a change of shape glides without a reflow
              style={{ '--x': left.toFixed(2), '--y': top.toFixed(2), '--md-name-max': gap === null ? undefined : `min(76px, calc(${gap.toFixed(1)}cqw - 4px))` } as CSSProperties}
              onClick={() => s.psId && d.select(s.psId)}
              disabled={!s.psId}
              aria-pressed={selected}
              title={`${name ?? tx('emptySlot')} · ${getRole(tactics.roles[s.slotId] ?? DEFAULT_ROLE[s.position]).name}${rating === undefined ? '' : ` · ${rating.toFixed(1)}`}${s.subbedOn ? tx('cardOn', { m: s.onAt }) : ''}`}
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
