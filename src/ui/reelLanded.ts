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

/**
 * The hot-seat draft's names for the same mark (QA round 13, R14-O3): one spin of one game, null between spins. The
 * hot-seat's `scope` is `h2h:<seed>`, so `landedKey('h2h', seed, spins, target)` is the mark its `CaseReel` keeps.
 */
export function landedKey(scope: string, seed: string, spins: number, target: { clubId: string; season: number } | null | undefined): string | null {
  return target ? reelMark(`${scope}:${seed}`, spins, target) : null
}

/** Whether this spin is the last reel that landed on this device (read from storage when `stored` is not given). */
export function landedSeen(key: string | null): boolean {
  return !!key && landedBefore(key, readLandedReel())
}

/** Remember that this spin has landed (one kept: the next replaces it). */
export function rememberLanded(key: string | null): void {
  if (key) rememberLandedReel(key)
}
