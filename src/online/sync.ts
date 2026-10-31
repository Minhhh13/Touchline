/**
 * The cloud sync engine: pull the account's rows, run the decision table (`planSlot`) per slot, carry the plan out
 * (upload, download, delete, or ask the player), then merge the profile document. Every game mode syncs: the Quick
 * slot (Quick Drafts, Dailies and Weeklies), Season, Dynasty, the hot-seat head-to-head, the arena and the Run-in,
 * plus the profile and shortlist.
 *
 * Rules it keeps:
 *  - absence is never a deletion: a tombstone is recorded only for a transition this session saw (`observe`);
 *  - nothing is downloaded over the game on screen without the player's "Load it", and nothing moves either way
 *    while a live match is paused at a stop;
 *  - season, dynasty and run-in slots upload at most once every two minutes, unless forced (the page is being hidden);
 *  - a server that refuses the arena or run-in slot (its migration not applied yet) sets that slot aside for the
 *    session; the other slots and the profile sync as before;
 *  - data arrives in the game only through the store's `importCloudGame`, `importCloudH2H` and `applyCloudProfile`,
 *    so it goes through `normaliseGame` like any save.
 * The engine is driven by the runtime (timers, events, the lock); the tests drive it with `FakeTransport`.
 */
import type { Game, Profile } from '@game/types'
import type { H2HGame } from '@game/store'
import { compactGame } from '@game/logic/compact'
import { canonicalJson } from './core/canonical'
import { gunzipText, gzipText, sha256Hex } from './core/bytes'
import { mergeProfileDoc, type ProfileDoc } from './core/merge'
import { LATER_SLOTS, progressKey, saveMeta, slotContents, slotIdentity, SLOT_IDS, throttledSlot, type GameSlotId, type MetaContext, type SaveMeta, type SlotId, type SlotValue, type SyncSource } from './core/slots'
import { planSlot, type LocalSlot, type RemoteSlot, type SlotPlan } from './core/syncPlan'
import type { OnlineRecord } from './localState'
import type { CloudRow, OnlineTransport } from './transport'
import { isTransient, OnlineError } from './transport'
import type { OnlineState, SyncConflict } from './state'

export interface SyncView extends SyncSource {
  profile: Profile
  shortlist: string[]
  screen: string
}

/** The game store as the engine sees it. */
export interface SyncStoreLike {
  getState(): SyncView
  importCloudGame(slot: GameSlotId, game: Game, mode: 'park' | 'replace'): Promise<boolean>
  importCloudH2H(h2h: H2HGame, mode: 'park' | 'replace'): void
  applyCloudProfile(profile: Profile, shortlist: string[]): void
  /** "Remove it here": the slot's game leaves this device (abandon, discard or end the head-to-head). */
  discardSlot(slot: SlotId): void
  showToast(text: string): void
}

export interface SyncDeps {
  transport: OnlineTransport
  store: SyncStoreLike
  userId: string
  load(): OnlineRecord
  save(r: OnlineRecord): void
  now(): number
  meta: MetaContext
  report(patch: Partial<OnlineState>): void
}

export type Resolution =
  | { slot: SlotId; choice: 'keep_local' | 'use_cloud' }
  | { slot: SlotId; choice: 'keep' | 'remove' }
  | { slot: SlotId; choice: 'load' }

/** How a pass ended: `error` is null when it simply waits on the player (an account choice). */
export interface SyncOutcome {
  ok: boolean
  error: OnlineError | null
}

export const SEASON_UPLOAD_GAP_MS = 120000

/** `resume`: the player's own "Sync now", the only way out of the pause "Delete my cloud data" leaves. */
export interface SyncOptions {
  force?: boolean
  resolve?: Resolution
  replaceAll?: boolean
  resume?: boolean
}

export const PAUSED_MESSAGE = 'Cloud sync is off since you deleted your cloud data. Press Sync now to upload the games on this device again.'
const SLOT_NAME: Record<SlotId, string> = { quick: 'Quick Draft', season: 'Season', dynasty: 'Dynasty', h2h: 'head-to-head', arena: 'arena run', runin: 'Run-in' }

/** What a slot uploads: the compacted game (what a local save keeps), or the hot-seat game as it is. */
export function slotPayload(v: SlotValue): unknown {
  return v.kind === 'game' ? compactGame(v.game) : v.h2h
}

interface Encoded {
  text: string
  hash: string
}

const encodeCache = new WeakMap<object, Encoded>()

/** The JSON a slot uploads and its content hash (SHA-256 of the canonical JSON, the same on every device). */
export async function encodeSlot(v: SlotValue): Promise<Encoded> {
  const ref = v.kind === 'game' ? v.game : v.h2h
  const hit = encodeCache.get(ref)
  if (hit) return hit
  const payload = slotPayload(v)
  const out = { text: JSON.stringify(payload), hash: await sha256Hex(canonicalJson(payload)) }
  encodeCache.set(ref, out)
  return out
}

function remoteOf(r: CloudRow): RemoteSlot {
  return { revision: r.revision, gameId: r.gameId, hash: r.contentHash, deleted: !!r.deletedAt, progress: Array.isArray(r.meta?.progress) ? r.meta.progress : [], deviceId: r.deviceId, clientSavedAt: r.clientSavedAt }
}

function asProfileDoc(v: unknown): ProfileDoc | null {
  const d = v as Partial<ProfileDoc> | null
  if (!d || typeof d !== 'object' || d.v !== 1 || !d.profile || typeof d.profile !== 'object' || !Array.isArray(d.shortlist)) return null
  return { v: 1, profile: d.profile, shortlist: d.shortlist.filter((x): x is string => typeof x === 'string') }
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

export class SyncEngine {
  private running: Promise<SyncOutcome> | null = null
  private again = false
  /** When each slot last changed on this device (epoch ms), for progress ties. */
  private changedAt: Partial<Record<SlotId, number>> = {}
  /** The last pass failed for want of a connection. */
  private offline = false
  /** Later slots the server refused this session (its migration is not applied yet): left alone until a reload. */
  private refused = new Set<SlotId>()

  constructor(private readonly d: SyncDeps) {}

  /** The record, claimed for this account when nobody has signed in on this device before. */
  private record(): OnlineRecord {
    const r = this.d.load()
    if (r.userId === null) {
      const claimed = { ...r, userId: this.d.userId }
      this.d.save(claimed)
      return claimed
    }
    return r
  }

  /** Whether another account's sync state is on this device (the player is asked before anything moves). */
  needsAccountChoice(): boolean {
    const r = this.d.load()
    return r.userId !== null && r.userId !== this.d.userId
  }

  /**
   * The answer to "a different account signed in here": upload this device's games to it, keep them on this
   * device only, or replace them with the account's cloud saves.
   */
  async chooseAccount(choice: 'upload' | 'keep' | 'replace'): Promise<void> {
    const r = this.d.load()
    const fresh: OnlineRecord = { ...r, userId: this.d.userId, slots: {}, profileBase: null, tombstones: [], localOnly: [], profileLocalOnly: false, lastUploadAt: {}, paused: false }
    if (choice === 'keep') {
      fresh.localOnly = Object.values(slotContents(this.d.store.getState())).map((v) => slotIdentity(v!))
      fresh.profileLocalOnly = true
    }
    this.d.save(fresh)
    this.d.report({ accountSwitch: null })
    if (choice === 'replace') await this.sync({ replaceAll: true })
    else await this.sync()
  }

  /** Record what left a slot between two store states, and when slots changed. */
  observe(prev: SyncSource, next: SyncSource): SlotId[] {
    const a = slotContents(prev)
    const b = slotContents(next)
    const changed: SlotId[] = []
    const gone: Array<{ slot: SlotId; gameId: string }> = []
    for (const slot of SLOT_IDS) {
      const pa = a[slot]
      const nb = b[slot]
      const ra = pa ? (pa.kind === 'game' ? pa.game : pa.h2h) : null
      const rb = nb ? (nb.kind === 'game' ? nb.game : nb.h2h) : null
      if (ra === rb) continue
      changed.push(slot)
      this.changedAt[slot] = this.d.now()
      if (pa && !nb) gone.push({ slot, gameId: slotIdentity(pa) })
    }
    if (changed.length) {
      const r = this.d.load()
      const at = new Date(this.d.now()).toISOString()
      const tombstones = r.tombstones.filter((t) => !changed.includes(t.slot) || gone.some((g) => g.slot === t.slot && g.gameId === t.gameId))
      for (const g of gone) if (!tombstones.some((t) => t.slot === g.slot && t.gameId === g.gameId)) tombstones.push({ ...g, at })
      if (gone.length || tombstones.length !== r.tombstones.length) this.d.save({ ...r, tombstones })
    }
    return changed
  }

  /** Pull, plan and act once (a second call while one runs makes it run again afterwards). */
  sync(opts: SyncOptions = {}): Promise<SyncOutcome> {
    if (this.running) {
      if (!opts.resolve && !opts.replaceAll && !opts.resume) {
        this.again = true
        return this.running
      }
      return this.running.then(() => this.sync(opts))
    }
    this.running = this.run(opts).finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        void this.sync()
      }
    })
    return this.running
  }

  private async run(opts: SyncOptions): Promise<SyncOutcome> {
    if (this.needsAccountChoice()) {
      this.d.report({ accountSwitch: { previousUserId: this.d.load().userId! }, syncStatus: 'paused', syncMessage: 'Another account synced this device before: choose what to do with its games.' })
      return { ok: false, error: null }
    }
    const held = this.d.load()
    if (held.paused) {
      if (!opts.resume) {
        this.d.report({ syncStatus: 'paused', syncMessage: PAUSED_MESSAGE })
        return { ok: true, error: null }
      }
      this.d.save({ ...held, paused: false })
    }
    // After a dropped connection, a background retry keeps saying offline: each pass can take seconds to fail (the
    // Data API client retries its reads), and "Saving to your account" over and over would claim work that is not
    // happening. The player's own Sync now still shows it working.
    if (!this.offline || opts.resume) this.d.report({ syncStatus: 'syncing' })
    try {
      const rows = await this.d.transport.listSaves()
      const conflicts: SyncConflict[] = []
      for (const slot of SLOT_IDS) {
        if (this.refused.has(slot)) continue
        try {
          const c = await this.syncSlot(slot, rows.find((x) => x.slot === slot) ?? null, opts)
          if (c) conflicts.push(c)
        } catch (e) {
          if (!(LATER_SLOTS.includes(slot) && e instanceof OnlineError && e.kind === 'bad')) throw e
          this.refused.add(slot)
        }
      }
      await this.syncProfile(opts.replaceAll === true)
      const r = this.d.load()
      if (r.claims > 0 && r.claims % 10 === 0) await this.sweepOrphans()
      this.offline = false
      this.d.report({ syncStatus: 'idle', lastSyncAt: new Date(this.d.now()).toISOString(), syncMessage: null, conflicts })
      return { ok: true, error: null }
    } catch (e) {
      const err = e instanceof OnlineError ? e : new OnlineError('network', e instanceof Error ? e.message : String(e))
      this.offline = err.kind === 'network'
      const status = err.kind === 'network' ? 'offline' : err.kind === 'auth' ? 'paused' : 'error'
      const msg = err.kind === 'network' ? 'Offline: your games sync when the connection is back.' : err.kind === 'auth' ? 'Sign in again to keep syncing.' : err.kind === 'rate' ? 'Lots of saves this hour: the next sync waits a little.' : `Sync failed: ${err.message}`
      this.d.report({ syncStatus: status, syncMessage: msg })
      return { ok: false, error: err }
    }
  }

  private local(slot: SlotId): SlotValue | null {
    return slotContents(this.d.store.getState())[slot] ?? null
  }

  private onScreen(v: SlotValue | null): boolean {
    if (!v) return false
    const s = this.d.store.getState()
    return v.kind === 'game' ? v.active && s.screen === 'game' : s.screen === 'h2h'
  }

  private async syncSlot(slot: SlotId, row: CloudRow | null, opts: SyncOptions): Promise<SyncConflict | null> {
    const v = this.local(slot)
    // A live match paused at a stop is never swapped or uploaded mid-match: the slot waits for the whistle
    if (v && v.kind === 'game' && v.game.phase === 'match' && v.game.live) return null
    const rec = this.record()
    if (v && rec.localOnly.includes(slotIdentity(v))) return null
    const resolve = opts.resolve?.slot === slot ? opts.resolve : null
    if (opts.replaceAll && row && !row.deletedAt) {
      await this.download(slot, row, 'replace')
      return null
    }
    const enc = v ? await encodeSlot(v) : null
    const local: LocalSlot | null = v && enc ? { gameId: slotIdentity(v), hash: enc.hash, progress: progressKey(v), savedAt: this.changedAt[slot] ? new Date(this.changedAt[slot]!).toISOString() : undefined } : null
    const tomb = rec.tombstones.find((t) => t.slot === slot && (!row || t.gameId === row.gameId)) ?? null
    const plan: SlotPlan = planSlot(local, row ? remoteOf(row) : null, rec.slots[slot] ?? null, tomb)
    const meta = (m: Partial<SaveMeta> | null | undefined) => (m && typeof m === 'object' && 'mode' in m ? (m as SaveMeta) : null)

    if (resolve && row) {
      if (resolve.choice === 'keep_local' || resolve.choice === 'keep') {
        if (v) await this.upload(slot, v, row.revision, false)
        return null
      }
      if (resolve.choice === 'remove') {
        this.d.store.discardSlot(slot)
        this.setBase(slot, row)
        this.clearTombstones(slot)
        return null
      }
      if (resolve.choice === 'use_cloud' || resolve.choice === 'load') {
        if (plan.action === 'download_keep_local_as_previous' || resolve.choice === 'use_cloud') {
          await this.download(slot, row, 'replace')
          if (v) await this.upload(slot, v, row.revision, true)
        } else await this.download(slot, row, 'replace')
        return null
      }
    }

    switch (plan.action) {
      case 'none':
        if (row?.deletedAt) this.clearTombstones(slot)
        return null
      case 'in_sync':
        if (row) this.setBase(slot, row)
        return null
      case 'download':
        if (!row) return null
        if (plan.mode === 'replace' && this.onScreen(v)) return { kind: 'newer', slot, remote: meta(row.meta) }
        await this.download(slot, row, plan.mode)
        if (plan.note === 'restored_newer') this.d.store.showToast(`Restored newer progress of your ${SLOT_NAME[slot]} from the cloud.`)
        else if (plan.mode === 'replace') this.d.store.showToast(`Your ${SLOT_NAME[slot]} continued on ${row.meta?.deviceLabel ?? 'another device'}: loaded the newer progress.`)
        return null
      case 'upload': {
        if (!v) return null
        if (!opts.force && throttledSlot(slot) && plan.row !== 6) {
          const last = rec.lastUploadAt[slot] ?? 0
          if (this.d.now() - last < SEASON_UPLOAD_GAP_MS) return null
        }
        await this.upload(slot, v, plan.baseRevision, false)
        if (plan.note === 'kept_removed_elsewhere') this.d.store.showToast(`Kept your ${SLOT_NAME[slot]}: it was removed on another device, but you played on here.`)
        return null
      }
      case 'download_keep_local_as_previous':
        if (!row || !v) return null
        if (this.onScreen(v)) return { kind: 'newer', slot, remote: meta(row.meta) }
        await this.download(slot, row, 'replace')
        await this.upload(slot, v, row.revision, true)
        this.d.store.showToast(`Your ${SLOT_NAME[slot]} continued on ${row.meta?.deviceLabel ?? 'another device'}; using the copy further along. The other copy is in Cloud history.`)
        return null
      case 'delete_remote': {
        const res = await this.d.transport.deleteSlot(slot, plan.baseRevision, rec.deviceId)
        await this.removeQuietly(res.obsolete)
        this.bumpClaims()
        if (res.status !== 'conflict') this.clearTombstones(slot)
        const after = this.d.load()
        const slots = { ...after.slots }
        delete slots[slot]
        this.d.save({ ...after, slots })
        return null
      }
      case 'ask_abandoned':
        return { kind: 'abandoned', slot, remote: meta(row?.prevMeta ?? row?.meta), baseRevision: plan.baseRevision, at: row?.deletedAt ?? null }
      case 'ask_conflict':
        return { kind: 'different', slot, local: v ? saveMeta(v, this.d.meta) : null, remote: meta(row?.meta), baseRevision: plan.baseRevision }
    }
  }

  private setBase(slot: SlotId, row: CloudRow): void {
    const r = this.d.load()
    this.d.save({ ...r, slots: { ...r.slots, [slot]: { gameId: row.gameId, revision: row.revision, hash: row.contentHash, progress: Array.isArray(row.meta?.progress) ? row.meta.progress : [] } } })
  }

  private clearTombstones(slot: SlotId): void {
    const r = this.d.load()
    if (r.tombstones.some((t) => t.slot === slot)) this.d.save({ ...r, tombstones: r.tombstones.filter((t) => t.slot !== slot) })
  }

  private bumpClaims(): void {
    const r = this.d.load()
    this.d.save({ ...r, claims: r.claims + 1 })
  }

  private async removeQuietly(paths: string[]): Promise<void> {
    if (!paths.length) return
    try {
      await this.d.transport.remove(paths)
    } catch {
      // left for the orphan sweep
    }
  }

  async sweepOrphans(): Promise<void> {
    try {
      await this.removeQuietly(await this.d.transport.orphans())
    } catch {
      // next time
    }
  }

  /** Fetch and parse a cloud object (the current copy, or the previous one). */
  async fetchObject(path: string): Promise<unknown> {
    const bytes = await this.d.transport.download(path)
    let text: string
    try {
      text = await gunzipText(bytes)
    } catch {
      throw new OnlineError('bad', 'The cloud copy is unreadable')
    }
    return JSON.parse(text) as unknown
  }

  private async apply(slot: SlotId, value: unknown, mode: 'park' | 'replace'): Promise<boolean> {
    if (slot === 'h2h') {
      this.d.store.importCloudH2H(value as H2HGame, mode)
      return true
    }
    return this.d.store.importCloudGame(slot, value as Game, mode)
  }

  private async download(slot: SlotId, row: CloudRow, mode: 'park' | 'replace'): Promise<void> {
    if (!row.objectPath) return
    let value: unknown
    try {
      value = await this.fetchObject(row.objectPath)
    } catch (e) {
      if (e instanceof OnlineError && e.kind === 'bad') {
        this.d.store.showToast(`The cloud copy of your ${SLOT_NAME[slot]} is unreadable; this device keeps its own.`)
        return
      }
      throw e
    }
    if (await this.apply(slot, value, mode)) this.setBase(slot, row)
  }

  /** Upload a slot's value and claim it against `baseRevision` (`asPrevious` files it as the cloud's previous copy). */
  private async upload(slot: SlotId, v: SlotValue, baseRevision: number, asPrevious: boolean): Promise<void> {
    const rec = this.record()
    const enc = await encodeSlot(v)
    const gz = await gzipText(enc.text)
    const now = this.d.now()
    const path = `${this.d.userId}/${slot}/${now}-${enc.hash.slice(0, 16)}.json.gz`
    await this.d.transport.upload(path, gz)
    let res: Awaited<ReturnType<OnlineTransport['claim']>>
    try {
      res = await this.d.transport.claim({ slot, baseRevision, gameId: slotIdentity(v), contentHash: enc.hash, objectPath: path, bytes: gz.length, rawBytes: enc.text.length, meta: saveMeta(v, this.d.meta), deviceId: rec.deviceId, clientSavedAt: new Date(this.changedAt[slot] ?? now).toISOString(), asPrevious })
    } catch (e) {
      // A claim the database refused (the hourly limits, a bad slot, a signed-out session) rolled back, so no row
      // points at the object: it goes now, or each retry would leave another until the folder's 16-object cap refused
      // every upload (the sweep runs only every tenth claim, which a refused claim never counts). A claim with no
      // answer (network, 5xx) may have landed, so its object is left for the sweep, which skips anything a row names.
      if (e instanceof OnlineError && (e.kind === 'rate' || !isTransient(e))) await this.removeQuietly([path])
      throw e
    }
    this.bumpClaims()
    if (res.status === 'conflict') {
      // Never retried blindly: the uploaded object goes, and the next pass pulls and plans again
      await this.removeQuietly([path])
      this.again = true
      return
    }
    await this.removeQuietly(res.obsolete)
    if (asPrevious) return
    const r = this.d.load()
    this.d.save({ ...r, slots: { ...r.slots, [slot]: { gameId: slotIdentity(v), revision: res.revision, hash: enc.hash, progress: progressKey(v) } }, lastUploadAt: { ...r.lastUploadAt, [slot]: now }, tombstones: r.tombstones.filter((t) => t.slot !== slot) })
  }

  private async syncProfile(takeRemote: boolean): Promise<void> {
    const rec = this.record()
    if (rec.profileLocalOnly) return
    const s = this.d.store.getState()
    let local: ProfileDoc = { v: 1, profile: s.profile, shortlist: s.shortlist }
    let remoteRow = await this.d.transport.getProfileDoc()
    let base = rec.profileBase?.doc ?? null
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = remoteRow ? asProfileDoc(remoteRow.data) : null
      const merged = takeRemote && remote ? remote : mergeProfileDoc(base, local, remote)
      if (!same(merged, local)) {
        this.d.store.applyCloudProfile(merged.profile, merged.shortlist)
        local = merged
      }
      if (remoteRow && remote && same(merged, remote)) {
        this.saveProfileBase(remoteRow.revision, merged)
        return
      }
      const res = await this.d.transport.putProfileDoc(remoteRow?.revision ?? 0, merged, rec.deviceId)
      if (res.status === 'ok' || res.status === 'unchanged') {
        this.saveProfileBase(res.revision, merged)
        return
      }
      // conflict: merge with what the cloud holds now and try again
      base = remote ?? base
      remoteRow = { revision: res.revision, data: res.data }
    }
  }

  private saveProfileBase(revision: number, doc: ProfileDoc): void {
    const r = this.d.load()
    this.d.save({ ...r, profileBase: { revision, doc } })
  }

  /** "Restore" in Cloud history: the slot's previous copy (another game, or one abandoned elsewhere) onto this device. */
  async restorePrevious(row: CloudRow): Promise<boolean> {
    if (!row.prevObjectPath) return false
    const value = await this.fetchObject(row.prevObjectPath)
    const ok = await this.apply(row.slot, value, 'replace')
    if (ok) await this.sync({ force: true })
    return ok
  }

  /** "Delete my cloud data": every row and object of this account goes; local saves stay. */
  async deleteCloudData(): Promise<number> {
    const objects = await this.d.transport.deleteAll()
    await this.removeQuietly(objects)
    let left: string[] = []
    try {
      left = await this.d.transport.listFolder(this.d.userId)
    } catch {
      left = []
    }
    await this.removeQuietly(left)
    const r = this.d.load()
    // Paused, or this device's next pass would upload every game and the record straight back
    this.d.save({ ...r, slots: {}, profileBase: null, tombstones: [], lastUploadAt: {}, paused: true })
    this.d.report({ conflicts: [], syncStatus: 'paused', syncMessage: PAUSED_MESSAGE })
    return objects.length + left.length
  }
}

/** Rows that offer "Restore" in Cloud history: a previous copy of a different game, or of one abandoned elsewhere. */
export function restorable(row: CloudRow): boolean {
  return !!row.prevObjectPath && (!!row.deletedAt || row.prevGameId !== row.gameId)
}
