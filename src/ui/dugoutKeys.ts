import type { DugoutTab } from '@game/logic/briefing'

/**
 * The Dugout's keyboard: Space plays the matchweek, 1 to 9 and 0 open the first ten tabs, a tab's letter (`TAB_KEYS`)
 * opens it wherever it sits, A asks the assistant to pick the XI and R rests the tired starters (r8). Pure, so the
 * guards are tested: nothing fires while typing or on a focused control (Space would press it anyway), with a modal
 * open, or with a modifier held; Space waits while a decision is pending or the season is over. A tab of the strip is
 * the one control that lets them through (r10): digits and letters never operate a tab, and a tab clicked with the
 * mouse hands Space to Play (a mouse user never means Space to press a tab); a tab reached by the keyboard keeps Space.
 */
export type DugoutKey = { kind: 'play' } | { kind: 'tab'; index: number } | { kind: 'tabId'; id: DugoutTab } | { kind: 'autoPick' } | { kind: 'rest' } | null

/**
 * The Dugout's tabs in the order a manager works through the week (r10): the team and the next match, then what waits
 * on him (the Inbox, the Office), the people, the market, the season's competitions, and the numbers and the club last.
 * A tab the week does not have (Next match once the season is over, the Cup, Europe) is left out where it stands.
 */
export const DUGOUT_TAB_ORDER: readonly DugoutTab[] = ['squad', 'next', 'tactics', 'inbox', 'office', 'dressing', 'planner', 'market', 'fixtures', 'table', 'cup', 'europe', 'stats', 'club']

/** Each tab's letter (r10). A and R stay the assistant's: pick the XI, rest the tired. */
export const TAB_KEYS: Record<DugoutTab, string> = { squad: 'S', next: 'N', tactics: 'T', inbox: 'I', office: 'O', dressing: 'D', planner: 'P', market: 'M', fixtures: 'F', table: 'L', cup: 'C', europe: 'E', stats: 'H', club: 'B' }
const BY_LETTER = new Map(Object.entries(TAB_KEYS).map(([id, k]) => [k, id as DugoutTab]))

export interface DugoutKeyContext {
  /** The event's target is a field, a button or another control that handles the key itself. */
  onControl: boolean
  /** A modal, sheet or the digest is open over the Dugout. */
  modalOpen: boolean
  /** Ctrl, Cmd or Alt is held. */
  modifier: boolean
  /** Playing the week is allowed now (no pending decision, the season not over). */
  canPlay: boolean
  /** How many tabs the bar shows today. */
  tabs: number
  /** The team can be changed now (a season under way, not over): A and R work. Absent reads as no. */
  canManage?: boolean
  /** The target is a tab of the Dugout's strip: digits and letters still work. */
  onTab?: boolean
  /** That tab was focused by a click and the keyboard has not moved the focus since (`clickedTabAfter`): Space plays. */
  tabByPointer?: boolean
  /** The tabs the bar shows today, in order: a letter opens its tab only when it is there. */
  tabIds?: readonly DugoutTab[]
}

const CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'])

/** Whether a key event's target handles keys itself (fields, buttons, links, anything editable or with a widget role). */
export function isControlTarget(t: { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null } | null): boolean {
  if (!t) return false
  if (t.isContentEditable) return true
  if (t.tagName && CONTROL_TAGS.has(t.tagName.toUpperCase())) return true
  const role = t.getAttribute?.('role')
  return !!role && ['button', 'radio', 'tab', 'checkbox', 'switch', 'slider', 'textbox', 'option', 'menuitem'].includes(role)
}

export function dugoutKey(key: string, ctx: DugoutKeyContext): DugoutKey {
  if (ctx.modifier || ctx.modalOpen) return null
  if (ctx.onControl && !ctx.onTab) return null
  if (key === ' ' || key === 'Spacebar') return ctx.canPlay && (!ctx.onTab || ctx.tabByPointer) ? { kind: 'play' } : null
  if (/^[0-9]$/.test(key)) {
    const index = key === '0' ? 9 : Number(key) - 1
    return index < ctx.tabs ? { kind: 'tab', index } : null
  }
  const letter = BY_LETTER.get(key.toUpperCase())
  if (letter && key.length === 1) return ctx.tabIds?.includes(letter) ? { kind: 'tabId', id: letter } : null
  if (!ctx.canManage) return null
  if (key === 'a' || key === 'A') return { kind: 'autoPick' }
  if (key === 'r' || key === 'R') return { kind: 'rest' }
  return null
}

/** A tab's shortcuts as the strip shows them: its digit while it is among the first ten, and its letter. */
export function tabShortcuts(ids: readonly DugoutTab[]): Array<{ digit?: string; letter: string }> {
  return ids.map((id, i) => ({ ...(i < 10 ? { digit: i === 9 ? '0' : String(i + 1) } : {}), letter: TAB_KEYS[id] }))
}

/** Keys that move the focus: after one, the focused tab is the keyboard's, not the click's. */
const FOCUS_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * The strip's tab a click last focused, after the next event: a press on a tab takes it (anywhere else, none), a key
 * that moves the focus forgets it, any other key (a digit, a letter, Space) keeps it. Generic, so it is tested without
 * a DOM.
 */
export function clickedTabAfter<T>(prev: T | null, ev: { pointer: T | null } | { key: string }): T | null {
  if ('pointer' in ev) return ev.pointer
  return FOCUS_KEYS.has(ev.key) ? null : prev
}
