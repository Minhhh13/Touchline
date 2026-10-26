import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * For a button whose store action runs long on the main thread (a whole quick season at kick-off, five simulated
 * matchweeks): `run(fn)` shows the busy state first and calls `fn` only once the browser has painted it, so the tap
 * answers within a frame on a slow phone instead of freezing with no sign it was taken. The action itself is unchanged
 * and runs exactly once; a second tap while busy is ignored. Presentation only.
 */
export function useAfterPaint(): [boolean, (fn: () => void) => void] {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = useCallback((fn: () => void) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    let done = false
    const go = () => {
      if (done) return
      done = true
      try {
        fn()
      } finally {
        busyRef.current = false
        if (alive.current) setBusy(false)
      }
    }
    // After the next frame is painted; a hidden tab (no frames) still runs it
    requestAnimationFrame(() => window.setTimeout(go, 0))
    window.setTimeout(go, 150)
  }, [])
  return [busy, run]
}
