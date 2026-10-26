import { useEffect } from 'react'
import { useStore } from '@game/store'
import { arenaNeedsWarmup, arenaWarmPool, warmStrengths } from '@game/logic/arenaWarmup'

type IdleDeadline = { timeRemaining: () => number; didTimeout: boolean }
type IdleWindow = Window & { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }

/** Run `fn` in the next idle moment (a 12 ms slice where the browser has no idle callback), after `delay`; returns a cancel. */
function whenIdle(fn: (more: () => boolean) => void, delay = 0): () => void {
  const w = window as IdleWindow
  let idle: number | null = null
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback((d) => fn(() => d.timeRemaining() > 4), { timeout: 1000 })
    else {
      const end = performance.now() + 12
      fn(() => performance.now() < end)
    }
  }, delay)
  return () => {
    window.clearTimeout(t)
    if (idle !== null) w.cancelIdleCallback?.(idle)
  }
}

/**
 * While an arena run is drafting, work out its field pool's team strengths a slice at a time in idle moments
 * (`arenaWarmup.ts`), so the first "On to the draw" no longer stalls the page. Presentation only: the same memoised
 * values `beginArena` would compute on the click; nothing is saved and no result moves.
 */
export function useArenaWarmup(): void {
  const u = useStore((s) => s.universe)
  // The run waiting for its first pass, by id: a store write that changes nothing else does not restart the slices
  const runId = useStore((s) => (s.game && s.game.phase === 'draft' && arenaNeedsWarmup(s.game) ? s.game.id : ''))
  useEffect(() => {
    const game = useStore.getState().game
    if (!runId || !u || !game) return
    const pool = arenaWarmPool(game, u)
    let at = 0
    let cancel = () => {}
    const step = (more: () => boolean) => {
      at = warmStrengths(u, pool, at, more)
      if (at < pool.length) cancel = whenIdle(step)
    }
    cancel = whenIdle(step, 400)
    return () => cancel()
  }, [runId, u])
}
