/**
 * Small accessibility helpers for the screens (docs/ACCESSIBILITY.md). The key and wording logic is pure and tested in
 * `src/ui/__tests__/a11y.test.ts`; `useFocusOnLanding` is the one hook. Presentation only: nothing here reads or writes the game.
 */
import { useEffect, type KeyboardEvent, type RefObject } from 'react'
import { focusHasFallen, rescuedElement } from './focusRescue'
import { runAfterPaint } from './afterPaint'
import { translator } from './i18n'
import { common } from './i18n/en/common'

const t = translator(common)

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

/**
 * The tab an arrow key, Home or End moves to in a strip of `count` tabs (the WAI-ARIA tabs pattern: Left and Right,
 * Up and Down wrap at the ends), or null for any other key.
 */
export function tabStep(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/**
 * The keys of a `role="tablist"` (put it on the strip): the arrows, Home and End move the focus to a tab and choose it,
 * as a click would. The strip's tabs take `tabIndex={selected ? 0 : -1}`, so Tab enters the strip once, on its choice.
 */
export function onTabListKey(e: KeyboardEvent<HTMLElement>): void {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')]
  const i = tabs.indexOf(e.target as HTMLElement)
  if (i < 0) return
  const next = tabStep(e.key, i, tabs.length)
  if (next === null) return
  e.preventDefault()
  tabs[next].focus()
  tabs[next].click()
}

/**
 * The keys of a `role="radiogroup"` of buttons (the Segmented choice): the arrows, Home and End move the focus to a
 * choice and choose it, as WAI-ARIA's radio group does. Its radios take `radioTabIndex`, so Tab enters the group once.
 */
export function onRadioGroupKey(e: KeyboardEvent<HTMLElement>): void {
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')]
  const i = radios.indexOf(e.target as HTMLElement)
  if (i < 0) return
  const next = tabStep(e.key, i, radios.length)
  if (next === null) return
  e.preventDefault()
  radios[next].focus()
  radios[next].click()
}

/** A radio's place in the Tab order: the checked one, or the first when none is checked. */
export function radioTabIndex(index: number, checkedIndex: number): 0 | -1 {
  return index === (checkedIndex < 0 ? 0 : checkedIndex) ? 0 : -1
}

/** A W/D/L outcome as a word, for a screen reader beside a coloured letter or block ("W" alone reads as "double-u"). */
export function outcomeWord(o: 'W' | 'D' | 'L'): string {
  return t(o === 'W' ? 'outcomeWon' : o === 'D' ? 'outcomeDrawn' : 'outcomeLost')
}

/** A results run as one short sentence for a screen reader: "Results, oldest first: won, won, drawn, lost". */
export function resultsLabel(results: ReadonlyArray<'W' | 'D' | 'L'>, lead = t('resultsOldestFirst')): string {
  return results.length ? t('resultsLine', { lead, results: results.map(outcomeWord).join(t('listSeparator')) }) : t('resultsNone', { lead })
}

/**
 * When a reel lands, the control that started or skipped it is gone and the focus has fallen to <body>: move it to the
 * result's first action, so a keyboard or VoiceOver user lands where the choice is. Leaves the focus alone when it is
 * still on something (a viewer who tabbed elsewhere while it ran).
 */
export function useFocusOnLanding(landed: boolean, target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!landed || typeof document === 'undefined') return
    let live = true
    // After the paint: a focus inside the commit forces the new screen's layout in the same task (50 to 70 ms on a
    // 4x-throttled phone after Auto-complete); after it the frame has laid it out already
    runAfterPaint(() => {
      if (!live) return
      // Still somewhere real: leave it. A control disabled under it (the Spin button while a club is on the wheel) is not,
      // nor a place the focus rescue put it after its control went (focusRescue.ts)
      const active = document.activeElement as (HTMLElement & { disabled?: boolean }) | null
      if (!focusHasFallen(active, document.body, rescuedElement())) return
      target.current?.focus()
    })
    return () => {
      live = false
    }
  }, [landed, target])
}
