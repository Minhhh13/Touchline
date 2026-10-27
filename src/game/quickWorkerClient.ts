import type { LoadedUniverse } from '@engine/universe'
import type { Game } from './types'
import { universeMark, type QuickJob, type QuickWorkerAnswer, type QuickWorkerAsk } from './quickJob'

/** How long a job may take in the worker (its universe build included) before the page plays the season itself. */
const PATIENCE_MS = 20_000

let worker: Worker | null = null
let broken = false
let next = 0
const waiting = new Map<number, { resolve: (g: Game | null) => void; timer: ReturnType<typeof setTimeout> }>()

function drop(): void {
  for (const w of waiting.values()) {
    clearTimeout(w.timer)
    w.resolve(null)
  }
  waiting.clear()
  worker?.terminate()
  worker = null
}

function started(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const w = new Worker(new URL('./quickWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<QuickWorkerAnswer>) => {
      const job = waiting.get(e.data.id)
      if (!job) return
      waiting.delete(e.data.id)
      clearTimeout(job.timer)
      job.resolve('game' in e.data ? e.data.game : null)
    }
    w.onerror = () => {
      broken = true
      drop()
    }
    worker = w
    return w
  } catch {
    broken = true
    return null
  }
}

const post = (w: Worker, ask: QuickWorkerAsk) => w.postMessage(ask)

/**
 * Have the worker load the packs now (the kick-off screen is up), so the tap to kick off finds them built. Best
 * effort; nothing where there is no Worker.
 */
export function warmQuickWorker(leagues: string[], classic: boolean): void {
  const w = started()
  if (w) post(w, { type: 'warm', leagues, classic })
}

/**
 * The job played in the worker on the universe the page has loaded (`leagues`, `classic`, checked by `u`'s mark):
 * the game after it, or null when it cannot be (no Worker, an error, a universe that differs, too slow), and the page
 * then plays it itself. Presentation only: the game is the one the action gives on the page.
 */
export function runQuickInWorker(job: QuickJob, leagues: string[], classic: boolean, u: LoadedUniverse): Promise<Game | null> {
  const w = started()
  if (!w) return Promise.resolve(null)
  const id = ++next
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      // Too slow: this one is played on the page, and the worker starts afresh next time
      drop()
      resolve(null)
    }, PATIENCE_MS)
    waiting.set(id, { resolve, timer })
    try {
      post(w, { type: 'job', id, leagues, classic, mark: universeMark(u), job })
    } catch {
      waiting.delete(id)
      clearTimeout(timer)
      resolve(null)
    }
  })
}

/** Let the worker go (its universe is several MB); the next kick-off starts it again. */
export function stopQuickWorker(): void {
  drop()
}
