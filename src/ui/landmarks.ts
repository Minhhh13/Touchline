/**
 * The main landmark and the skip link (docs/ACCESSIBILITY.md). Every screen renders its own `<div class="page">` as a
 * direct child of `.app`, and the shell's CSS selects `.app > .page` directly, so the screens are not wrapped in a
 * `<main>`: the `.page` child itself is given `role="main"` and the id the skip link points at, and keeps it as the
 * screens change. Presentation only: nothing here reads or writes the game.
 */

/** The id the skip link points at: the screen's `.page`. */
export const MAIN_ID = 'main'

interface ChildLike {
  classList: { contains(name: string): boolean }
}

/** The screen's page among `.app`'s children: the first with the `page` class (the top bar, the toast and the restore button are not). */
export function pickMain<T extends ChildLike>(children: ArrayLike<T>): T | null {
  for (let i = 0; i < children.length; i++) if (children[i].classList.contains('page')) return children[i]
  return null
}

function mark(app: HTMLElement): void {
  const page = pickMain(app.children)
  if (!page) return
  if (page.getAttribute('role') !== 'main') page.setAttribute('role', 'main')
  if (page.id !== MAIN_ID) page.id = MAIN_ID
}

/**
 * A ref for the `.app` element: marks its `.page` child as the main landmark now and whenever a screen swaps it
 * (a MutationObserver on the direct children only, so a screen's own updates cost nothing). React 19 runs the
 * returned cleanup when the element goes.
 */
export function watchMainLandmark(app: HTMLElement | null): (() => void) | undefined {
  if (!app || typeof MutationObserver === 'undefined') return undefined
  mark(app)
  const obs = new MutationObserver(() => mark(app))
  obs.observe(app, { childList: true })
  return () => obs.disconnect()
}

/**
 * The skip link's action: move the focus to the screen's page, so the next Tab is its first control. The page takes
 * `tabindex="-1"` only for this focus and drops it on blur, so a click inside a screen never focuses the whole page.
 * The hash is left alone (the app reads `#c=`, `#s=` and `#h=` links from it).
 */
export function skipToMain(event?: { preventDefault(): void }): void {
  event?.preventDefault()
  const main = document.getElementById(MAIN_ID)
  if (!main) return
  main.setAttribute('tabindex', '-1')
  main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true })
  main.focus()
}
