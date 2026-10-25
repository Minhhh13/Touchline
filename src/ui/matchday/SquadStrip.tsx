/**
 * Our XI along the bottom: the Squad counters, then one card per starting
 * slot with the position code, the shirt and number, the surname, the live
 * condition, the rating, card marks and a sub arrow with the minute. Tap a
 * card to follow the man in the heat map. The substitution flow plugs in here
 * (`control`).
 */
import { getFormation } from '@engine/formations'
import { MAX_SUBS, MAX_WINDOWS } from '@engine/match'
import { tacticsAt } from '@engine/matchFeed'
import { liveCondition } from '@engine/liveRatings'
import { useStore } from '@game/store'
import { playerLookup } from '@game/logic/players'
import { conditionColour, minuteLabel } from '../format'
import { positionCode, surname } from '../match/shirts'
import { Shirt } from './Shirt'
import { CardIcon, OnArrow } from './icons'
import { slotViews } from './model'
import { RatingPill } from './panels/bits'
import type { SquadStripProps } from './types'

export function SquadStrip({ feed, minute, side, view, ratings, squad, selected, onSelect, control }: SquadStripProps) {
  const u = useStore((s) => s.universe)
  const game = useStore((s) => s.game)
  const get = u && game ? playerLookup(game, u) : () => undefined
  const fs = side === 'home' ? feed.home : feed.away
  const tactics = tacticsAt(feed, side, Math.max(0, minute) + 1)
  const formation = getFormation(tactics.formationId)
  const slots = slotViews(formation, fs.appearances, feed.events, Math.max(0, minute))
  const made = fs.subs.filter((s) => s.minute <= minute).length
  return (
    <div className="md-strip" aria-label={`${view.name} on the pitch`}>
      <div className="md-strip-squad">
        <b>Squad</b>
        <span className="mono">
          {MAX_SUBS - made}/{MAX_SUBS} subs
        </span>
        {control && (
          <span className="mono">
            {control.windowsLeft}/{MAX_WINDOWS} stoppages
          </span>
        )}
      </div>
      {slots.map((s) => {
        if (!s.psId) return null
        const name = get(s.psId)?.name
        const start = squad[s.psId]?.condition
        // Condition moves only in play: a finished match has already taken it off
        const cond = feed.source === 'live' && start !== undefined ? liveCondition(feed, side, s.psId, minute, start, get) : null
        return (
          <button key={s.slotId} type="button" className={`md-card ${s.out ? 'out' : ''} ${selected === s.psId ? 'selected' : ''}`} onClick={() => onSelect(s.psId!)} aria-pressed={selected === s.psId}>
            <span className="md-card-top">
              <span className="md-pos">{positionCode(formation, s.slotId)}</span>
              {(s.yellow || s.red) && <CardIcon red={s.red} />}
              {s.subbedOn && (
                <span className="md-card-sub mono">
                  <OnArrow />
                  {minuteLabel(s.onAt)}
                </span>
              )}
            </span>
            <Shirt colour={s.position === 'GK' ? view.keeper : view.colour} number={view.numbers[s.psId]} size={28} dim={s.out} />
            <span className="md-card-name">{surname(name)}</span>
            <span className="md-card-foot">
              {cond !== null ? (
                <span className="md-cond" title={`Condition ${cond}%`}>
                  <span style={{ width: `${Math.max(0, Math.min(100, cond))}%`, background: conditionColour(cond) }} />
                </span>
              ) : (
                <span />
              )}
              <RatingPill value={ratings[s.psId]} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
