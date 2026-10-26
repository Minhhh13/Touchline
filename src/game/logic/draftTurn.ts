/**
 * The draft turn a window belongs to. A power-up sheet, the Upgrader or a slot choice is opened on one turn (a spin
 * showing, or the gap between two picks) and must never outlive it: a Speedrun timeout lets the assistant spin and
 * pick, and a window left open would then act on a later turn ("Re-roll (1 in 0)"). The screens key each such window
 * to `draftTurnKey` and show it only while the key is the one it was opened on. Pure: reads the draft, draws nothing.
 */
import type { DraftState } from '@engine/draft'

/** Changes on every spin, re-spin, re-roll (the season showing) and pick (the picks made, as `picksMade` counts them); the same between them. */
export function draftTurnKey(d: Pick<DraftState, 'spins' | 'lineup' | 'bench' | 'current'>): string {
  const showing = d.current ? `${d.current.clubId}@${d.current.season}` : '-'
  return `${d.spins}/${Object.keys(d.lineup).length + d.bench.length}/${showing}`
}

/** A window opened on a turn: which one, and the turn's key. */
export interface TurnWindow<K extends string> {
  kind: K
  turn: string
}

/** The kind of window open now: the one opened, while its turn is still the draft's; null once the turn has moved on. */
export function openWindow<K extends string>(w: TurnWindow<K> | null, turn: string): K | null {
  return w && w.turn === turn ? w.kind : null
}
