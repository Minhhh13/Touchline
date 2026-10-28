/**
 * Small accessibility helpers for the screens (docs/ACCESSIBILITY.md). The key and wording logic is pure and tested in
 * `src/ui/__tests__/a11y.test.ts`; `useFocusOnLanding` is the one hook. Presentation only: nothing here reads or writes the game.
 */
import { useEffect, type KeyboardEvent, type RefObject } from 'react'

/** Enter or Space: the keys that press a button, so a custom control answers them as a real one does. */
export function isActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

/**
 * Keyboard reach for an element that must stay what it is (a table row) but is pressed with a click: it joins the Tab
 * order and Enter or Space runs the same action. Keys pressed on a control inside it (a button in the row) are left alone.
 * Prefer a real `<button>`; use this only where a button cannot sit.
 */
export function pressable(action: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || !isActivationKey(e.key)) return
      e.preventDefault()
      action()
    },
  }
}

/** A W/D/L outcome as a word, for a screen reader beside a coloured letter or block ("W" alone reads as "double-u"). */
export function outcomeWord(o: 'W' | 'D' | 'L'): string {
  return o === 'W' ? 'won' : o === 'D' ? 'drawn' : 'lost'
}

/** A results run as one short sentence for a screen reader: "Results, oldest first: won, won, drawn, lost". */
export function resultsLabel(results: ReadonlyArray<'W' | 'D' | 'L'>, lead = 'Results, oldest first'): string {
  return results.length ? `${lead}: ${results.map(outcomeWord).join(', ')}` : `${lead}: none yet`
}

/**
 * When a reel lands, the control that started or skipped it is gone and the focus has fallen to <body>: move it to the
 * result's first action, so a keyboard or VoiceOver user lands where the choice is. Leaves the focus alone when it is
 * still on something (a viewer who tabbed elsewhere while it ran).
 */
export function useFocusOnLanding(landed: boolean, target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!landed || typeof document === 'undefined') return
    // Still somewhere real: leave it. A control disabled under it (the Spin button while a club is on the wheel) is not
    const active = document.activeElement as (HTMLElement & { disabled?: boolean }) | null
    if (active && active !== document.body && !active.disabled) return
    target.current?.focus()
  }, [landed, target])
}
