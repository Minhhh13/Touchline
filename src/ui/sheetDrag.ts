// A phone's bottom sheet follows a finger pulled down from its grip or its header, and closes when let go far or fast
// enough (components/bits.tsx `Modal`). Pure: the hook in Modal feeds it the pointer's travel and time.

/** A press turns into a drag after this many pixels down (a tap on the header's buttons stays a tap) */
export const SHEET_DRAG_START = 6
/** Let go past this share of the sheet's height (at most `SHEET_CLOSE_MAX` px) and it closes */
export const SHEET_CLOSE_SHARE = 0.3
export const SHEET_CLOSE_MAX = 140
/** A flick: this fast (px per ms) and at least `SHEET_FLICK_MIN` px down closes it too */
export const SHEET_FLICK_SPEED = 0.6
export const SHEET_FLICK_MIN = 24

/** Where the sheet sits for a finger `dy` px below where it pressed: it follows downwards, and upwards only a little */
export function sheetOffset(dy: number): number {
  if (!Number.isFinite(dy)) return 0
  if (dy >= 0) return dy
  // Pulled up past its rest: a stiff rubber band, never more than 12 px
  return -Math.min(12, Math.sqrt(-dy) * 2)
}

/** Whether a drag let go at `dy` px after `ms` milliseconds closes a sheet `height` px tall */
export function sheetCloses(dy: number, ms: number, height: number): boolean {
  if (!Number.isFinite(dy) || dy <= 0) return false
  const far = Math.min(SHEET_CLOSE_MAX, Math.max(0, height) * SHEET_CLOSE_SHARE)
  if (dy >= far) return true
  const speed = dy / Math.max(1, ms)
  return dy >= SHEET_FLICK_MIN && speed >= SHEET_FLICK_SPEED
}
