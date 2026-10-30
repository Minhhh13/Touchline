/**
 * The open dialogs, as a stack: the shared `Modal`, the match day's decisions pop-up and its drawers. Only the top one
 * is live: it takes Escape and keeps Tab inside itself, and everything outside it (every sibling along its path up to
 * the root) is made `inert`, so a screen reader or a Tab press never reaches the page behind. When it closes, the one
 * under it (if any) becomes the top and the page under that stays inert; the last one to close gives the page back.
 * Only the `inert` flags this module set are cleared, so an element inert for its own reasons stays so. An element
 * marked `data-dialog-keep` (the toast, a live status line) is left live. Written against a minimal node shape so the
 * stack and the trap are tested without a DOM (`src/ui/__tests__/dialogLayers.test.ts`).
 */

export interface LayerNode {
  parentElement: LayerNode | null
  /** Its child elements; those without an `inert` flag (an SVG's) are passed over. */
  children: ArrayLike<unknown>
  inert?: boolean
  hasAttribute?: (name: string) => boolean
}

function isLayerNode(x: unknown): x is LayerNode {
  return typeof x === 'object' && x !== null && 'inert' in x
}

const stack: LayerNode[] = []
const setByUs = new Set<LayerNode>()

/** Every element beside the path from `el` up to `root` (not on it): what a dialog at `el` makes inert. */
export function pathSiblings(el: LayerNode, root: LayerNode): LayerNode[] {
  const out: LayerNode[] = []
  let node: LayerNode | null = el
  while (node && node !== root) {
    const parent: LayerNode | null = node.parentElement
    if (!parent) return []
    for (const child of Array.from(parent.children)) if (child !== node && isLayerNode(child)) out.push(child)
    node = parent
  }
  return node === root ? out : []
}

function apply(root: LayerNode): void {
  for (const n of setByUs) n.inert = false
  setByUs.clear()
  const top = stack[stack.length - 1]
  if (!top) return
  for (const n of pathSiblings(top, root)) {
    if (n.inert || n.hasAttribute?.('data-dialog-keep')) continue
    n.inert = true
    setByUs.add(n)
  }
}

/** A dialog opens at `el` (its outermost element, the backdrop): it becomes the top. */
export function openLayer(el: LayerNode, root: LayerNode): void {
  const i = stack.indexOf(el)
  if (i >= 0) stack.splice(i, 1)
  stack.push(el)
  apply(root)
}

/** A dialog closes (in any order): the next one down becomes the top, or the page is live again. */
export function closeLayer(el: LayerNode, root: LayerNode): void {
  const i = stack.indexOf(el)
  if (i >= 0) stack.splice(i, 1)
  apply(root)
}

/** Whether `el` is the dialog on top, the only one that answers Escape and traps Tab. */
export function isTopLayer(el: LayerNode): boolean {
  return stack[stack.length - 1] === el
}

/** How many dialogs are open (for tests and the smokes). */
export function openLayers(): number {
  return stack.length
}

/**
 * The Tab trap: given `count` focusable items, the index of the one focused (-1 for none of them, the dialog itself),
 * and Shift, the index to move the focus to, or null to let the browser take the step inside the dialog.
 */
export function trapIndex(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null
  if (current < 0) return shift ? count - 1 : 0
  if (shift && current === 0) return count - 1
  if (!shift && current === count - 1) return 0
  return null
}

/** What counts as focusable inside a dialog. */
export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'

/** The little of an element `focusHomeOf` reads (a fake in the tests). */
export interface HomeLike<T> {
  isConnected: boolean
  closest(selector: string): T | null
}

/**
 * The `data-focus-home` box a dialog's opener sits in (a11y round 7): read from the opener while it is on the page, or,
 * when it has already left (a cup card's Play is replaced by its result before the cup night opens), from where the
 * last focused control outside any dialog sat when it took the focus. Null when there is none.
 */
export function focusHomeOf<T>(opener: HomeLike<T> | null, lastOutside: unknown, lastOutsideHome: T | null): T | null {
  if (opener?.isConnected) return opener.closest('[data-focus-home]')
  return opener && opener === lastOutside ? lastOutsideHome : null
}
