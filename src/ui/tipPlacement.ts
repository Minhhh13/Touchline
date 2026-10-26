/**
 * Where a tip opens: fixed to the window beside its anchor, so a box that scrolls or clips (the setup's rules box) never
 * cuts it off. Pure, for InfoTip's bubble and the hover tips (`components/PowerUpButton.tsx`).
 */
export interface TipPlace {
  left: number
  top: number
  /** The most it may be tall where it opened; it scrolls inside past that. */
  maxHeight: number
  /** Under the anchor (else over it). */
  below: boolean
}

export interface TipAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

/** The bubble's width for a `vw` window: `want` px, never under `min` unless the window is narrower, always inside the gutters. */
export function tipWidth(vw: number, want = 320, min = 280, gutter = 16): number {
  return Math.max(0, Math.min(Math.max(want, min), vw - 2 * gutter))
}

/**
 * A `w` by `h` tip for an anchor at `a` in a `vw` by `vh` window. `align` 'end' lines its right edge up with the anchor's
 * (an "i" at the end of a heading), 'center' centres it on the anchor (a chip). It stays inside the gutters; it opens
 * under the anchor when it fits there, or when there is more room under than over, else over it.
 */
export function placeTip(a: TipAnchor, w: number, h: number, vw: number, vh: number, align: 'end' | 'center' = 'end', gutter = 16, gap = 6): TipPlace {
  const want = align === 'end' ? a.right - w : (a.left + a.right) / 2 - w / 2
  const left = Math.round(Math.min(Math.max(gutter, want), Math.max(gutter, vw - gutter - w)))
  const roomBelow = vh - a.bottom - gap - gutter
  const roomAbove = a.top - gap - gutter
  if (h <= roomBelow || roomBelow >= roomAbove) return { left, top: Math.round(a.bottom + gap), maxHeight: Math.max(80, Math.round(roomBelow)), below: true }
  const shown = Math.min(h, roomAbove)
  return { left, top: Math.round(Math.max(gutter, a.top - gap - shown)), maxHeight: Math.max(80, Math.round(roomAbove)), below: false }
}
