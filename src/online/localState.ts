/**
 * The device's own online record, `localStorage['touchline-online-v1']`: which account its sync state belongs to,
 * the base of every cloud-save slot (what this device last saw the cloud agree to), tombstones it observed, the
 * ranked-post outbox and the answers it got. Per device, never synced, never part of the game save. Every read and
 * write is inside try/catch (a private window or blocked storage gives a fresh record and the game carries on).
 */
import type { BaseSlot } from './core/syncPlan'
import type { ProfileDoc } from './core/merge'
import type { SlotId } from './core/slots'
import type { PostState } from './state'

export const ONLINE_KEY = 'touchline-online-v1'
/** Dismissed sign-in prompts ("Sign in to keep this season on every device"), per device. */
export const PROMPTS_KEY = 'touchline-online-prompts-v1'
/** The Supabase session's storage key (supabase-js `storageKey`). */
export const AUTH_KEY = 'touchline-auth-v1'

export interface OutboxEntry {
  id: string
  kind: 'daily' | 'weekly'
  /** `YYYY-MM-DD` or `YYYY-Www`. */
  key: string
  encoded: string
  teamName: string
  shortName: string
  /** The points the device saw, for the "Sign in to post 71 pts" line; the server's replay decides. */
  points: number
  at: string
  attempts: number
  /** Epoch ms before which the entry is not retried. */
  nextAt: number
  /** The account signed in when the run finished: it posts only under that account. Null or missing: filed signed
   * out, so it posts under the next account that signs in on this device. */
  owner?: string | null
}

export interface OnlineRecord {
  v: 1
  deviceId: string
  /** The account the bases below belong to (null: nobody has signed in on this device yet). */
  userId: string | null
  slots: Partial<Record<SlotId, BaseSlot>>
  profileBase: { revision: number; doc: ProfileDoc } | null
  tombstones: Array<{ slot: SlotId; gameId: string; at: string }>
  /** Games kept on this device only (the "Keep them on this device only" answer after an account switch). */
  localOnly: string[]
  /** The profile document is not merged into this account (same answer). */
  profileLocalOnly: boolean
  outbox: OutboxEntry[]
  posts: Record<string, PostState>
  /** Ranked runs already captured on this device (`weekly:2026-W43`), so "Play it again" never posts twice. */
  captured: string[]
  lastUploadAt: Partial<Record<SlotId, number>>
  claims: number
  /** Set by "Delete my cloud data": nothing uploads again until the player presses Sync now (otherwise this device's
   * next pass would put every game straight back). */
  paused?: boolean
}

const CAP_POSTS = 60
const CAP_CAPTURED = 60

function newDeviceId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

export function freshRecord(deviceId = newDeviceId()): OnlineRecord {
  return { v: 1, deviceId, userId: null, slots: {}, profileBase: null, tombstones: [], localOnly: [], profileLocalOnly: false, outbox: [], posts: {}, captured: [], lastUploadAt: {}, claims: 0 }
}

/** A stored record with every later field filled in; a fresh one when nothing usable is stored. */
export function parseRecord(text: string | null): OnlineRecord {
  if (!text) return freshRecord()
  try {
    const r = JSON.parse(text) as Partial<OnlineRecord>
    if (!r || typeof r !== 'object' || r.v !== 1 || typeof r.deviceId !== 'string' || r.deviceId.length < 8) return freshRecord()
    const base = freshRecord(r.deviceId)
    return {
      ...base,
      userId: typeof r.userId === 'string' ? r.userId : null,
      slots: r.slots && typeof r.slots === 'object' ? r.slots : {},
      profileBase: r.profileBase ?? null,
      tombstones: Array.isArray(r.tombstones) ? r.tombstones : [],
      localOnly: Array.isArray(r.localOnly) ? r.localOnly : [],
      profileLocalOnly: !!r.profileLocalOnly,
      outbox: Array.isArray(r.outbox) ? r.outbox : [],
      posts: r.posts && typeof r.posts === 'object' ? r.posts : {},
      captured: Array.isArray(r.captured) ? r.captured : [],
      lastUploadAt: r.lastUploadAt && typeof r.lastUploadAt === 'object' ? r.lastUploadAt : {},
      claims: typeof r.claims === 'number' ? r.claims : 0,
      paused: r.paused === true,
    }
  } catch {
    return freshRecord()
  }
}

/** Trim the lists that grow (posts and captured keys keep the newest). */
export function capRecord(r: OnlineRecord): OnlineRecord {
  const postKeys = Object.keys(r.posts)
  const posts = postKeys.length > CAP_POSTS ? Object.fromEntries(postKeys.sort().slice(-CAP_POSTS).map((k) => [k, r.posts[k]])) : r.posts
  return { ...r, posts, captured: r.captured.slice(-CAP_CAPTURED), localOnly: r.localOnly.slice(-20), tombstones: r.tombstones.slice(-20) }
}

/** The record as stored, or a fresh one. A fresh record that could not be stored still works for this visit. */
export function loadRecord(): OnlineRecord {
  try {
    const r = parseRecord(localStorage.getItem(ONLINE_KEY))
    if (!localStorage.getItem(ONLINE_KEY)) saveRecord(r)
    return r
  } catch {
    return freshRecord()
  }
}

export function saveRecord(r: OnlineRecord): void {
  try {
    localStorage.setItem(ONLINE_KEY, JSON.stringify(capRecord(r)))
  } catch {
    // storage full or blocked: the sync state lives for this visit only
  }
}

/** Read, change and store the record in one step. */
export function updateRecord(fn: (r: OnlineRecord) => OnlineRecord | void): OnlineRecord {
  const r = loadRecord()
  const next = fn(r) ?? r
  saveRecord(next)
  return next
}

/** Whether supabase-js has a session stored on this device (so the client should start at boot). */
export function hasStoredSession(): boolean {
  try {
    return !!localStorage.getItem(AUTH_KEY)
  } catch {
    return false
  }
}

export function promptDismissed(id: string): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(PROMPTS_KEY) ?? '{}') as Record<string, unknown>
    return !!v[id]
  } catch {
    return false
  }
}

export function dismissPrompt(id: string): void {
  try {
    const v = JSON.parse(localStorage.getItem(PROMPTS_KEY) ?? '{}') as Record<string, unknown>
    localStorage.setItem(PROMPTS_KEY, JSON.stringify({ ...v, [id]: true }))
  } catch {
    // remembered for this visit only
  }
}
