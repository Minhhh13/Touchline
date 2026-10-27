import type { SaveEncoder } from './saveStorage'

/** How long one save may take in the worker before the page compresses it itself (and stops asking the worker). */
const WORKER_PATIENCE_MS = 8000

interface Answer {
  id: number
  encoded?: string
  error?: string
}

/**
 * The save's compression in a Web Worker (`saveWorker.ts`), started on the first write; null where there is no
 * Worker (the tests, an old browser). A worker that fails to start, errors or stalls is dropped and every later
 * write compresses on the page, as before the worker existed. Presentation of the same bytes only: nothing is
 * decided here.
 */
export function workerSaveEncoder(): SaveEncoder | null {
  if (typeof Worker === 'undefined') return null
  let worker: Worker | null = null
  let broken = false
  let next = 0
  const waiting = new Map<number, { resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const fail = (why: string) => {
    broken = true
    for (const w of waiting.values()) {
      clearTimeout(w.timer)
      w.reject(new Error(why))
    }
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  const start = (): Worker => {
    const w = new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Answer>) => {
      const job = waiting.get(e.data.id)
      if (!job) return
      waiting.delete(e.data.id)
      clearTimeout(job.timer)
      if (typeof e.data.encoded === 'string') job.resolve(e.data.encoded)
      else job.reject(new Error(e.data.error ?? 'save worker failed'))
    }
    w.onerror = () => fail('save worker error')
    w.onmessageerror = () => fail('save worker message error')
    return w
  }
  return {
    encode: (json) => {
      if (broken) return Promise.reject(new Error('no save worker'))
      try {
        worker ??= start()
      } catch {
        fail('save worker did not start')
        return Promise.reject(new Error('no save worker'))
      }
      const id = ++next
      const w = worker
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => fail('save worker stalled'), WORKER_PATIENCE_MS)
        waiting.set(id, { resolve, reject, timer })
        w.postMessage({ id, json })
      })
    },
  }
}
