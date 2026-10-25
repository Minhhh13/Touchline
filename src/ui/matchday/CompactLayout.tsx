/**
 * The dashboard under 1200 px, stacked: the pitch first (standing up on a
 * phone), the stop panel under it, the commentary, an always-on pulse row
 * (momentum and the xG graph story), then the panels one under another and
 * our XI. A first, simple version: the phone tab strip replaces the stack.
 */
import type { ReactNode } from 'react'
import { XgStory } from './panels/XgStory'
import { FormationPanel } from './panels/FormationPanel'
import { MatchStats } from './panels/feedPanels'
import type { MatchdayData } from './types'
import { SLOT_IDS, type SlotChoices, type SlotId } from './widgets'

export function CompactLayout({ d, crumb, top, pitch, stop, banner, momentum, slots, slot, strip }: { d: MatchdayData; crumb: ReactNode; top: ReactNode; pitch: ReactNode; stop: ReactNode; banner: ReactNode; momentum: ReactNode; slots: SlotChoices; slot: (id: SlotId) => ReactNode; strip: ReactNode }) {
  // The pulse row already shows the xG graph story; a slot holding it would show it twice
  const shown = SLOT_IDS.filter((s) => slots[s] !== 'xg-story' && slots[s] !== 'match-stats')
  return (
    <div className="matchday compact">
      {crumb}
      {top}
      <div className="md-pitch">{pitch}</div>
      {stop}
      {banner}
      <div className="md-pulse">
        {momentum}
        <XgStory story={d.story} events={d.feed.events} minute={d.minute} span={Math.max(95, d.feed.lastMinute)} home={d.home} away={d.away} dense />
      </div>
      <section className="md-panel" aria-label="Match stats">
        <header className="md-panel-head">
          <b>Match stats</b>
        </header>
        <div className="md-slot-body">
          <MatchStats d={d} compact />
        </div>
      </section>
      <div className="md-stack">{shown.map(slot)}</div>
      <div className="md-two">
        <FormationPanel d={d} side="home" />
        <FormationPanel d={d} side="away" />
      </div>
      <div className="md-strip-scroll">{strip}</div>
    </div>
  )
}
