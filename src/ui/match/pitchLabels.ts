/**
 * Room for the labels (name and role) under each disc on the pitch: how wide a slot's label may be before it runs into a
 * neighbour's disc or label, whether that neighbour is level with him or a row above or below. Pure: no React, no DOM.
 */

/** A slot as the pitch draws it: x across 0..100, y from own goal (0) to the opposition's (100). */
export interface LabelSlot {
  id: string
  x: number
  y: number
  /** The keeper on the goal line: his label sits beside the disc, so it takes no room under it. */
  foot?: boolean
}

/** The mat around the grass: the pitch's 5 px border on each side (styles.css), which the container queries do not count. */
export const MAT = 5

/** The disc's radius in px at a pitch's inner width (the container queries in styles.css: 44 above 300, 36 to 240, 32 below). */
export function discRadius(width: number): number {
  return width > 300 ? 22 : width > 240 ? 18 : 16
}

/** The label font size in px at a pitch's inner width (11, or 10 on a pitch of 300 px or less). */
export function labelFont(width: number): number {
  return width > 300 ? 11 : 10
}

/** Below this inner width a pitch that names roles drops the role line and keeps the name (styles.css, `.has-roles`). */
export const ONE_LINE_BELOW = 240

/** How many lines a slot's label takes at a pitch's inner width: a name and a role, or only the name on a small pitch that names roles. */
export function labelLines(width: number, roles: boolean): number {
  return roles && width <= ONE_LINE_BELOW ? 1 : 2
}

/** The label's height under a disc at a pitch's inner width (line height 1.1, a 2 px gap each line). */
export function labelHeight(width: number, roles = false): number {
  const lines = labelLines(width, roles)
  return Math.round(labelFont(width) * 1.1 * lines + 2 * lines)
}

const MARGIN = 3
export const LABEL_MIN = 40

/**
 * Each slot's label room in px (the width of its name and role lines), never past `max` or the touchline. A label may not
 * reach the disc of any slot whose disc sits in the label's rows, nor the label of a slot whose label shares them (the two
 * share the gap between their centres). `outer` is the pitch's measured width, mat included; slots sit on the grass inside
 * it, whose height follows from the 3:4 ratio of the whole. `roles`: the pitch names roles (a small one then shows the name only).
 */
export function labelRooms(slots: LabelSlot[], outer: number, max: number, roles = false): Record<string, number> {
  const width = outer - MAT * 2
  const height = (outer * 4) / 3 - MAT * 2
  const r = discRadius(width)
  const lh = labelHeight(width, roles)
  const at = slots.map((s) => ({ s, cx: (s.x / 100) * width, cy: ((100 - s.y) / 100) * height }))
  const out: Record<string, number> = {}
  for (const a of at) {
    // Half the label's width, the least of what each neighbour and the touchline leave
    let half = Infinity
    if (!a.s.foot) {
      const top = a.cy + r + 2
      const bottom = top + lh
      for (const b of at) {
        if (b === a) continue
        const dx = Math.abs(b.cx - a.cx)
        // His disc in my label's rows: my label stops short of the disc
        if (b.cy + r > top && b.cy - r < bottom) half = Math.min(half, dx - r - MARGIN)
        // His label in my label's rows: we share the gap between our centres
        if (!b.s.foot) {
          const btop = b.cy + r + 2
          if (btop < bottom && btop + lh > top) half = Math.min(half, (dx - MARGIN) / 2)
        }
      }
    }
    // A label stays on the grass: twice the distance to the nearer touchline, less a margin. The keeper's runs to the right of his disc, as far as the pitch's edge (styles.css: 50cqw - 31px)
    const edge = a.s.foot ? width / 2 - 31 : (2 * Math.min(a.s.x, 100 - a.s.x) / 100) * width - 8
    out[a.s.id] = Math.max(LABEL_MIN, Math.min(max, edge, half * 2))
  }
  return out
}
