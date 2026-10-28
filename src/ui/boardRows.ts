/**
 * The World boards' rows as a screen reads them, pure and tested in `src/ui/__tests__/boardRows.test.ts`. Display
 * only: the server's order is the ranking, nothing here moves a row.
 */

/**
 * Which rows are level with a neighbour on everything the board ranks by, so only the time of posting split them (the
 * boards' SQL orders by the score and its tie-breaks, then `created_at`). `keys` are each row's ranking values joined
 * into one string, in the board's order; a row is level when the row above or below has the same key.
 */
export function levelRows(keys: readonly string[]): boolean[] {
  return keys.map((k, i) => (i > 0 && keys[i - 1] === k) || (i + 1 < keys.length && keys[i + 1] === k))
}

/** The medal place a rank takes on a board (1, 2 or 3), or null below the podium. */
export function podiumOf(position: number): 1 | 2 | 3 | null {
  return position === 1 || position === 2 || position === 3 ? position : null
}

/** A signed goal difference, as every board prints it: `+12`, `0`, `-3`. */
export function signedGd(gd: number): string {
  return gd > 0 ? `+${gd}` : String(gd)
}
