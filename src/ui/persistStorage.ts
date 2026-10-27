/**
 * Persistent storage for the save (O-9 in docs/QA.md). Everything lives in this browser's localStorage, which a browser
 * may clear under storage pressure (Safari and iOS web views most of all). `navigator.storage.persist()` asks the
 * browser to keep the site's data until the player clears it. It is asked once, after the first finished game (a
 * player with a result worth keeping, and a gesture's worth of engagement for Chrome's heuristics), and Your record's
 * Save data box shows the answer with a button to ask again. Per-viewer: the "asked" flag is its own localStorage key.
 * Nothing here touches the game.
 */
import { useEffect, useState } from 'react'
import type { Profile } from '@game/types'

/** The per-viewer key: set once the automatic ask has run on this device. */
export const PERSIST_ASKED_KEY = 'touchline-persist-asked'

export type PersistState = 'persisted' | 'best-effort' | 'unsupported'

/** The part of `navigator.storage` this uses (injected in tests). */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

function manager(): StorageManagerLike | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : (navigator.storage as StorageManagerLike | undefined)
  } catch {
    return undefined
  }
}

/** Results this profile has finished: every mode's count in the Trophy Room, plus head-to-heads and arena runs filed. */
export function finishedResults(profile: Pick<Profile, 'cabinet' | 'arenaRuns'>): number {
  const byMode = Object.values(profile.cabinet?.byMode ?? {}).reduce<number>((a, n) => a + (n ?? 0), 0)
  return byMode + (profile.arenaRuns?.length ?? 0)
}

/** Ask on its own once: after the first finished result, when this device has not been asked before. */
export function shouldAskPersist(finished: number, asked: boolean): boolean {
  return finished >= 1 && !asked
}

/** Where the browser stands, without asking. */
export async function persistState(sm: StorageManagerLike | undefined = manager()): Promise<PersistState> {
  if (!sm?.persisted || !sm.persist) return 'unsupported'
  try {
    return (await sm.persisted()) ? 'persisted' : 'best-effort'
  } catch {
    return 'unsupported'
  }
}

/** Ask the browser to keep the site's data; resolves to where it then stands. */
export async function askPersist(sm: StorageManagerLike | undefined = manager()): Promise<PersistState> {
  if (!sm?.persisted || !sm.persist) return 'unsupported'
  try {
    return (await sm.persist()) ? 'persisted' : 'best-effort'
  } catch {
    return persistState(sm)
  }
}

/** The Save data box's line for each answer. */
export function persistLine(state: PersistState): string {
  if (state === 'persisted') return 'Protected: this browser keeps your save until you clear it.'
  if (state === 'best-effort') return 'Not protected: this browser may clear your save when the device runs low on space. Protect it, and export a copy now and then.'
  return 'This browser cannot protect your save from clearing: export a copy now and then.'
}

function readAsked(): boolean {
  try {
    return localStorage.getItem(PERSIST_ASKED_KEY) === '1'
  } catch {
    return true
  }
}

function writeAsked(): void {
  try {
    localStorage.setItem(PERSIST_ASKED_KEY, '1')
  } catch {
    // Blocked storage: the ask may run again next visit, which is harmless
  }
}

/** App-wide: ask once, after the first finished result. */
export function usePersistAfterFirstResult(profile: Pick<Profile, 'cabinet' | 'arenaRuns'>): void {
  const finished = finishedResults(profile)
  useEffect(() => {
    if (!shouldAskPersist(finished, readAsked())) return
    writeAsked()
    void askPersist()
  }, [finished])
}

/** Your record: where the browser stands, and a way to ask again. */
export function usePersistState(): { state: PersistState | null; ask: () => void } {
  const [state, setState] = useState<PersistState | null>(null)
  useEffect(() => {
    let live = true
    void persistState().then((s) => live && setState(s))
    return () => {
      live = false
    }
  }, [])
  return {
    state,
    ask: () => {
      writeAsked()
      void askPersist().then(setState)
    },
  }
}
