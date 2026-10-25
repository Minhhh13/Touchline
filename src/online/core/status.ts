/**
 * The one-line save status the Account screen and the top-bar menu show: "Saved to your account ✓ · 2 min ago",
 * "Saving…", or why not. Pure (the time is passed in).
 */
import type { SyncStatus } from '../state'

/** "just now", "2 min ago", "3 h ago", "4 days ago" from two epoch-ms times. */
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export interface SavedLine {
  text: string
  tone: 'good' | 'busy' | 'warn' | 'muted'
}

/** What the save status says for the sync state, the last successful sync (ISO or null) and now. */
export function savedLine(status: SyncStatus, lastSyncAt: string | null, now: number): SavedLine {
  if (status === 'syncing') return { text: 'Saving to your account…', tone: 'busy' }
  if (status === 'offline') return { text: 'Offline: saved on this device, backed up when you are back', tone: 'warn' }
  if (status === 'error') return { text: 'Could not save to your account: retrying', tone: 'warn' }
  if (status === 'paused') return { text: 'Backup paused on this device: press Sync now to resume', tone: 'warn' }
  if (status === 'off') return { text: 'Not signed in', tone: 'muted' }
  const t = lastSyncAt ? Date.parse(lastSyncAt) : NaN
  if (Number.isNaN(t)) return { text: 'Getting your account ready…', tone: 'busy' }
  return { text: `Saved to your account ✓ · ${ago(t, now)}`, tone: 'good' }
}
