/**
 * The online layer's UI state, apart from the game store: whether the layer is on, the session, the sync status
 * and today's pinned puzzles. A vanilla Zustand store that imports no Supabase code, so screens can read it in an
 * offline-only build (where it simply stays `configured: false`). Nothing here is persisted.
 */
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

export interface OnlineSession {
  userId: string
  /** `m•••@gmail.com`; the full address never enters app state. */
  maskedEmail: string | null
  provider: string
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error'

export interface OnlineState {
  /** True once `boot.ts` has run, which happens only when `onlineConfig()` is not null. */
  configured: boolean
  session: OnlineSession | null
  syncStatus: SyncStatus
  /** Daily posts and other submissions waiting to be sent. */
  outboxCount: number
}

export const initialOnlineState: OnlineState = { configured: false, session: null, syncStatus: 'off', outboxCount: 0 }

export const onlineStore = createStore<OnlineState>(() => ({ ...initialOnlineState }))

/** React hook over the online store. */
export function useOnline<T>(selector: (s: OnlineState) => T): T {
  return useStore(onlineStore, selector)
}
