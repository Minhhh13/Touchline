/**
 * The dashboard's widgets and slots, without React: ids and labels, the slot
 * defaults (a friendly has no table and no other scores), and the per-browser
 * choices, read and written inside try/catch and validated against the ids.
 * Choices never go into the save.
 */
import type { BoxSet } from '../boxes'
import { translator } from '../i18n'
import { match } from '../i18n/en/match'

const t = translator(match)

export const WIDGET_IDS = [
  'match-events',
  'commentary',
  'heat-map',
  'average-positions',
  'pass-maps',
  'action-zones',
  'shot-map',
  'xg-story',
  'match-momentum',
  'match-stats',
  'latest-scores',
  'live-table',
  'dugout',
  'matchday-info',
  'formations',
] as const

export type WidgetId = (typeof WIDGET_IDS)[number]

export interface WidgetMeta {
  id: WidgetId
  label: string
  /** Shown only in the phone tab strip (the desktop has both formation panels already). */
  phoneOnly?: boolean
}

/** A widget's label, read through `t()` each time it is shown (a language switch remounts the screen). */
const widget = (id: WidgetId, phoneOnly?: boolean): WidgetMeta => ({
  id,
  get label() {
    return t(`widget_${id}`)
  },
  ...(phoneOnly ? { phoneOnly } : {}),
})

export const WIDGETS: WidgetMeta[] = [
  widget('match-events'),
  widget('commentary'),
  widget('heat-map'),
  widget('average-positions'),
  widget('pass-maps'),
  widget('action-zones'),
  widget('shot-map'),
  widget('xg-story'),
  widget('match-momentum'),
  widget('match-stats'),
  widget('latest-scores'),
  widget('live-table'),
  widget('dugout'),
  widget('matchday-info'),
  widget('formations', true),
]

/** Each widget's label, read at the moment it is shown. */
export const WIDGET_LABEL = {} as Record<WidgetId, string>
for (const w of WIDGETS) Object.defineProperty(WIDGET_LABEL, w.id, { get: () => w.label, enumerable: true })

/** The widgets a desktop slot can hold. */
export const SLOT_WIDGETS: WidgetMeta[] = WIDGETS.filter((w) => !w.phoneOnly)

export const SLOT_IDS = ['A', 'B', 'C', 'L', 'R'] as const
export type SlotId = (typeof SLOT_IDS)[number]
export type SlotChoices = Record<SlotId, WidgetId>

export const STORAGE_KEY = 'touchline-matchday-widgets'

/** Slots A, B, C over the pitch; L under the home formation; R under the away formation. */
export function defaultSlots(friendly: boolean): SlotChoices {
  return { A: 'heat-map', B: 'match-events', C: 'xg-story', L: friendly ? 'matchday-info' : 'live-table', R: friendly ? 'dugout' : 'latest-scores' }
}

export function isSlotWidget(v: unknown): v is WidgetId {
  return typeof v === 'string' && SLOT_WIDGETS.some((w) => w.id === v)
}

/** The stored choices that are valid, each slot on its own: anything unknown is dropped. */
export function parseChoices(raw: string | null | undefined): Partial<SlotChoices> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Partial<SlotChoices> = {}
  for (const slot of SLOT_IDS) {
    const v = (parsed as Record<string, unknown>)[slot]
    if (isSlotWidget(v)) out[slot] = v
  }
  return out
}

/** Minimal storage, so tests can pass their own. */
export interface ChoiceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): ChoiceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readChoices(storage: ChoiceStorage | null = browserStorage()): Partial<SlotChoices> {
  try {
    return parseChoices(storage?.getItem(STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Remember one slot's widget; storage that throws (a private window) is ignored. */
export function writeChoice(slot: SlotId, id: WidgetId, storage: ChoiceStorage | null = browserStorage()): void {
  if (!isSlotWidget(id)) return
  try {
    const next = { ...readChoices(storage), [slot]: id }
    storage?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Not remembered: the dashboard still works
  }
}

/** The widget in each slot: the remembered choice, else the default. */
export function resolveSlots(stored: Partial<SlotChoices>, friendly: boolean): SlotChoices {
  return { ...defaultSlots(friendly), ...stored }
}

/** Where each desktop slot sits, for the Boxes checklist. */
export const SLOT_PLACE: Record<SlotId, string> = { A: 'Top left', B: 'Top middle', C: 'Top right', L: 'Under our line-up', R: 'Under their line-up' }

/**
 * The dashboard's hideable boxes on a desktop, for the Boxes control (`components/Boxes.tsx`): both line-ups, the five
 * widget slots (each named with the widget it holds now), both stats flanks, the momentum strip and the commentary.
 * The top bar (score, clock, playback), the pitch, our XI strip and the stop panels always stay, so every box may go.
 * Ids are storage values (`touchline-boxes-matchday`): never rename one.
 */
export function matchdayBoxes(slots: SlotChoices): BoxSet {
  const slot = (id: SlotId) => ({ id: `slot-${id}`, label: `${SLOT_PLACE[id]}: ${WIDGET_LABEL[slots[id]]}` })
  return {
    screen: 'matchday',
    title: 'Match day',
    min: 0,
    boxes: [{ id: 'home-xi', label: 'Home line-up' }, slot('L'), slot('A'), slot('B'), slot('C'), { id: 'away-xi', label: 'Away line-up' }, slot('R'), { id: 'stats', label: 'Stats beside the pitch' }, { id: 'momentum', label: 'Momentum strip' }, { id: 'commentary', label: 'Commentary banner' }],
  }
}

/** Under 1200 px (the stacked board): the commentary, the pulse row and the panel tabs may go; the pitch and the strip stay. */
export const MATCHDAY_COMPACT: BoxSet = {
  screen: 'matchday-compact',
  title: 'Match day',
  min: 0,
  boxes: [
    { id: 'commentary', label: 'Commentary banner' },
    { id: 'pulse', label: 'Momentum and xG story' },
    { id: 'panels', label: 'Panel tabs' },
  ],
}
