/**
 * A spin whose reel has landed shows landed after a reload (playtest round 2, P7). The reel is a mount-time animation,
 * so a reload with a club already on the wheel used to run the whole case opening again ("Opening…" for a club the
 * viewer had seen land). The last reel to land is kept per viewer in `localStorage`: its draft (the game's id, or the
 * hot-seat's seed), the spin count and the club-season, so a new spin, a re-spin or another game still runs its reel.
 * Presentation only: the draw was made before the reel turned, and nothing here reads or moves it.
 */

/** Storage key: the last reel that landed. */
export const REEL_LANDED_KEY = 'touchline-reel-landed'

/** One reel run: the draft it belongs to, the spin and the club-season it lands on. */
export function reelMark(scope: string, spinKey: number, target: { clubId: string; season: number }): string {
  return `${scope}|${spinKey}|${target.clubId}@${target.season}`
}

/** This run is the last one that landed on this device. */
export function landedBefore(mark: string, stored: string | null): boolean {
  return !!mark && stored === mark
}

export function readLandedReel(): string | null {
  try {
    return localStorage.getItem(REEL_LANDED_KEY)
  } catch {
    return null
  }
}

export function rememberLandedReel(mark: string): void {
  try {
    localStorage.setItem(REEL_LANDED_KEY, mark)
  } catch {
    // Storage blocked: a reload turns the reel again, as before
  }
}
