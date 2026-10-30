/**
 * The Run-in setup's seed is kept per viewer until a run starts (playtest round 2, P10): its three suggested jobs come
 * from the seed, and a new seed on every visit meant a job seen and left was gone. Key `touchline-runin-seed`; a run
 * started from it clears it, so the next run-in gets fresh jobs. UI only: a seed plays the same whoever chose it.
 */
export const RUN_IN_SEED_KEY = 'touchline-runin-seed'

/** The longest seed kept: the box's own value, never a stored blob. */
const SEED_MAX = 64

/** The seed a visit opens with: the one kept, when it reads as a seed, else a fresh one. */
export function startingRunInSeed(stored: string | null, fresh: () => string): string {
  return stored && stored.trim() && stored.length <= SEED_MAX ? stored : fresh()
}

export function readRunInSeed(): string | null {
  try {
    return localStorage.getItem(RUN_IN_SEED_KEY)
  } catch {
    return null
  }
}

export function keepRunInSeed(seed: string | null): void {
  try {
    if (seed && seed.trim() && seed.length <= SEED_MAX) localStorage.setItem(RUN_IN_SEED_KEY, seed)
    else localStorage.removeItem(RUN_IN_SEED_KEY)
  } catch {
    // Storage blocked: a new visit draws new jobs, as before
  }
}
