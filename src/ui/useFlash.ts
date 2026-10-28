import { useEffect, useRef, useState } from 'react'

interface Clock {
  set: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clear: (id: ReturnType<typeof setTimeout>) => void
}

const REAL_CLOCK: Clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) }

/**
 * A flag that turns on and off again after `ms` (a "Copied" label). A second flash restarts the wait, so an early
 * timer never turns the newer one off; `dispose` drops the pending timer (on unmount). Pure but for the clock.
 */
export function makeFlash(set: (on: boolean) => void, ms: number, clock: Clock = REAL_CLOCK) {
  let id: ReturnType<typeof setTimeout> | null = null
  return {
    flash() {
      if (id !== null) clock.clear(id)
      set(true)
      id = clock.set(() => {
        id = null
        set(false)
      }, ms)
    },
    dispose() {
      if (id !== null) clock.clear(id)
      id = null
    },
  }
}

/** `makeFlash` in a component: the flag, and the call that raises it. The timer goes with the component. */
export function useFlash(ms = 1500): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const ref = useRef<ReturnType<typeof makeFlash> | null>(null)
  if (!ref.current) ref.current = makeFlash(setOn, ms)
  useEffect(() => () => ref.current?.dispose(), [])
  return [on, ref.current.flash]
}
