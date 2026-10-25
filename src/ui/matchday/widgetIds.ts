/**
 * The dashboard's widgets and slots, without React: ids and labels, the slot
 * defaults (a friendly has no table and no other scores), and the per-browser
 * choices, read and written inside try/catch and validated against the ids.
 * Choices never go into the save.
 */

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

export const WIDGETS: WidgetMeta[] = [
  { id: 'match-events', label: 'Match events' },
  { id: 'commentary', label: 'Commentary' },
  { id: 'heat-map', label: 'Heat map' },
  { id: 'average-positions', label: 'Average positions' },
  { id: 'pass-maps', label: 'Pass maps' },
  { id: 'action-zones', label: 'Action zones' },
  { id: 'shot-map', label: 'Shot map' },
  { id: 'xg-story', label: 'xG graph story' },
  { id: 'match-momentum', label: 'Match momentum' },
  { id: 'match-stats', label: 'Match stats' },
  { id: 'latest-scores', label: 'Latest scores' },
  { id: 'live-table', label: 'Live table' },
  { id: 'dugout', label: 'Dugout' },
  { id: 'matchday-info', label: 'Matchday info' },
  { id: 'formations', label: 'Line-ups', phoneOnly: true },
]

export const WIDGET_LABEL: Record<WidgetId, string> = Object.fromEntries(WIDGETS.map((w) => [w.id, w.label])) as Record<WidgetId, string>

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
