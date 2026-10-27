/**
 * Breaks in a long store action, so a slow phone paints and answers taps between its parts. Timing only: what runs
 * after each break is exactly what would have run without it.
 */

/** A new task: whatever the page has waiting (a frame, a tap) runs first. */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Once the next frame has been painted (a frame, then a task), so a busy state set just before is on screen. Without
 * frames (a hidden tab, the tests) it resolves after a task, or 150 ms at most.
 */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      resolve()
    }
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(go, 0))
      setTimeout(go, 150)
    } else setTimeout(go, 0)
  })
}
