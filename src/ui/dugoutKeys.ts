/**
 * The Dugout's keyboard: Space plays the matchweek, 1 to 9 and 0 open the first ten tabs. Pure, so the guards are
 * tested: nothing fires while typing or on a focused control (Space would press it anyway), with a modal open, or with
 * a modifier held; Space waits while a decision is pending or the season is over.
 */
export type DugoutKey = { kind: 'play' } | { kind: 'tab'; index: number } | null

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
  if (ctx.modifier || ctx.onControl || ctx.modalOpen) return null
  if (key === ' ' || key === 'Spacebar') return ctx.canPlay ? { kind: 'play' } : null
  if (/^[0-9]$/.test(key)) {
    const index = key === '0' ? 9 : Number(key) - 1
    return index < ctx.tabs ? { kind: 'tab', index } : null
  }
  return null
}
