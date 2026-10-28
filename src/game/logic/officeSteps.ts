/**
 * The office's tick inside a run of simulated weeks: `withOffice` passes a stepped game action through unchanged
 * and catches the office up (`officeTick`) at every `WEEK_END`, so a promise falls due or a request comes in on its
 * own week even in Sim 5 or Sim to end. A game that never used the office is untouched (the tick returns at once).
 */
import type { LoadedUniverse } from '@engine/universe'
import { WEEK_END, type GameBox, type WeekStep } from './week'
import { officeTick } from './office'

export function* withOffice<T>(box: GameBox, u: LoadedUniverse, steps: Generator<WeekStep, T, undefined>): Generator<WeekStep, T, undefined> {
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
    if (r.value === WEEK_END) officeTick(box.g, u)
    yield r.value
  }
}
