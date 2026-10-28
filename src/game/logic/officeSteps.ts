/**
 * The office's tick inside a run of simulated weeks: `withTick` passes a stepped game action through unchanged and
 * calls `tick` (the office's `officeTick`, with `sim` set) at every `WEEK_END`, so a promise falls due or a request
 * comes in on its own week even in Sim 5 or Sim to end. A game that never used the office is untouched (the tick
 * returns at once). Kept free of the office's own code, which the store loads only when it is needed.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { Game } from '../types'
import { WEEK_END, type GameBox, type WeekStep } from './week'

export type OfficeTick = (game: Game, u: LoadedUniverse, sim?: boolean) => void

export function* withTick<T>(box: GameBox, u: LoadedUniverse, steps: Generator<WeekStep, T, undefined>, tick: OfficeTick): Generator<WeekStep, T, undefined> {
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
    if (r.value === WEEK_END) tick(box.g, u, true)
    yield r.value
  }
}
