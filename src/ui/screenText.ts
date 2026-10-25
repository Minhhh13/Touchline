/**
 * Small pure helpers for the Summary, Profile and Explore screens: the short
 * labels that replace their sentences. Presentation only; nothing here reads or
 * writes game state.
 */
import type { Mode } from '@game/types'

/** A mode as it is shown in a table cell or a chip. */
export function modeLabel(mode: Mode): string {
  return { quick: 'Quick draft', daily: 'Daily', season: 'Season', dynasty: 'Dynasty' }[mode]
}

/**
 * How the user's finish compares with the real club's in the same season.
 * `delta` is positive when the user finished higher (a smaller position).
 */
export function versusReal(ours: number, real: number): { delta: number; label: string } {
  const delta = real - ours
  if (delta === 0) return { delta, label: 'Same place' }
  const n = Math.abs(delta)
  return { delta, label: `${n} place${n === 1 ? '' : 's'} ${delta > 0 ? 'higher' : 'lower'}` }
}

/**
 * How many games a folded game-by-game list shows: everything revealed while
 * the replay runs or once unfolded, otherwise at most `fold`.
 */
export function shownGames(revealed: number, fold: number | undefined, expanded: boolean, playing: boolean): number {
  if (!fold || expanded || playing) return revealed
  return Math.min(revealed, fold)
}
