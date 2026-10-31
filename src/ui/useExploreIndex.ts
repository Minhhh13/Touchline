import { useEffect, useRef, useState } from 'react'
import type { LoadedUniverse } from '@engine/universe'
import { exploreIndexed, exploreIndexSteps, exploreRatingSteps } from '@game/logic/exploreIndex'

/** How long one slice of the index build may run before the page gets a task (ms). */
const SLICE_MS = 12

/** The one build under way: a newer one (a league just loaded) leaves the older one for good. */
let running: { key: string; u: LoadedUniverse; done: Promise<boolean>; stop: () => void } | null = null

/** Step `steps` in slices of `SLICE_MS`, a task for the page between them; true once done, false when superseded. */
function sliced(key: string, u: LoadedUniverse, steps: Generator<void, void, void>): Promise<boolean> {
  if (running?.u === u && running.key === key) return running.done
  running?.stop()
  let timer: ReturnType<typeof setTimeout> | undefined
  let settle: (ok: boolean) => void = () => undefined
  const done = new Promise<boolean>((resolve) => (settle = resolve))
  const job = {
    key,
    u,
    done,
    stop: () => {
      clearTimeout(timer)
      settle(false)
    },
  }
  const run = () => {
    const t0 = performance.now()
    while (performance.now() - t0 < SLICE_MS) {
      if (steps.next().done) {
        if (running === job) running = null
        settle(true)
        return
      }
    }
    timer = setTimeout(run, 0)
  }
  running = job
  timer = setTimeout(run, 0)
  return done
}

/**
 * Build `u`'s Explore player index in slices of `SLICE_MS`, a task for the page between them; resolves true once it
 * is built, false when a newer universe took over first. The index is the one `playerIndex` builds in one go
 * (`exploreIndexSteps`); presentation only.
 */
export function indexSoon(u: LoadedUniverse): Promise<boolean> {
  return exploreIndexed(u) ? Promise.resolve(true) : sliced('index', u, exploreIndexSteps(u))
}

/** The rating list behind the Top view and similar players (`byRating`), the same way. */
export function ratingsSoon(u: LoadedUniverse): Promise<boolean> {
  return sliced('ratings', u, exploreRatingSteps(u))
}

/**
 * Whether `u`'s Explore index is built, starting the sliced build when it is not: a view that reads the index (search,
 * compare, the records) shows its waiting state meanwhile instead of building it inside a render, which took over a
 * second on a 4x-throttled phone each time a league loaded behind the search.
 */
export function useExploreIndex(u: LoadedUniverse | null | undefined): boolean {
  const [, setBuilt] = useState<LoadedUniverse | null>(null)
  const ready = !!u && exploreIndexed(u)
  useEffect(() => {
    if (!u || exploreIndexed(u)) return
    let live = true
    void indexSoon(u).then((ok) => {
      if (ok && live) setBuilt(u)
    })
    return () => {
      live = false
    }
  }, [u])
  return ready
}

/** `value` when it is not null, else the last value that was (else `fallback`): a view keeps its last answer up while the index builds. */
export function useLast<T>(value: T | null, fallback: T): T {
  const last = useRef<T>(fallback)
  if (value !== null) last.current = value
  return value ?? last.current
}
