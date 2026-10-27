/**
 * The quick-season worker: the kick-off's whole season (or its first half, to the January window) played off the
 * page's main thread. It loads the packs itself (from the HTTP or service-worker cache), as the store does
 * (`loadPacks` and `tidyUniverseNames`), and runs a job only when its universe carries the page's mark. Imports the
 * game logic and the pack loader only: never the store or React.
 */
import type { LoadedUniverse } from '@engine/universe'
import { loadPacks } from './packs'
import { tidyUniverseNames } from './logic/playerNames'
import { runQuickJob, universeMark, type QuickWorkerAnswer, type QuickWorkerAsk } from './quickJob'

let held: { key: string; u: Promise<LoadedUniverse> } | null = null

function universe(leagues: string[], classic: boolean): Promise<LoadedUniverse> {
  const key = `${[...leagues].sort().join('+')}|${classic}`
  if (held?.key !== key) {
    const u = loadPacks(leagues, classic).then((raw) => tidyUniverseNames(raw).universe)
    held = { key, u }
    u.catch(() => {
      if (held?.u === u) held = null
    })
  }
  return held.u
}

const answer = (a: QuickWorkerAnswer) => self.postMessage(a)

self.onmessage = async (e: MessageEvent<QuickWorkerAsk>) => {
  const ask = e.data
  if (ask.type === 'warm') {
    universe(ask.leagues, ask.classic).catch(() => undefined)
    return
  }
  try {
    const u = await universe(ask.leagues, ask.classic)
    if (universeMark(u) !== ask.mark) return answer({ id: ask.id, error: 'the league data differs from the page' })
    answer({ id: ask.id, game: runQuickJob(ask.job, u) })
  } catch (err) {
    answer({ id: ask.id, error: err instanceof Error ? err.message : String(err) })
  }
}
