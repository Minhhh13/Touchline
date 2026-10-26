/**
 * The cloud-save decision table: what to do with one slot, given what this device holds (L), the cloud row (R) and
 * the base (B, what this device last saw the cloud agree to). Pure; the sync engine runs it per slot after a pull
 * and carries the plan out. The rules that matter most:
 *  - absence is never a deletion: a slot that is empty here is only deleted in the cloud when this session saw the
 *    game leave it (a tombstone) and nobody has written the row since;
 *  - the same game on two devices resolves by progress, keeping the other copy as the cloud's previous one;
 *  - two different games ask the player, and play is never blocked.
 * Row numbers refer to the table in the online build plan (section 3.4) and docs/ONLINE.md.
 */
import { compareProgress } from './slots'

export interface LocalSlot {
  gameId: string
  hash: string
  progress: number[]
  /** When this device last changed the slot (ISO); breaks a progress tie. */
  savedAt?: string
}

export interface RemoteSlot {
  revision: number
  gameId: string
  hash: string
  /** The row is a tombstone: the game was abandoned on purpose on some device. */
  deleted: boolean
  progress: number[]
  deviceId?: string
  clientSavedAt?: string | null
}

export interface BaseSlot {
  gameId: string
  revision: number
  hash: string
  progress: number[]
}

/** A transition this session saw: the slot held `gameId` and now holds nothing. */
export interface Tombstone {
  gameId: string
}

export type SlotPlan =
  | { action: 'none'; row: number }
  /** Nothing to move; record R as the new base. */
  | { action: 'in_sync'; row: number }
  /** Fetch R's object. `park` files it in the parked slot (it never replaces the active game); `replace` swaps the slot's game. */
  | { action: 'download'; row: number; mode: 'park' | 'replace'; note?: 'restored_newer' | 'newer_elsewhere' }
  /** Upload L and claim it against `baseRevision`; the cloud's current copy becomes its previous one. */
  | { action: 'upload'; row: number; baseRevision: number; note?: 'uploaded_again' | 'kept_removed_elsewhere' | 'continued_elsewhere' }
  /** Download R and apply it, then upload L once with `p_as_previous` so the losing copy stays in Cloud history. */
  | { action: 'download_keep_local_as_previous'; row: number; baseRevision: number }
  /** Tombstone the cloud row (`save_delete`). */
  | { action: 'delete_remote'; row: number; baseRevision: number }
  /** Ask: "This Season was abandoned on another device: Keep it here / Remove it here". */
  | { action: 'ask_abandoned'; row: number; baseRevision: number }
  /** Ask: two different games claim the slot; keep this device's or use the cloud's. */
  | { action: 'ask_conflict'; row: number; baseRevision: number }

/** Which side of a same-game split is further along: progress first, then the later save. */
function localWins(l: LocalSlot, r: RemoteSlot): boolean {
  const d = compareProgress(l.progress, r.progress)
  if (d !== 0) return d > 0
  return (l.savedAt ?? '') >= (r.clientSavedAt ?? '')
}

export function planSlot(local: LocalSlot | null, remote: RemoteSlot | null, base: BaseSlot | null, tombstone: Tombstone | null): SlotPlan {
  const live = remote && !remote.deleted ? remote : null
  if (!local) {
    // 1: nothing anywhere (or only a tombstone, which needs nothing from a device that holds nothing)
    if (!live) return { action: 'none', row: 1 }
    // 2: a fresh device: the cloud copy is parked, never made active
    if (!base) return { action: 'download', row: 2, mode: 'park' }
    // 3: the game left this slot in this session and nobody has written the row since
    if (tombstone && tombstone.gameId === live.gameId && live.revision === base.revision) return { action: 'delete_remote', row: 3, baseRevision: base.revision }
    // 4: absence alone (storage evicted, a failed write, a fresh profile) is never a deletion
    return { action: 'download', row: 4, mode: 'park' }
  }
  if (!remote) {
    // 6 and 7: first upload, or the row was deleted elsewhere (cloud data wiped) and this device still has the game
    return base ? { action: 'upload', row: 7, baseRevision: 0, note: 'uploaded_again' } : { action: 'upload', row: 6, baseRevision: 0 }
  }
  if (remote.deleted) {
    if (remote.gameId === local.gameId) {
      // 5: abandoned elsewhere. Unchanged here since the base: ask. Played on here since: keep it, and say so.
      if (base && base.gameId === local.gameId && base.hash === local.hash) return { action: 'ask_abandoned', row: 5, baseRevision: remote.revision }
      return { action: 'upload', row: 5, baseRevision: remote.revision, note: 'kept_removed_elsewhere' }
    }
    // A different game over a tombstone: this device started something new in the slot
    return { action: 'upload', row: 11, baseRevision: remote.revision }
  }
  const sameGame = local.gameId === remote.gameId
  // 8: identical content
  if (sameGame && local.hash === remote.hash) return { action: 'in_sync', row: 8 }
  const baseIsThisGame = !!base && base.gameId === local.gameId
  if (sameGame && baseIsThisGame) {
    const remoteMoved = remote.revision !== base!.revision
    const localMoved = local.hash !== base!.hash
    if (!remoteMoved && localMoved) {
      // 9: only this device moved. Forward: upload. Backwards (an older save loaded after a storage failure): restore.
      if (compareProgress(local.progress, base!.progress) >= 0) return { action: 'upload', row: 9, baseRevision: remote.revision }
      return { action: 'download', row: 9, mode: 'replace', note: 'restored_newer' }
    }
    // 10: only the cloud moved
    if (remoteMoved && !localMoved) return { action: 'download', row: 10, mode: 'replace', note: 'newer_elsewhere' }
  }
  if (sameGame) {
    // 12: both moved since the base (or there is no base for this game): the copy further along wins, the other is kept
    if (localWins(local, remote)) return { action: 'upload', row: 12, baseRevision: remote.revision, note: 'continued_elsewhere' }
    return { action: 'download_keep_local_as_previous', row: 12, baseRevision: remote.revision }
  }
  // 11: this device started a new game in the slot, and the cloud still holds the game it last agreed to
  if (base && base.gameId === remote.gameId && base.revision === remote.revision) return { action: 'upload', row: 11, baseRevision: remote.revision }
  // 13: two different games: ask
  return { action: 'ask_conflict', row: 13, baseRevision: remote.revision }
}
