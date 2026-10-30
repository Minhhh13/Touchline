/**
 * The tap that ends typing (QA r14, R14-1). On a phone the dock and the screens' bottom bars stand down while a text
 * field has the focus (styles.css, "The keyboard"), so a bar resting on the dock (Start under the head-to-head setup,
 * Setup's Start, a room's Join) sits lower while you type. Tapping it moves the focus off the field at the press, the
 * dock comes back at once and the bar jumps up from under the finger: the press and the release land on different
 * elements and the browser sends no click, so the first tap after typing did nothing. While a press that began with a
 * text field focused is in progress the app carries `data-typing-hold` (an attribute, so React's className never drops it), which holds the same layout, and drops it
 * once that press's click has been delivered (or after `TYPING_HOLD_MS` when the press was a scroll and no click
 * comes). Presentation only; the decisions are pure and tested in `src/ui/__tests__/typingHold.test.ts`.
 */

/** The attribute on `.app` that keeps the typing layout through the press that ends it. */
export const TYPING_HOLD_ATTR = 'data-typing-hold'

/** The longest a press may hold the typing layout when no click follows it (a scroll, a long press). */
export const TYPING_HOLD_MS = 700

/** The inputs that bring up a keyboard, as styles.css's rule names them (every input but these types, and textareas). */
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'button', 'submit'])

/** Listened in the capture phase, before any handler can stop the press. */
const CAPTURE = { capture: true }

/** Whether an element is a field the keyboard types into (the same fields styles.css's rule reads). */
export function isTypingField(el: { tagName?: string; type?: string } | null | undefined): boolean {
  if (!el?.tagName) return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA') return true
  return tag === 'INPUT' && !NOT_TYPED.has((el.type ?? 'text').toLowerCase())
}

/**
 * Keep the typing layout from a press that starts in it until that press's click has gone out. `app` is the element
 * the attribute goes on (`.app`); returns the stop function.
 */
export function watchTypingHold(doc: Document = document, app: () => Element | null = () => doc.querySelector('.app')): () => void {
  let fallback: ReturnType<typeof setTimeout> | null = null
  let release: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (fallback) clearTimeout(fallback)
    if (release) clearTimeout(release)
    fallback = release = null
    app()?.removeAttribute(TYPING_HOLD_ATTR)
  }
  const onPress = () => {
    if (!isTypingField(doc.activeElement as HTMLElement | null)) return
    const el = app()
    if (!el) return
    if (fallback) clearTimeout(fallback)
    el.setAttribute(TYPING_HOLD_ATTR, '')
    fallback = setTimeout(clear, TYPING_HOLD_MS)
  }
  // The click is the press's last event: drop the hold once its handlers (and React's) have run
  const onClick = () => {
    if (!fallback) return
    if (release) clearTimeout(release)
    release = setTimeout(clear, 0)
  }
  doc.addEventListener('pointerdown', onPress, CAPTURE)
  doc.addEventListener('click', onClick, CAPTURE)
  return () => {
    doc.removeEventListener('pointerdown', onPress, CAPTURE)
    doc.removeEventListener('click', onClick, CAPTURE)
    clear()
  }
}
