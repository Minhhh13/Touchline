/*
 * The Boxes control, without React: which boxes of a screen the viewer has switched off, read and written per screen
 * in its own localStorage key (inside try/catch, never the save), which boxes show, and the grid columns the boxes
 * that are left take. Display only: nothing here reaches the game, the seed or online sync.
 */

export interface BoxDef {
  id: string
  label: string
}

/** One screen's (or one tab's) hideable boxes. Essential controls are never listed. */
export interface BoxSet {
  /** The storage name: the key is `touchline-boxes-<screen>`. */
  screen: string
  /** The group's heading in the checklist. */
  title: string
  boxes: readonly BoxDef[]
  /** How many of the boxes on the page must stay on (default 1; 0 when an essential box always stays). */
  min?: number
}

export const BOXES_PREFIX = 'touchline-boxes-'

export function boxesKey(screen: string): string {
  return `${BOXES_PREFIX}${screen}`
}

/** The stored hidden ids that belong to the set, once each and in the set's order; anything else reads as nothing hidden. */
export function parseHidden(raw: string | null | undefined, set: BoxSet): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const ids = new Set(parsed.filter((v): v is string => typeof v === 'string'))
  return set.boxes.filter((b) => ids.has(b.id)).map((b) => b.id)
}

export function serialiseHidden(hidden: readonly string[]): string {
  return JSON.stringify([...new Set(hidden)])
}

/** The boxes on the page right now (a box that only some games have, such as Done deals, is listed only when it is there). */
export function presentBoxes(set: BoxSet, present?: readonly string[]): BoxDef[] {
  return present ? set.boxes.filter((b) => present.includes(b.id)) : [...set.boxes]
}

/**
 * The boxes that show: every present box not hidden, and never fewer than the set's minimum (the first hidden boxes
 * come back, in order, when a stored choice would leave too few, say after a box the viewer kept stopped existing).
 */
export function visibleIds(set: BoxSet, hidden: readonly string[], present?: readonly string[]): string[] {
  const boxes = presentBoxes(set, present)
  const min = Math.min(set.min ?? 1, boxes.length)
  const off = new Set(hidden)
  const on = boxes.filter((b) => !off.has(b.id)).map((b) => b.id)
  for (const b of boxes) {
    if (on.length >= min) break
    if (!on.includes(b.id)) on.push(b.id)
  }
  return boxes.filter((b) => on.includes(b.id)).map((b) => b.id)
}

/** Whether switching this box off would still leave the minimum on. */
export function canHide(set: BoxSet, hidden: readonly string[], id: string, present?: readonly string[]): boolean {
  const on = visibleIds(set, hidden, present)
  if (!on.includes(id)) return false
  return on.length - 1 >= Math.min(set.min ?? 1, presentBoxes(set, present).length)
}

/** The hidden list after a tick or untick; unticking the last box that must stay changes nothing. */
export function toggleBox(set: BoxSet, hidden: readonly string[], id: string, present?: readonly string[]): string[] {
  if (!set.boxes.some((b) => b.id === id)) return [...hidden]
  if (hidden.includes(id)) return hidden.filter((h) => h !== id)
  if (!canHide(set, hidden, id, present)) return [...hidden]
  return set.boxes.filter((b) => b.id === id || hidden.includes(b.id)).map((b) => b.id)
}

/**
 * A grid column: its track as the screen's CSS writes it, and the boxes inside it (the column shows while any of them
 * does). A column with no ids holds something that always stays (a notice, an essential control) and always shows.
 */
export interface GridCol {
  track: string
  ids: readonly string[]
}

const FLEX = /fr\b/

/**
 * The columns the visible boxes take. Nothing hidden: `null`, so the screen's own CSS stands exactly as it is. Otherwise
 * the shown columns' tracks; when every one left is a fixed width (a 380 px side column without its 1fr neighbour), they
 * share the row equally instead, so the freed width goes to the boxes that are left.
 */
export function gridTemplate(cols: readonly GridCol[], visible: readonly string[]): { template: string | null; count: number } {
  const shown = cols.filter((c) => c.ids.length === 0 || c.ids.some((id) => visible.includes(id)))
  if (shown.length === cols.length) return { template: null, count: shown.length }
  if (shown.length === 0) return { template: null, count: 0 }
  const flexible = shown.some((c) => FLEX.test(c.track))
  const tracks = shown.map((c) => (flexible ? c.track : 'minmax(0, 1fr)'))
  return { template: tracks.join(' '), count: shown.length }
}

/** Minimal storage, so tests can pass their own. */
export interface BoxStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): BoxStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readHidden(set: BoxSet, storage: BoxStorage | null = browserStorage()): string[] {
  try {
    return parseHidden(storage?.getItem(boxesKey(set.screen)), set)
  } catch {
    return []
  }
}

/** Remember the hidden boxes; nothing hidden removes the key. Storage that throws (a private window) is ignored. */
export function writeHidden(set: BoxSet, hidden: readonly string[], storage: BoxStorage | null = browserStorage()): void {
  try {
    if (hidden.length === 0) storage?.removeItem(boxesKey(set.screen))
    else storage?.setItem(boxesKey(set.screen), serialiseHidden(hidden))
  } catch {
    // Not remembered: the choice lasts for this page load
  }
}

/** Where the checklist opens: fixed to the window (never clipped by a box that scrolls), under the button or over it. */
export interface PopPlace {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/**
 * The checklist's place for a button at `rect` in a `vw` by `vh` window: right-aligned to the button and kept inside the
 * gutters; below it when there is room for `want` px (or more room below than above), else above it.
 */
export function popPlacement(rect: { top: number; bottom: number; right: number }, vw: number, vh: number, want = 320, gutter = 16, gap = 6): PopPlace {
  const width = Math.max(160, Math.min(280, vw - 2 * gutter))
  const left = Math.round(Math.min(Math.max(gutter, rect.right - width), Math.max(gutter, vw - gutter - width)))
  const below = vh - rect.bottom - gap - gutter
  const above = rect.top - gap - gutter
  if (below >= want || below >= above) return { left, width, top: Math.round(rect.bottom + gap), maxHeight: Math.max(120, Math.round(below)) }
  return { left, width, bottom: Math.round(vh - rect.top + gap), maxHeight: Math.max(120, Math.round(above)) }
}
