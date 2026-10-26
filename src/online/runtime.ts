/**
 * The running online layer: the Supabase client, the session, the cloud sync engine with its timers and events,
 * the ranked-post outbox and today's pins. Loaded with a dynamic `import()` only when the build is configured and
 * the device has a session, came back from a sign-in, or the player opened an online surface (`api.ts`).
 * Everything the screens need goes through `api.ts`; everything they show comes from `state.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION } from '@engine/version'
import { useStore, slotOf } from '@game/store'
import { onlineConfig, type OnlineConfig } from './config'
import { createOnlineClient } from './client'
import { consumeAuthRedirect, sessionOf, signOut as authSignOut, type AuthLike } from './auth'
import type { AuthRedirect } from './core/authUrl'
import { deviceLabel, type MetaContext, type SlotId } from './core/slots'
import { freshRecord, loadRecord, saveRecord } from './localState'
import { flushOutbox, nextDue } from './outbox'
import { onlineStore, type OnlineSession, type OnlineState } from './state'
import { SupabaseTransport, type OnlineTransport, type CloudRow } from './transport'
import { browserSeats, RoomSession } from './rooms'
import { SEASON_UPLOAD_GAP_MS, SyncEngine, type SyncOptions, type SyncStoreLike } from './sync'
import { weekKeyOf } from './weekly'
import type { PuzzlePin } from './server/dailyVerify'
import { DELETE_CONFIRMATION } from './server/validate'

const PERIODIC_MS = 5 * 60000
const HIDDEN_RESYNC_MS = 60000

const report = (patch: Partial<OnlineState>) => onlineStore.setState(patch)

/** The game store as the sync engine sees it. */
export const gameStoreForSync: SyncStoreLike = {
  getState: () => {
    const s = useStore.getState()
    return { game: s.game, parked: s.parked, h2h: s.h2h, profile: s.profile, shortlist: s.shortlist, screen: s.screen }
  },
  importCloudGame: (slot, game, mode) => useStore.getState().importCloudGame(slot, game, mode),
  importCloudH2H: (h2h, mode) => void useStore.getState().importCloudH2H(h2h, mode),
  applyCloudProfile: (profile, shortlist) => useStore.getState().applyCloudProfile(profile, shortlist),
  discardSlot: (slot) => {
    const s = useStore.getState()
    if (slot === 'h2h') s.abandonH2H()
    else if (s.game && slotOf(s.game) === slot) s.abandonGame()
    else s.discardParked(slot)
  },
  showToast: (text) => useStore.getState().showToast(text),
}

function metaContext(): MetaContext {
  return {
    get dataVersion() {
      return useStore.getState().universe?.generatedAt ?? ''
    },
    engineVersion: ENGINE_VERSION,
    appBuild: `e${ENGINE_VERSION}`,
    deviceLabel: typeof navigator === 'undefined' ? 'device' : deviceLabel(navigator.userAgent),
  }
}

/** Run `fn` only in the tab holding the sync lock (every tab when the Locks API is missing). */
async function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks) return fn()
  await locks.request('touchline-cloud-sync', { ifAvailable: true }, async (lock) => {
    if (lock) await fn()
  })
}

export class Runtime {
  readonly sb: SupabaseClient
  readonly transport: OnlineTransport
  readonly ready: Promise<void>
  /** The online head-to-head room on this device (guests too: every write goes through the Edge Function). */
  readonly rooms: RoomSession
  private engine: SyncEngine | null = null
  private session: OnlineSession | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private timerAt = 0
  private outboxTimer: ReturnType<typeof setTimeout> | null = null
  private retry = 0
  private hiddenAt = 0
  private unsubscribe: (() => void) | null = null

  constructor(cfg: OnlineConfig, redirect: AuthRedirect | null) {
    const sb = createOnlineClient(cfg)
    this.sb = sb
    this.transport = new SupabaseTransport(this.sb, cfg)
    this.rooms = new RoomSession({
      transport: this.transport,
      seats: browserSeats,
      report: (room) => report({ room }),
      now: () => Date.now(),
      visible: () => document.visibilityState === 'visible',
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      // A finished room leaves one mark on this device's Trophy Room online shelf (apart from the hot-seat's)
      onFinished: (room, seat) => useStore.getState().creditH2HRoom(room.result?.winner === seat),
      signedIn: () => this.signedIn,
    })
    report({ configured: true, started: true })
    this.sb.auth.onAuthStateChange((_event, session) => {
      // Never call back into auth from inside its own callback (supabase-js would wait on itself)
      setTimeout(() => void this.onSession(sessionOf(session)), 0)
    })
    this.ready = (async () => {
      const res = await consumeAuthRedirect(sb.auth as unknown as AuthLike, redirect, (href) => history.replaceState(history.state, '', href), () => location.href)
      if (res && !res.ok) useStore.getState().showToast(res.message)
      else if (res?.ok) useStore.getState().showToast('Signed in.')
      const { data } = await sb.auth.getSession()
      await this.onSession(sessionOf(data.session))
      await this.refreshPins()
    })().catch(() => undefined)
    this.listen()
  }

  get auth(): AuthLike {
    return this.sb.auth as unknown as AuthLike
  }

  get signedIn(): boolean {
    return !!this.session
  }

  get userId(): string | null {
    return this.session?.userId ?? null
  }

  private async onSession(s: OnlineSession | null): Promise<void> {
    if (s?.userId === this.session?.userId) {
      if (s) report({ session: s })
      return
    }
    this.session = s
    this.engine = null
    this.clearTimer()
    if (!s) {
      report({ session: null, account: null, accountLoaded: false, conflicts: [], accountSwitch: null, syncStatus: 'idle', syncMessage: null })
      return
    }
    report({ session: s, syncStatus: 'idle', accountLoaded: false })
    this.engine = new SyncEngine({ transport: this.transport, store: gameStoreForSync, userId: s.userId, load: loadRecord, save: saveRecord, now: () => Date.now(), meta: metaContext(), report })
    void this.loadAccount()
    void this.flushOutbox()
    void this.engine.sweepOrphans()
    void this.syncNow()
    void this.refreshPins()
  }

  async loadAccount(): Promise<void> {
    const uid = this.userId
    if (!uid) return
    try {
      report({ account: await this.transport.getAccount(uid), accountLoaded: true })
    } catch {
      // shown as "no name yet"; the boards assign a default at the first post
    }
  }

  // ------------------------------------------------------------------ sync scheduling

  private listen(): void {
    this.unsubscribe = useStore.subscribe((s, prev) => {
      if (!this.engine) return
      const changed = this.engine.observe(prev, s)
      for (const slot of changed) this.scheduleSlot(slot, prev, s)
      if (s.profile !== prev.profile || s.shortlist !== prev.shortlist) this.schedule(10000)
    })
    window.addEventListener('online', () => {
      void this.syncNow()
      void this.flushOutbox()
    })
    window.addEventListener('offline', () => report({ syncStatus: 'offline', syncMessage: 'Offline: your games sync when the connection is back.' }))
    document.addEventListener('visibilitychange', () => {
      this.rooms.visibilityChanged()
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now()
        void this.syncNow({ force: true })
      } else if (this.hiddenAt && Date.now() - this.hiddenAt >= HIDDEN_RESYNC_MS) void this.syncNow()
    })
    window.addEventListener('pagehide', () => void this.syncNow({ force: true }))
    setInterval(() => {
      if (document.visibilityState === 'visible') void this.syncNow()
    }, PERIODIC_MS)
  }

  /** The push budget: Quick and head-to-head 20 s after a change (2 s at a checkpoint); Season and Dynasty at most every 2 minutes. */
  private scheduleSlot(slot: SlotId, prev: ReturnType<typeof useStore.getState>, next: ReturnType<typeof useStore.getState>): void {
    const checkpoint = (() => {
      const a = prev.game
      const b = next.game
      if (!a || !b || a.id !== b.id) return true
      return a.phase !== b.phase || (a.season?.matchweek ?? 0) !== (b.season?.matchweek ?? 0) || a.year !== b.year
    })()
    if (slot === 'season' || slot === 'dynasty') {
      const last = loadRecord().lastUploadAt[slot] ?? 0
      this.schedule(Math.max(checkpoint ? 2000 : 20000, last + SEASON_UPLOAD_GAP_MS - Date.now() + 500))
    } else this.schedule(checkpoint ? 2000 : 20000)
  }

  private schedule(delay: number): void {
    const at = Date.now() + Math.max(0, delay)
    if (this.timer && this.timerAt <= at) return
    this.clearTimer()
    this.timerAt = at
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, Math.max(0, delay))
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async syncNow(opts: SyncOptions = {}): Promise<void> {
    const engine = this.engine
    if (!engine) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      report({ syncStatus: 'offline', syncMessage: 'Offline: your games sync when the connection is back.' })
      return
    }
    await withLock(async () => {
      const out = await engine.sync(opts)
      if (out.ok) this.retry = 0
      else if (out.error && out.error.kind !== 'auth' && out.error.kind !== 'guest' && out.error.kind !== 'bad') {
        this.retry++
        const wait = out.error.kind === 'rate' ? 15 * 60000 : Math.min(600000, 5000 * 2 ** (this.retry - 1)) * (1 + Math.random() * 0.3)
        this.schedule(wait)
      }
    })
  }

  async chooseAccount(choice: 'upload' | 'keep' | 'replace'): Promise<void> {
    await this.engine?.chooseAccount(choice)
  }

  async cloudHistory(): Promise<CloudRow[]> {
    if (!this.engine) return []
    return this.transport.listSaves()
  }

  async restorePrevious(row: CloudRow): Promise<boolean> {
    return this.engine ? this.engine.restorePrevious(row) : false
  }

  async deleteCloudData(): Promise<number> {
    return this.engine ? this.engine.deleteCloudData() : 0
  }

  // ------------------------------------------------------------------ outbox and pins

  private flushing: Promise<void> | null = null

  flushOutbox(): Promise<void> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async flushOnce(): Promise<void> {
    const before = loadRecord()
    const rec = await flushOutbox(before, { transport: this.transport, signedIn: this.signedIn, userId: this.userId, now: () => Date.now(), random: Math.random })
    // Entries captured while the flush ran are kept: merge rather than overwrite
    const latest = loadRecord()
    const startIds = new Set(before.outbox.map((e) => e.id))
    const merged = { ...latest, outbox: [...rec.outbox, ...latest.outbox.filter((e) => !startIds.has(e.id))], posts: { ...latest.posts, ...rec.posts } }
    saveRecord(merged)
    report({ posts: merged.posts, outboxCount: merged.outbox.length })
    if (this.outboxTimer) clearTimeout(this.outboxTimer)
    const due = nextDue(merged)
    if (due && this.signedIn) this.outboxTimer = setTimeout(() => void this.flushOutbox(), Math.max(1000, due - Date.now()))
    if (Object.values(rec.posts).some((p) => p.state === 'posted')) void this.refreshPins()
  }

  async refreshPins(): Promise<void> {
    const now = new Date()
    const day = now.toISOString().slice(0, 10)
    const week = weekKeyOf(now)
    const get = async (kind: 'daily' | 'weekly', key: string): Promise<PuzzlePin | null> => {
      try {
        const have = await this.transport.pin(kind, key)
        if (have || !this.signedIn) return have
        // Nobody has pinned it yet: the first up-to-date signed-in client asks the function to (it pins from the live site)
        const reply = await this.transport.invoke(kind === 'daily' ? { op: 'daily.pin', date: day } : { op: 'weekly.pin', week: key })
        const p = reply.status === 200 ? (reply.body.pin as Record<string, unknown> | undefined) : undefined
        if (p && typeof p.seed === 'string') return { kind, key: String(p.key), seed: p.seed, settings: p.settings as PuzzlePin['settings'], settingsHash: String(p.settingsHash), engineVersion: String(p.engineVersion), dataVersion: String(p.dataVersion) }
        return null
      } catch {
        return null
      }
    }
    const [daily, weekly] = await Promise.all([get('daily', day), get('weekly', week)])
    report({ pins: { daily, weekly, day, week } })
  }

  // ------------------------------------------------------------------ account

  async signOut(): Promise<void> {
    await authSignOut(this.auth)
    await this.onSession(null)
  }

  /** `account.delete`: saves, sessions and the user go on the server; local saves stay. */
  async deleteAccount(): Promise<{ ok: boolean; message: string }> {
    const reply = await this.transport.invoke({ op: 'account.delete', confirm: DELETE_CONFIRMATION })
    if (reply.status !== 200) return { ok: false, message: typeof reply.body.reason === 'string' ? reply.body.reason : `The server answered ${reply.status}` }
    await authSignOut(this.auth)
    saveRecord(freshRecord(loadRecord().deviceId))
    await this.onSession(null)
    report({ posts: {}, outboxCount: 0 })
    return { ok: true, message: 'Your account and its cloud data are deleted. The games on this device stay.' }
  }

  dispose(): void {
    this.unsubscribe?.()
    this.clearTimer()
  }
}

let runtime: Runtime | null = null

/** Start the layer once (idempotent). Null when the build is not configured. */
export function startRuntime(redirect: AuthRedirect | null = null): Runtime | null {
  const cfg = onlineConfig()
  if (!cfg) return null
  runtime ??= new Runtime(cfg, redirect)
  return runtime
}

