/**
 * Our XI along the bottom, Football Manager style: the Squad control with the
 * substitutions and stoppages left (it opens the substitutions drawer), then
 * one card per starting slot with the position code, the shirt and number, the
 * surname, the live condition, the rating, morale, card marks and a sub arrow
 * with the minute. Tap a card to pick the man out on the live pitch and the formation panels (a ring, his name) and
 * to follow him in the heat map; tap it again to let him go. Keyboard focus previews him the same way.
 */
import { useEffect, useRef } from 'react'
import { getFormation } from '@engine/formations'
import { MAX_SUBS, MAX_WINDOWS } from '@engine/match'
import { tacticsAt } from '@engine/matchFeed'
import { minuteLabel } from '../format'
import { ConditionIcon } from './ConditionIcon'
import { staleFocus, stripCards } from './controls'
import { CardIcon, OnArrow, SubIcon } from './icons'
import { MoraleFace } from './MoraleFace'
import { RatingPill } from './panels/bits'
import { Shirt } from './Shirt'
import type { SquadStripProps } from './types'
import type { ManagerHand } from './useManagerHand'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'
import { B, rich } from '../i18n/rich'

const tx = translator(match)

export function SquadStrip({ feed, minute, side, view, ratings, squad, selected, onSelect, onFocusMan, hand, name, condition }: SquadStripProps & { hand: ManagerHand; name: (id: string) => string | undefined; condition: (psId: string) => number | null }) {
  const at = Math.max(0, minute)
  const fs = side === 'home' ? feed.home : feed.away
  const formation = getFormation(tacticsAt(feed, side, at + 1).formationId)
  const live = feed.source === 'live'
  // Morale is today's: a replay of an old match does not show it
  const cards = stripCards(feed, side, at, formation, { ratings, numbers: view.numbers, name, condition, morale: (id) => (live ? squad[id]?.morale : undefined) })
  // What the strip shows moves with the clock: changes decided ahead appear at their minute
  const made = fs.subs.filter((s) => s.minute <= at).length
  const subsLeft = MAX_SUBS - made
  // The keyboard's preview is cleared when its card goes without a blur: the man left the strip, or the strip itself
  // unmounted (the board switching layout at 1200 px under the focus)
  const focusedRef = useRef<string | null>(null)
  const onCards = cards.map((c) => c.psId)
  useEffect(() => {
    if (!staleFocus(focusedRef.current, onCards)) return
    focusedRef.current = null
    onFocusMan?.(null)
  })
  useEffect(
    () => () => {
      if (focusedRef.current) onFocusMan?.(null)
    },
    [onFocusMan],
  )
  const focusMan = (psId: string | null) => {
    focusedRef.current = psId
    onFocusMan?.(psId)
  }
  return (
    <div className="md-strip" role="group" aria-label={tx('onThePitch', { name: view.name })}>
      <button type="button" className="md-strip-squad" onClick={() => hand.open('subs')} disabled={!hand.editable} aria-haspopup="dialog" title={hand.editable ? tx('makeSub') : hand.landing.text}>
        <span className="md-strip-title">
          <SubIcon />
          <b>{tx('squad')}</b>
        </span>
        <span className="mono">
          {rich(tx('subsLeft', { n: subsLeft, max: MAX_SUBS }), B)}
        </span>
        {live && (
          <span className="mono">
            {rich(tx('stoppagesLeft', { n: hand.windowsLeft, max: MAX_WINDOWS }), B)}
          </span>
        )}
      </button>
      {cards.map((c) => {
        if (!c.psId) return null
        const psId = c.psId
        return (
          <button
            key={c.slotId}
            type="button"
            className={`md-card ${c.out ? 'out' : ''} ${selected === psId ? 'selected' : ''}`}
            onClick={() => onSelect(psId)}
            // Keyboard focus previews him on the pitch; a click's focus does not (the click selects him instead)
            onFocus={(e) => e.currentTarget.matches(':focus-visible') && focusMan(psId)}
            onBlur={() => focusMan(null)}
            data-testid="md-card"
            aria-pressed={selected === psId} aria-label={`${tx('stripCard', { pos: c.pos, name: name(psId) ?? c.name })}${c.rating !== undefined ? tx('cardRating', { r: c.rating.toFixed(1) }) : ''}${c.subMinute !== null ? tx('cardOn', { m: c.subMinute }) : ''}`}>
            <span className="md-card-top">
              <span className="md-pos">{c.pos}</span>
              {(c.yellow || c.red) && <CardIcon red={c.red} />}
              {c.subMinute !== null && (
                <span className="md-card-sub mono">
                  <OnArrow />
                  {minuteLabel(c.subMinute)}
                </span>
              )}
            </span>
            <span className="md-card-mid">
              <Shirt colour={c.keeper ? view.keeper : view.colour} number={c.number} size={28} dim={c.out} />
              <span className="md-card-icons">
                {c.condition !== null && <ConditionIcon value={c.condition} />}
                {c.morale !== null && <MoraleFace value={c.morale} />}
              </span>
            </span>
            <span className="md-card-name">{c.name}</span>
            <span className="md-card-foot">
              <RatingPill value={c.rating} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
