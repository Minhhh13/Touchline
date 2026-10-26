import { describe, expect, it } from 'vitest'
import { planSlot, type BaseSlot, type LocalSlot, type RemoteSlot } from '../core/syncPlan'

const L = (over: Partial<LocalSlot> = {}): LocalSlot => ({ gameId: 'g1', hash: 'h-local', progress: [1, 2, 10, 0, 0], savedAt: '2026-10-25T10:00:00Z', ...over })
const R = (over: Partial<RemoteSlot> = {}): RemoteSlot => ({ revision: 4, gameId: 'g1', hash: 'h-remote', deleted: false, progress: [1, 2, 8, 0, 0], clientSavedAt: '2026-10-25T09:00:00Z', ...over })
const B = (over: Partial<BaseSlot> = {}): BaseSlot => ({ gameId: 'g1', revision: 4, hash: 'h-base', progress: [1, 2, 8, 0, 0], ...over })

describe('planSlot: the decision table', () => {
  it('row 1: nothing here, nothing live there', () => {
    expect(planSlot(null, null, null, null)).toEqual({ action: 'none', row: 1 })
    expect(planSlot(null, R({ deleted: true }), B(), null)).toEqual({ action: 'none', row: 1 })
  })

  it('row 2: a fresh device parks the cloud copy', () => {
    expect(planSlot(null, R(), null, null)).toEqual({ action: 'download', row: 2, mode: 'park' })
  })

  it('row 3: a game this session saw leave the slot is deleted in the cloud, only if nobody wrote since', () => {
    expect(planSlot(null, R(), B(), { gameId: 'g1' })).toEqual({ action: 'delete_remote', row: 3, baseRevision: 4 })
    expect(planSlot(null, R({ revision: 5 }), B(), { gameId: 'g1' })).toMatchObject({ action: 'download', row: 4, mode: 'park' })
  })

  it('row 4: absence alone is never a deletion, and a tombstone of another game does not count', () => {
    expect(planSlot(null, R(), B(), null)).toEqual({ action: 'download', row: 4, mode: 'park' })
    expect(planSlot(null, R(), B(), { gameId: 'g-other' })).toEqual({ action: 'download', row: 4, mode: 'park' })
  })

  it('row 5: abandoned elsewhere: ask when unchanged here, keep and say so when played on here', () => {
    expect(planSlot(L({ hash: 'h-base' }), R({ deleted: true, revision: 5 }), B(), null)).toEqual({ action: 'ask_abandoned', row: 5, baseRevision: 5 })
    expect(planSlot(L(), R({ deleted: true, revision: 5 }), B(), null)).toEqual({ action: 'upload', row: 5, baseRevision: 5, note: 'kept_removed_elsewhere' })
    expect(planSlot(L({ gameId: 'g2' }), R({ deleted: true, revision: 5 }), B(), null)).toEqual({ action: 'upload', row: 11, baseRevision: 5 })
  })

  it('rows 6 and 7: the first upload, and an upload after the row went', () => {
    expect(planSlot(L(), null, null, null)).toEqual({ action: 'upload', row: 6, baseRevision: 0 })
    expect(planSlot(L(), null, B(), null)).toEqual({ action: 'upload', row: 7, baseRevision: 0, note: 'uploaded_again' })
  })

  it('row 8: identical content is in sync', () => {
    expect(planSlot(L({ hash: 'same' }), R({ hash: 'same' }), B(), null)).toEqual({ action: 'in_sync', row: 8 })
    expect(planSlot(L({ hash: 'same' }), R({ hash: 'same' }), null, null)).toEqual({ action: 'in_sync', row: 8 })
  })

  it('row 9: only this device moved: forward uploads, backwards restores the cloud copy', () => {
    expect(planSlot(L(), R({ hash: 'h-base' }), B(), null)).toEqual({ action: 'upload', row: 9, baseRevision: 4 })
    expect(planSlot(L({ progress: [1, 2, 3, 0, 0] }), R({ hash: 'h-base' }), B(), null)).toEqual({ action: 'download', row: 9, mode: 'replace', note: 'restored_newer' })
    expect(planSlot(L({ progress: [1, 2, 8, 0, 0] }), R({ hash: 'h-base' }), B(), null)).toMatchObject({ action: 'upload', row: 9 })
  })

  it('row 10: only the cloud moved: download and replace', () => {
    expect(planSlot(L({ hash: 'h-base' }), R({ revision: 6 }), B(), null)).toEqual({ action: 'download', row: 10, mode: 'replace', note: 'newer_elsewhere' })
  })

  it('row 11: this device started a new game where the cloud still holds the agreed one', () => {
    expect(planSlot(L({ gameId: 'g2' }), R(), B(), null)).toEqual({ action: 'upload', row: 11, baseRevision: 4 })
  })

  it('row 12: both moved: the copy further along wins, the other is kept as the previous one', () => {
    expect(planSlot(L({ progress: [1, 2, 12, 0, 0] }), R({ revision: 6, progress: [1, 2, 9, 0, 0] }), B(), null)).toEqual({ action: 'upload', row: 12, baseRevision: 6, note: 'continued_elsewhere' })
    expect(planSlot(L({ progress: [1, 2, 9, 0, 0] }), R({ revision: 6, progress: [1, 2, 12, 0, 0] }), B(), null)).toEqual({ action: 'download_keep_local_as_previous', row: 12, baseRevision: 6 })
    // A progress tie goes to the later save
    expect(planSlot(L({ progress: [1, 2, 9, 0, 0], savedAt: '2026-10-25T08:00:00Z' }), R({ revision: 6, progress: [1, 2, 9, 0, 0] }), B(), null)).toMatchObject({ action: 'download_keep_local_as_previous' })
    expect(planSlot(L({ progress: [1, 2, 9, 0, 0], savedAt: '2026-10-25T11:00:00Z' }), R({ revision: 6, progress: [1, 2, 9, 0, 0] }), B(), null)).toMatchObject({ action: 'upload', row: 12 })
    // The same game with no base (restored from an export on a second device) resolves the same way
    expect(planSlot(L({ progress: [2, 0, 0, 0, 1] }), R(), null, null)).toMatchObject({ action: 'upload', row: 12 })
    // A base for another game counts as no base for this one
    expect(planSlot(L(), R({ progress: [3, 0, 0, 0, 2] }), B({ gameId: 'g0' }), null)).toMatchObject({ action: 'download_keep_local_as_previous', row: 12 })
  })

  it('row 13: two different games ask, whatever the progress', () => {
    expect(planSlot(L({ gameId: 'g2' }), R({ revision: 6 }), B(), null)).toEqual({ action: 'ask_conflict', row: 13, baseRevision: 6 })
    expect(planSlot(L({ gameId: 'g2' }), R(), null, null)).toEqual({ action: 'ask_conflict', row: 13, baseRevision: 4 })
    expect(planSlot(L({ gameId: 'g2' }), R({ gameId: 'g3' }), B(), null)).toEqual({ action: 'ask_conflict', row: 13, baseRevision: 4 })
  })
})
