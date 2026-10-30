/**
 * QA round 13 (r15, R14-O3): a reel that has landed in this tab does not turn again on a reload. The hot-seat draft
 * remembers the spin it last saw land (per tab, sessionStorage `touchline-reel-landed`), and a reload that comes back to
 * the same spin shows it landed at once, so the pick can be made straight away. Presentation only: the spin was drawn
 * and saved before its reel turned, nothing here reads or moves the game.
 */

export const REEL_LANDED_KEY = 'touchline-reel-landed'

/** One spin of one game: the game's seed, the spin count and the club-season drawn. Null between spins. */
export function landedKey(scope: string, seed: string, spins: number, target: { clubId: string; season: number } | null | undefined): string | null {
  return target ? `${scope}|${seed}|${spins}|${target.clubId}@${target.season}` : null
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Whether this tab has already seen this spin land. */
export function landedBefore(key: string | null): boolean {
  if (!key) return false
  try {
    return storage()?.getItem(REEL_LANDED_KEY) === key
  } catch {
    return false
  }
}

/** Remember that this spin has landed (one spin kept: the next spin replaces it). */
export function rememberLanded(key: string | null): void {
  if (!key) return
  try {
    storage()?.setItem(REEL_LANDED_KEY, key)
  } catch {
    // A private window or blocked storage: the reel turns again on a reload, as before
  }
}
