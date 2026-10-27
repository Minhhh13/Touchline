import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { runAfterPaint } from './afterPaint'
import { FOCUSABLE, closeLayer, isTopLayer, openLayer, trapIndex } from './dialogLayers'

/**
 * The last control focused outside any dialog. A dialog that opens after its opener lost the focus (Sim 5 is disabled
 * while it runs, so the focus has fallen to <body> when the digest opens) gives the focus back to this one instead.
 */
let lastOutside: HTMLElement | null = null
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      if (e.target instanceof HTMLElement && e.target !== document.body && !e.target.closest('[role="dialog"]')) lastOutside = e.target
    },
    true,
  )
}

/**
 * A modal dialog's behaviour, shared by `Modal`, the match day's `DecisionSheet` and its `Drawer`s: while `open`, the
 * dialog is the top layer (`dialogLayers.ts`: the page behind is `inert`), the focus moves in once it has painted (to `initialFocus` when
 * it matches, else the dialog itself, so its title is read first), Tab and Shift+Tab stay inside, Escape calls
 * `onClose`, and on closing the focus goes back to the control that had it when the dialog opened (the Sim 5 button
 * under the digest). `back` is the dialog's outermost element (the backdrop); `dialog` is the `role="dialog"` box.
 */
export function useDialog(back: RefObject<HTMLElement | null>, dialog: RefObject<HTMLElement | null>, open: boolean, onClose: (() => void) | undefined, initialFocus?: string): void {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const backEl = back.current
    const box = dialog.current
    if (!backEl || !box || typeof document === 'undefined') return
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : lastOutside
    // A screen may draw the opener afresh while the dialog is up: then the control with the same test id takes the focus
    const openerId = opener?.getAttribute('data-testid') ?? null
    openLayer(backEl, document.body)
    const first = (initialFocus ? box.querySelector<HTMLElement>(initialFocus) : null) ?? box
    // The focus moves in once the dialog has painted: focusing now would force the page's whole style and layout
    // (the dialog just drawn, the page behind made inert) inside the commit that opened it, about 160 ms on a
    // 4x-throttled phone for the Sim 5 digest; after the paint it costs nothing. Not if it has moved in meanwhile
    let live = true
    runAfterPaint(() => {
      if (live && first.isConnected && !box.contains(document.activeElement)) first.focus({ preventScroll: true })
    })
    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(backEl)) return
      if (e.key === 'Escape') {
        if (!closeRef.current) return
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0)
      const at = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
      const next = box.contains(document.activeElement) ? trapIndex(items.length, at, e.shiftKey) : items.length ? (e.shiftKey ? items.length - 1 : 0) : null
      if (next === null) {
        // Nothing to move to: keep the focus on the dialog rather than let it leave
        if (!items.length) {
          e.preventDefault()
          box.focus({ preventScroll: true })
        }
        return
      }
      e.preventDefault()
      items[next].focus()
    }
    // Capture, so the top dialog answers before any page shortcut below it
    window.addEventListener('keydown', onKey, true)
    return () => {
      live = false
      window.removeEventListener('keydown', onKey, true)
      closeLayer(backEl, document.body)
      // Back to the opener, unless the focus has already gone somewhere on purpose (another dialog, a new screen)
      const active = document.activeElement
      const lost = !active || active === document.body || !active.isConnected || box.contains(active)
      if (!lost) return
      const target = opener?.isConnected ? opener : openerId ? document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(openerId)}"]`) : null
      // When the opener cannot take it (Sim 5 is disabled while a decision waits), the focus goes to what the page
      // marks as next (`data-dialog-return`: the decision's card), its first control
      const returnTo = () => {
        const mark = document.querySelector<HTMLElement>('[data-dialog-return]')
        const into = mark ? mark.querySelector<HTMLElement>(FOCUSABLE) ?? mark : null
        into?.focus({ preventScroll: true })
      }
      if (!target) return returnTo()
      if (!target.matches(':disabled')) return target.focus({ preventScroll: true })
      // A control disabled while the dialog was up may be enabled a moment later
      window.setTimeout(() => {
        if (document.activeElement !== document.body) return
        if (target.isConnected && !target.matches(':disabled')) target.focus({ preventScroll: true })
        else returnTo()
      }, 0)
    }
    // One layer per opening: the dialog's identity is fixed while it is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}
