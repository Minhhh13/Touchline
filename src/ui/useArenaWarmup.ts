import { useCallback, useEffect, useState } from 'react'
import { useStore } from '@game/store'
import { arenaNeedsWarmup, arenaSetupPool, arenaWarmPool, warmStrengths } from '@game/logic/arenaWarmup'
import { afterNextPaint, nextTask } from '@game/yieldToPage'

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
 * On the arena's setup and while an arena run is drafting, work out the field pool's team strengths a slice at a time
 * in idle moments (`arenaWarmup.ts`), so the first "On to the draw" no longer stalls the page. The setup warms every
 * club-season of the loaded leagues (a superset of any run's pool: the giants field loads all seven there), the draft
 * its run's own pool. Presentation only: the same memoised values `beginArena` would compute on the click; nothing is
 * saved and no result moves.
 */
export function useArenaWarmup(): void {
  const u = useStore((s) => s.universe)
  // The run waiting for its first pass, by id: a store write that changes nothing else does not restart the slices
  const runId = useStore((s) => (s.game && s.game.phase === 'draft' && arenaNeedsWarmup(s.game) ? s.game.id : ''))
  const onSetup = useStore((s) => s.screen === 'setup' && s.setupMode === 'arena')
  const leagues = useStore((s) => s.loadedLeagues.join(','))
  useEffect(() => {
    const game = useStore.getState().game
    if (!u) return
    const pool = runId && game ? arenaWarmPool(game, u) : onSetup && leagues ? arenaSetupPool(u, leagues.split(',')) : []
    if (!pool.length) return
    let at = 0
    let cancel = () => {}
    const step = (more: () => boolean) => {
      at = warmStrengths(u, pool, at, more)
      if (at < pool.length) cancel = whenIdle(step)
    }
    cancel = whenIdle(step, 400)
    return () => cancel()
  }, [runId, onSetup, leagues, u])
}

/**
 * The Draft's finish button. For an arena run whose field is not yet warm (a draft finished faster than the idle
 * slices), the busy state is painted and the rest of the pool is worked out 12 ms a task before `finishDraft` runs, so
 * the page keeps answering instead of freezing for the whole pass; anything else finishes at once, as before. The run
 * is the same either way (the memoised values `beginArena` reads).
 */
export function useFinishDraft(finishDraft: () => void): { busy: boolean; finish: () => void } {
  const [busy, setBusy] = useState(false)
  const finish = useCallback(() => {
    if (busy) return
    const { game, universe: u } = useStore.getState()
    const pool = game && u && game.phase === 'draft' ? arenaWarmPool(game, u) : []
    if (!game || !u || !pool.length) return finishDraft()
    setBusy(true)
    void (async () => {
      try {
        await afterNextPaint()
        let at = 0
        while (at < pool.length) {
          const end = performance.now() + 12
          at = warmStrengths(u, pool, at, () => performance.now() < end)
          if (at < pool.length) await nextTask()
        }
      } finally {
        setBusy(false)
        // Only the draft this tap was for (the page may have moved on meanwhile)
        const now = useStore.getState().game
        if (now && now.id === game.id && now.phase === 'draft') finishDraft()
      }
    })()
  }, [busy, finishDraft])
  return { busy, finish }
}
