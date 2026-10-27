import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Paint first, then do the heavy work: a click whose store action runs long on the main thread (a whole quick season
 * at kick-off, a matchweek with its match day and save, five simulated matchweeks) shows its busy state on the next
 * frame, and the action runs in a task after that paint, so the tap answers within a frame on a slow phone instead of
 * freezing with no sign it was taken. The action itself is unchanged and runs exactly once. Presentation only.
 *
 * The one implementation: `paintFirst.ts` re-exports it (the Dugout's Play button and the tests import it from there).
 */

type Raf = (cb: () => void) => unknown
type Later = (cb: () => void, ms: number) => unknown

const browserRaf = (): Raf | undefined => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined)

/** Run `fn` after the next paint: a frame callback (just before the paint), then a task (just after it). */
export function afterNextPaint(fn: () => void, raf: Raf | undefined = browserRaf(), later: Later = setTimeout): void {
  if (!raf) {
    later(fn, 0)
    return
  }
  raf(() => {
    later(fn, 0)
  })
}

/** How long a run waits for a frame before it goes anyway: a hidden tab paints no frames. */
export const PAINT_FALLBACK_MS = 150

/**
 * Run `fn` once, after the next paint, or after `PAINT_FALLBACK_MS` when no frame comes (a hidden tab), whichever is
 * first; the other one does nothing. Pure scheduling, tested with fake timers in `paintFirst.test.ts`.
 */
export function runAfterPaint(fn: () => void, raf: Raf | undefined = browserRaf(), later: Later = setTimeout): void {
  let done = false
  const go = () => {
    if (done) return
    done = true
    fn()
  }
  afterNextPaint(go, raf, later)
  later(go, PAINT_FALLBACK_MS)
}

/**
 * A busy flag and a runner: `run(fn)` sets the flag, paints, runs `fn` (`runAfterPaint`) and clears the flag (once its
 * promise settles, for an action that runs in slices, as Sim 5 does). A second
 * run while one is waiting is dropped, so a double click (or Space held down) plays one matchweek; the flag is not set
 * on a button that has gone meanwhile.
 */
export function useAfterPaint(): [boolean, (fn: () => void | Promise<void>) => void] {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = useCallback((fn: () => void | Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const done = () => {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
    runAfterPaint(() => {
      let out: void | Promise<void> = undefined
      try {
        out = fn()
      } finally {
        // An action that runs in slices (a promise) keeps the flag until it has finished
        if (out instanceof Promise) void out.finally(done)
        else done()
      }
    })
  }, [])
  return [busy, run]
}
