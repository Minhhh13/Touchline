/**
 * The widget registry: every widget id to its panel, and a slot with its
 * header dropdown. Ids, labels, defaults and the remembered choices live in
 * widgetIds.ts (pure, tested).
 */
import type { ComponentType } from 'react'
import { FormationPanel } from './panels/FormationPanel'
import { CommentaryList, Dugout, MatchEvents, MatchStats, MomentumWidget } from './panels/feedPanels'
import { ActionZones, AveragePositions, HeatMap, PassMaps, ShotMapWidget } from './panels/mapPanels'
import { LatestScores, LiveTable, MatchdayInfo } from './panels/roundPanels'
import { XgStory } from './panels/XgStory'
import type { PanelProps } from './types'
import { SLOT_WIDGETS, WIDGET_LABEL, type SlotId, type WidgetId } from './widgetIds'

export { MATCHDAY_COMPACT, SLOT_IDS, WIDGETS, defaultSlots, matchdayBoxes, readChoices, resolveSlots, writeChoice } from './widgetIds'
export type { SlotChoices, SlotId, WidgetId } from './widgetIds'

function XgStoryWidget({ d, compact }: PanelProps) {
  return <XgStory story={d.story} events={d.feed.events} minute={d.minute} span={Math.max(95, d.feed.lastMinute)} home={d.home} away={d.away} dense={compact} bare fill={!compact} />
}

function Formations({ d }: PanelProps) {
  return (
    <div className="md-two">
      <FormationPanel d={d} side="home" />
      <FormationPanel d={d} side="away" />
    </div>
  )
}

export const WIDGET_COMPONENT: Record<WidgetId, ComponentType<PanelProps>> = {
  'match-events': MatchEvents,
  commentary: CommentaryList,
  'heat-map': HeatMap,
  'average-positions': AveragePositions,
  'pass-maps': PassMaps,
  'action-zones': ActionZones,
  'shot-map': ShotMapWidget,
  'xg-story': XgStoryWidget,
  'match-momentum': MomentumWidget,
  'match-stats': MatchStats,
  'latest-scores': LatestScores,
  'live-table': LiveTable,
  dugout: Dugout,
  'matchday-info': MatchdayInfo,
  formations: Formations,
}

/** A slot: a header whose dropdown switches the widget, and the widget. */
export function Slot({ slot, id, onChange, d, compact }: PanelProps & { slot: SlotId; id: WidgetId; onChange: (id: WidgetId) => void }) {
  const Widget = WIDGET_COMPONENT[id]
  return (
    <section className={`md-panel md-slot slot-${slot}`} data-widget={id} aria-label={WIDGET_LABEL[id]}>
      <header className="md-panel-head">
        <label className="md-slot-pick">
          <span className="sr-only">Panel {slot}</span>
          <select className="md-select" value={id} onChange={(e) => onChange(e.target.value as WidgetId)}>
            {SLOT_WIDGETS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="md-slot-body">
        <Widget d={d} compact={compact} />
      </div>
    </section>
  )
}
