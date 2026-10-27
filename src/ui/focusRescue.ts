/**
 * Focus that falls to `<body>` is put back near where it was (docs/ACCESSIBILITY.md, round 3; WCAG 2.4.3). When the
 * focused control goes from the page (a picked player's row, the Pick button of a manager spin, a whole screen
 * swapped for the next), the browser leaves the focus on `<body>`: a screen reader says nothing and the next Tab
 * starts again at the top bar. The rescue keeps the chain of boxes the focus was in and, once the control has gone,
 * moves the focus to the first control of the nearest box still on the page (a panel, a dialog), or to the screen's
 * page when the whole screen changed (the page takes `tabindex="-1"` for it, as the skip link does). Components that
 * land the focus on purpose (`useFocusOnLanding`) treat a rescued focus as fallen, so their choice wins.
 * Presentation only: nothing here reads or writes the game. The decisions are pure and tested in
 * `src/ui/__tests__/focusRescue.test.ts`.
 */
import { MAIN_ID } from './landmarks'

/** The boxes a lost focus may go back to, nearest first: a dialog, a panel or a box of the one-screen shell. */
export const RESCUE_BOXES = '[role="dialog"], .panel, .fit-cell, .md-panel, .drawer'

/** What may take the focus inside a box. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/**
 * Where a lost focus goes: the nearest box of `chain` (the focused element's ancestors, nearest first, as they were
 * while it had the focus) that is still on the page; `null` for the screen's page.
 */
export function pickRescue<T>(chain: readonly T[], connected: (t: T) => boolean, isBox: (t: T) => boolean): T | null {
  for (const t of chain) {
    if (!connected(t)) continue
    if (isBox(t)) return t
  }
  return null
}

/** Whether the focus has fallen: nowhere, on `<body>`, on a disabled control or on a box only the rescue focused. */
export function focusHasFallen(active: { disabled?: boolean } | null, body: unknown, rescued: unknown): boolean {
  if (!active || active === body) return true
  if (active.disabled) return true
  return active === rescued
}

let rescued: Element | null = null

/** The element the rescue last focused (a box or the page), so `useFocusOnLanding` may move on from it. */
export function rescuedElement(): Element | null {
  return rescued
}

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert], [aria-hidden="true"]')
}

function focusBox(box: HTMLElement): void {
  const first = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible)
  const target = first ?? box
  if (!first) {
    target.setAttribute('tabindex', '-1')
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
  }
  target.focus({ preventScroll: true })
  rescued = target
}

/** Started once from App: follows the focus and puts it back when its control leaves the page. Returns the cleanup. */
export function watchFocusRescue(doc: Document = document): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  let last: Element | null = null
  let chain: Element[] = []
  const onFocus = (e: FocusEvent) => {
    const t = e.target
    if (!(t instanceof Element)) return
    last = t
    chain = []
    for (let el = t.parentElement; el && el !== doc.body; el = el.parentElement) chain.push(el)
    if (t !== rescued) rescued = null
  }
  const check = () => {
    if (!last || last.isConnected) return
    const active = doc.activeElement
    if (active && active !== doc.body) return
    const box = pickRescue(chain, (el) => el.isConnected, (el) => el.matches(RESCUE_BOXES) && el instanceof HTMLElement && visible(el))
    last = null
    if (box instanceof HTMLElement) {
      focusBox(box)
      return
    }
    const main = doc.getElementById(MAIN_ID)
    if (!main) return
    main.setAttribute('tabindex', '-1')
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
    main.focus({ preventScroll: true })
    rescued = main
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  // After React's own effects (a landing focus, a dialog's focus going back to its opener) have run
  const schedule = () => {
    if (timer === null)
      timer = setTimeout(() => {
        timer = null
        check()
      }, 50)
  }
  const mo = new MutationObserver(schedule)
  mo.observe(doc.body, { childList: true, subtree: true })
  doc.addEventListener('focusin', onFocus)
  return () => {
    mo.disconnect()
    doc.removeEventListener('focusin', onFocus)
    if (timer !== null) clearTimeout(timer)
  }
}
