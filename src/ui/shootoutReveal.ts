import { useSyncExternalStore } from 'react'

/*
 * Whether an arena shoot-out's kicks have all shown on the report (r9). `ShootoutPanel` reveals them one at a time;
 * the report's scoreboard and its Next button read this so they do not say "Won on pens" (or name the next round)
 * while the reveal is still at 1-2. Presentation only, per page visit, nothing stored.
 */

const done = new Set<string>()
const listeners = new Set<() => void>()

/** The shoot-out's key: the game, the step and its kicks, so a new shoot-out starts unrevealed. */
export function shootoutKey(gameId: string, step: number, kicks: number): string {
  return `${gameId}-${step}-${kicks}`
}

/** The panel's report: every kick of `key` shown, or not yet. */
export function setShootoutRevealed(key: string, revealed: boolean): void {
  if (done.has(key) === revealed) return
  if (revealed) done.add(key)
  else done.delete(key)
  for (const l of listeners) l()
}

export function shootoutRevealed(key: string): boolean {
  return done.has(key)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** True once every kick of `key` has shown; true for no key (no shoot-out to wait for). */
export function useShootoutRevealed(key: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => key === null || done.has(key),
    () => key === null || done.has(key),
  )
}
