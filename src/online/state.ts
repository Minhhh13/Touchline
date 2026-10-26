/**
 * The online layer's UI state, apart from the game store: whether the layer is on, the session, the account
 * profile (display name and flag), the sync status, conflicts waiting for the player, ranked posts and today's
 * pinned puzzles. A vanilla Zustand store that imports no Supabase code, so screens can read it in an offline-only
 * build (where it simply stays `configured: false`). Nothing here is persisted: the runtime rebuilds it from the
 * session and `touchline-online-v1`.
 */
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { PuzzlePin } from './server/dailyVerify'
import type { SaveMeta, SlotId } from './core/slots'

export interface OnlineSession {
  userId: string
  /** `m•••@gmail.com`; the full address never enters app state. */
  maskedEmail: string | null
  provider: string
}

/** The account's own `profiles` row: the name on the boards and the optional flag. */
export interface AccountProfile {
  displayName: string
  country: string | null
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error' | 'paused'

/** Something the player is asked about; play is never blocked while it waits. */
export type SyncConflict =
  /** Two different games claim the slot (row 13). */
  | { kind: 'different'; slot: SlotId; local: SaveMeta | null; remote: SaveMeta | null; baseRevision: number }
  /** The cloud copy of this game was abandoned on another device (row 5). */
  | { kind: 'abandoned'; slot: SlotId; remote: SaveMeta | null; baseRevision: number; at: string | null }
  /** Newer progress of the game on screen exists on another device (row 10 while it is being played). */
  | { kind: 'newer'; slot: SlotId; remote: SaveMeta | null }

/** What happened to a ranked post (a Daily or the week's challenge), keyed `daily:2026-10-25` or `weekly:2026-W43`. */
export type PostState =
  | { state: 'waiting'; reason: 'sign_in' | 'retry' | 'sending'; points?: number }
  | { state: 'posted'; position: number; total: number; countryPosition?: number | null; countryTotal?: number | null; country?: string | null; points: number; claimMatched: boolean; already: boolean }
  | { state: 'unranked'; code: string; reason: string }
  | { state: 'rejected'; code: string; reason: string }
  | { state: 'closed' }

export interface OnlinePins {
  daily: PuzzlePin | null
  weekly: PuzzlePin | null
  /** The UTC day and ISO week the pins above are for. */
  day: string | null
  week: string | null
}

export interface OnlineState {
  /** True once `boot.ts` has run, which happens only when `onlineConfig()` is not null. */
  configured: boolean
  /** True once the Supabase client has started (a stored session, a sign-in redirect or an online surface). */
  started: boolean
  session: OnlineSession | null
  account: AccountProfile | null
  /** True once the signed-in account's `profiles` row was read: `account` null then means a new account (the setup step). */
  accountLoaded: boolean
  syncStatus: SyncStatus
  lastSyncAt: string | null
  syncMessage: string | null
  conflicts: SyncConflict[]
  /** A different account signed in on this device: nothing is uploaded until the player picks what to do. */
  accountSwitch: { previousUserId: string } | null
  /** Daily posts and other submissions waiting to be sent. */
  outboxCount: number
  posts: Record<string, PostState>
  pins: OnlinePins
}

export const initialOnlineState: OnlineState = {
  configured: false,
  started: false,
  session: null,
  account: null,
  accountLoaded: false,
  syncStatus: 'off',
  lastSyncAt: null,
  syncMessage: null,
  conflicts: [],
  accountSwitch: null,
  outboxCount: 0,
  posts: {},
  pins: { daily: null, weekly: null, day: null, week: null },
}

export const onlineStore = createStore<OnlineState>(() => ({ ...initialOnlineState }))

/** React hook over the online store. */
export function useOnline<T>(selector: (s: OnlineState) => T): T {
  return useStore(onlineStore, selector)
}

/** The key a ranked post is filed under. */
export const postKey = (kind: 'daily' | 'weekly', key: string) => `${kind}:${key}`
