/**
 * Paint first, then do the heavy work: a click whose store action takes a long task (kicking off a season plays the
 * first matchweek, builds the match day and writes the save, 160 ms on a desktop and about 700 ms on a phone-speed CPU)
 * shows its pressed state on the next frame, and the action runs in a task after that paint. The simulation is
 * untouched: the same action runs, only later. Presentation only.
 */
import { useCallback, useRef, useState } from 'react'

type Raf = (cb: () => void) => unknown
type Later = (cb: () => void, ms: number) => unknown

/** Run `fn` after the next paint: a frame callback (just before the paint), then a task (just after it). */
export function afterNextPaint(fn: () => void, raf: Raf | undefined = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : undefined, later: Later = setTimeout): void {
  if (!raf) {
    later(fn, 0)
    return
  }
  raf(() => {
    later(fn, 0)
  })
}

/**
 * A busy flag and a runner: `run(fn)` sets the flag, paints, runs `fn` and clears the flag. A second run while one is
 * waiting is dropped, so a double click (or Space held down) plays one matchweek.
 */
export function usePaintFirst(): [boolean, (fn: () => void) => void] {
  const [busy, setBusy] = useState(false)
  const waiting = useRef(false)
  const run = useCallback((fn: () => void) => {
    if (waiting.current) return
    waiting.current = true
    setBusy(true)
    afterNextPaint(() => {
      try {
        fn()
      } finally {
        waiting.current = false
        setBusy(false)
      }
    })
  }, [])
  return [busy, run]
}
