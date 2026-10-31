/**
 * Keyboard reach for the boxes that scroll inside themselves (the one-screen shell, docs/DESIGN_SYSTEM.md section 13).
 * A box that scrolls but holds nothing focusable (a results table, the draft log, the privacy text) cannot be scrolled
 * from the keyboard in Safari, so it joins the Tab order while it scrolls (`tabindex="0"`, marked `data-scroll-focus`)
 * and leaves it again when it stops scrolling or gains a control. Presentation only; WCAG 2.1.1 and axe's
 * `scrollable-region-focusable`. The decision is pure (`scrollFocusAction`) and tested in `src/ui/__tests__/a11y.test.ts`.
 */

/** The boxes that may scroll inside themselves. A new self-scrolling box either holds a control or joins this list. */
export const SCROLL_BOXES = '.mspin-guide, .case-guide, .case-locker, .bracket, .h2h-log, .tbl-wrap, .screen-body, .draft-log, .case-odds, .md-table, .md-slot-body, .rp-goals, .fit-cell, .fit-scroll, .tab-body, .summary-body, table.tbl, .gbg-list, .md-flank > dl, .grid > .panel'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

export type ScrollBoxState = {
  /** Its content runs past its box, either way. */
  scrollable: boolean
  /** Something inside it takes the focus, so Tab already scrolls it. */
  hasFocusable: boolean
  /** We gave it its tabindex (`data-scroll-focus`). */
  managed: boolean
  /** It has a tabindex of its own (from its component): never touched. */
  ownTabIndex: boolean
}

/** What a box needs: join the Tab order, leave it, or nothing. */
export function scrollFocusAction(s: ScrollBoxState): 'add' | 'remove' | 'none' {
  if (s.ownTabIndex && !s.managed) return 'none'
  const wants = s.scrollable && !s.hasFocusable
  if (wants && !s.managed) return 'add'
  if (!wants && s.managed) return 'remove'
  return 'none'
}

/**
 * A box scrolls one way: its overflow lets it, and any content runs past it. Any overflow counts, as axe counts it:
 * content that ends on a fractional pixel at the box's edge rounds to a scrollHeight 1 px over the clientHeight, and
 * the box does scroll by that pixel (the match day's stat lists, round 5).
 */
export function overflows(overflow: string, scroll: number, client: number): boolean {
  return (overflow === 'auto' || overflow === 'scroll') && scroll > client
}

/** One pass over the page's scroll boxes. */
export function syncScrollFocus(root: ParentNode = document): void {
  // Innermost first, so a box whose inner box has just joined the Tab order sees it at once
  ;[...root.querySelectorAll<HTMLElement>(SCROLL_BOXES)].reverse().forEach((el) => {
    const managed = el.hasAttribute('data-scroll-focus')
    const style = getComputedStyle(el)
    const scrollable = overflows(style.overflowY, el.scrollHeight, el.clientHeight) || overflows(style.overflowX, el.scrollWidth, el.clientWidth)
    const action = scrollFocusAction({ scrollable, hasFocusable: !!el.querySelector(FOCUSABLE), managed, ownTabIndex: el.hasAttribute('tabindex') })
    if (action === 'add') {
      el.setAttribute('tabindex', '0')
      el.setAttribute('data-scroll-focus', '')
    } else if (action === 'remove') {
      el.removeAttribute('tabindex')
      el.removeAttribute('data-scroll-focus')
    }
  })
}

/**
 * Keeps the page's scroll boxes in step: after the DOM changes (at most every 500 ms, on an idle moment) and on a
 * resize. Returns the cleanup. Called once from App.
 */
export function watchScrollFocus(root: HTMLElement = document.body, wait = 500): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let settle: ReturnType<typeof setTimeout> | null = null
  // One more pass a little after each burst: a box can start to scroll with no DOM change of its own (a web font or
  // a count-up's last width landing), which the observer never sees
  const recheck = () => {
    settle = null
    syncScrollFocus(root)
  }
  const run = () => {
    timer = null
    syncScrollFocus(root)
    if (settle !== null) clearTimeout(settle)
    settle = setTimeout(recheck, wait * 3)
  }
  const schedule = () => {
    if (timer === null) timer = setTimeout(run, wait)
  }
  const mo = new MutationObserver(schedule)
  mo.observe(root, { childList: true, subtree: true })
  window.addEventListener('resize', schedule)
  schedule()
  return () => {
    mo.disconnect()
    window.removeEventListener('resize', schedule)
    if (timer !== null) clearTimeout(timer)
    if (settle !== null) clearTimeout(settle)
  }
}
