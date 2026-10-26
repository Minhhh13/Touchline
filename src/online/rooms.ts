/**
 * The online head-to-head room open on this device (docs/ONLINE.md section 5e): its seat, the polling and the calls.
 *
 * A seat is a random token the Edge Function issued when this device made or joined the room, kept per device in
 * `localStorage['touchline-rooms-v1']` (two days at most, never synced, never part of the game save). Every write goes
 * through the function (`room.create`, `room.join`, `room.pick`, `room.leave`, `room.resume`), as a guest when nobody
 * is signed in; the room itself is read with the public `h2h_peek` RPC, polled every few seconds while the room is
 * open (`pollDelay`), with the version last seen so an unchanged room costs a few bytes. No Supabase code here: the
 * transport is handed in (the runtime's), so the tests drive it against the server harness.
 */
import { roomEnded, type RoomManagerInput, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import type { FunctionReply } from './transport'

export const ROOMS_KEY = 'touchline-rooms-v1'
/** How long a seat token is kept on the device (a room is deleted a day after it ends). */
export const SEAT_KEEP_MS = 2 * 86400000

export interface SeatRecord {
  seat: 0 | 1
  token: string
  /** Epoch ms the seat was taken. */
  at: number
  /** The finished room was credited to this device's Trophy Room. */
  credited?: boolean
}

/** Where the seats live (localStorage in the browser; a map in the tests). */
export interface SeatStore {
  get(): Record<string, SeatRecord>
  set(all: Record<string, SeatRecord>): void
}

export const browserSeats: SeatStore = {
  get() {
    try {
      const raw = localStorage.getItem(ROOMS_KEY)
      const v = raw ? (JSON.parse(raw) as unknown) : null
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, SeatRecord>) : {}
    } catch {
      return {}
    }
  },
  set(all) {
    try {
      if (Object.keys(all).length) localStorage.setItem(ROOMS_KEY, JSON.stringify(all))
      else localStorage.removeItem(ROOMS_KEY)
    } catch {
      // A private window or full storage: the seat lasts as long as this page
    }
  },
}

/** The seats still worth keeping: well formed and younger than SEAT_KEEP_MS. */
export function liveSeats(all: Record<string, SeatRecord>, now: number): Record<string, SeatRecord> {
  const out: Record<string, SeatRecord> = {}
  for (const [code, r] of Object.entries(all)) {
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code) || !r || (r.seat !== 0 && r.seat !== 1) || typeof r.token !== 'string' || typeof r.at !== 'number') continue
    if (now - r.at > SEAT_KEEP_MS) continue
    out[code] = r
  }
  return out
}

/** What the session needs from the backend. */
export interface RoomTransport {
  invoke(body: Record<string, unknown>, opts?: { guest?: boolean }): Promise<FunctionReply>
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>
}

/** The room as the screens see it (`onlineStore.room`). */
export interface RoomUi {
  code: string
  view: RoomView | null
  /** This device's seat, or null (it has not joined, or never held one). */
  seat: 0 | 1 | null
  /** The last action's or poll's failure, worded for the player; `errorCode` is the server's code. */
  error: string | null
  errorCode: string | null
  /** A call is in flight (the buttons wait). */
  busy: boolean
  /** No room has that code (never made, or purged). */
  missing: boolean
}

/** How long until the next poll, or null to stop: quick while the other manager picks, slower otherwise, slow when the tab is hidden. */
export function pollDelay(view: RoomView | null, seat: 0 | 1 | null, visible: boolean): number | null {
  if (view && roomEnded(view.status)) return null
  let ms = !view ? 3000 : view.status === 'waiting' ? 3000 : view.turn === seat ? 6000 : 2000
  if (!visible) ms = Math.max(ms, 15000)
  return ms
}

/** The player's words for a refusal the server gave (its reason when it has one). */
export function roomMessage(code: string, reason: string | undefined): string {
  if (code === 'network') return 'No connection: check your connection and try again.'
  if (code === 'rate_limited') return 'Too many tries for now: wait a few minutes and try again.'
  if (code === 'rooms_busy') return 'Too many rooms are open just now: try again in a few minutes.'
  if (code === 'data_mismatch' || code === 'engine_mismatch') return reason ?? 'A newer version of the game is live: reload the page to play online.'
  if (code === 'no_room') return 'No room has that code. Check it, or ask for a new link.'
  return reason ?? 'The server could not do that just now: try again.'
}

export interface RoomSessionDeps {
  transport: RoomTransport
  seats: SeatStore
  report: (ui: RoomUi | null) => void
  now: () => number
  visible: () => boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (t: unknown) => void
  /** Called once per device for a finished room this device held a seat in (the Trophy Room's credit). */
  onFinished: (room: RoomView, seat: 0 | 1) => void
  /** Whether a user is signed in (only they can take a seat back with `room.resume`). */
  signedIn: () => boolean
}

type Answer = { ok: true; body: Record<string, unknown> } | { ok: false; code: string; message: string; room: RoomView | null }

export class RoomSession {
  private ui: RoomUi | null = null
  private timer: unknown = null
  private polling = false

  constructor(private readonly d: RoomSessionDeps) {}

  get state(): RoomUi | null {
    return this.ui
  }

  private set(patch: Partial<RoomUi>): void {
    if (!this.ui) return
    this.ui = { ...this.ui, ...patch }
    this.d.report(this.ui)
  }

  private seatOf(code: string): SeatRecord | null {
    return liveSeats(this.d.seats.get(), this.d.now())[code] ?? null
  }

  private keepSeat(code: string, rec: SeatRecord): void {
    this.d.seats.set({ ...liveSeats(this.d.seats.get(), this.d.now()), [code]: rec })
  }

  private async call(body: Record<string, unknown>): Promise<Answer> {
    let reply: FunctionReply
    try {
      reply = await this.d.transport.invoke(body, { guest: true })
    } catch {
      return { ok: false, code: 'network', message: roomMessage('network', undefined), room: null }
    }
    if (reply.status === 200 && reply.body.status === 'ok') return { ok: true, body: reply.body }
    const code = typeof reply.body.code === 'string' ? reply.body.code : String(reply.status)
    const reason = typeof reply.body.reason === 'string' ? reply.body.reason : undefined
    return { ok: false, code, message: roomMessage(code, reason), room: null }
  }

  /** Take in a newer view of the room (from a poll or an answer), credit a finished room once, and plan the next poll. */
  private accept(view: RoomView): void {
    if (!this.ui || view.code !== this.ui.code) return
    const old = this.ui.view
    if (!old || view.version > old.version || view.status !== old.status) this.set({ view, missing: false })
    const seat = this.ui.seat
    if (view.status === 'finished' && seat !== null) {
      const rec = this.seatOf(view.code)
      if (rec && !rec.credited) {
        this.keepSeat(view.code, { ...rec, credited: true })
        this.d.onFinished(view, seat)
      }
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = null
    if (!this.ui) return
    const ms = pollDelay(this.ui.view, this.ui.seat, this.d.visible())
    if (ms === null) return
    this.timer = this.d.setTimer(() => {
      this.timer = null
      void this.poll()
    }, ms)
  }

  /** Read the room now (the public reader). */
  async poll(): Promise<void> {
    const ui = this.ui
    if (!ui || this.polling) return
    this.polling = true
    try {
      const got = await this.d.transport.rpc<Record<string, unknown> | null>('h2h_peek', { p_code: ui.code, p_since: ui.view?.version ?? null })
      if (this.ui?.code !== ui.code) return
      if (!got) {
        this.set({ missing: true, view: null })
        return
      }
      if (got.unchanged === true) {
        if (this.ui.error && this.ui.errorCode === 'network') this.set({ error: null, errorCode: null })
        this.schedule()
        return
      }
      if (this.ui.errorCode === 'network') this.set({ error: null, errorCode: null })
      this.accept(got as unknown as RoomView)
    } catch {
      if (this.ui?.code === ui.code) {
        this.set({ error: roomMessage('network', undefined), errorCode: 'network' })
        this.schedule()
      }
    } finally {
      this.polling = false
    }
  }

  /** Open a room by its code: this device's seat if it holds one, then the room itself. */
  async open(code: string): Promise<void> {
    if (this.ui?.code === code) {
      await this.poll()
      return
    }
    this.close()
    const rec = this.seatOf(code)
    this.ui = { code, view: null, seat: rec?.seat ?? null, error: null, errorCode: null, busy: false, missing: false }
    this.d.report(this.ui)
    await this.poll()
  }

  /** Stop watching (the screen closed). The seat stays on the device. */
  close(): void {
    if (this.timer !== null) this.d.clearTimer(this.timer)
    this.timer = null
    this.ui = null
    this.d.report(null)
  }

  private async act(body: Record<string, unknown>, after?: (b: Record<string, unknown>) => void): Promise<boolean> {
    if (!this.ui || this.ui.busy) return false
    const code = this.ui.code
    this.set({ busy: true, error: null, errorCode: null })
    const a = await this.call(body)
    if (this.ui?.code !== code) return false
    this.set({ busy: false })
    if (!a.ok) {
      this.set({ error: a.message, errorCode: a.code })
      // The room moved on or ended under us: read it again so the screen shows where it is
      if (['stale', 'not_your_turn', 'room_closed', 'room_full'].includes(a.code)) void this.poll()
      if (a.code === 'no_room') this.set({ missing: true })
      return false
    }
    after?.(a.body)
    const view = a.body.room as RoomView | undefined
    if (view) this.accept(view)
    return true
  }

  /** Make a room: this device takes seat 0. Resolves to the room's code, or null (the error is on the state). */
  async create(settings: RoomSettings, manager: RoomManagerInput, engine: string, data: string): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
    const a = await this.call({ op: 'room.create', settings, manager, engine, data })
    if (!a.ok) return { ok: false, message: a.message }
    const view = a.body.room as RoomView
    this.keepSeat(view.code, { seat: 0, token: String(a.body.token), at: this.d.now() })
    this.close()
    this.ui = { code: view.code, view: null, seat: 0, error: null, errorCode: null, busy: false, missing: false }
    this.accept(view)
    return { ok: true, code: view.code }
  }

  /** Take seat 1 of the open room. */
  join(manager: RoomManagerInput, engine: string, data: string): Promise<boolean> {
    const code = this.ui?.code
    return this.act({ op: 'room.join', code, manager, engine, data }, (b) => {
      if (!code) return
      this.keepSeat(code, { seat: 1, token: String(b.token), at: this.d.now() })
      this.set({ seat: 1 })
    })
  }

  /** This seat's pick (the server replays the room and answers with it). */
  pick(playerSeasonId: string, slotId: string): Promise<boolean> {
    const ui = this.ui
    const rec = ui ? this.seatOf(ui.code) : null
    if (!ui?.view || !rec) return Promise.resolve(false)
    return this.act({ op: 'room.pick', code: ui.code, token: rec.token, version: ui.view.version, playerSeasonId, slotId })
  }

  /** Leave the room (the other device reads that on its next poll); the seat is forgotten here. */
  async leave(): Promise<boolean> {
    const ui = this.ui
    const rec = ui ? this.seatOf(ui.code) : null
    if (!ui || !rec) return false
    const ok = await this.act({ op: 'room.leave', code: ui.code, token: rec.token })
    if (ok || this.ui?.errorCode === 'room_closed' || this.ui?.errorCode === 'no_room') this.forget(ui.code)
    return ok
  }

  /** Signed in: take this account's seat back on this device with a new token. */
  resume(): Promise<boolean> {
    const code = this.ui?.code
    if (!code || !this.d.signedIn()) return Promise.resolve(false)
    return this.act({ op: 'room.resume', code }, (b) => {
      if (b.seat !== 0 && b.seat !== 1) return
      this.keepSeat(code, { seat: b.seat, token: String(b.token), at: this.d.now() })
      this.set({ seat: b.seat })
    })
  }

  private forget(code: string): void {
    const all = liveSeats(this.d.seats.get(), this.d.now())
    delete all[code]
    this.d.seats.set(all)
  }

  /** A seat this device holds in a room that has not ended (Home's "Back to your room"). */
  openSeats(): string[] {
    return Object.keys(liveSeats(this.d.seats.get(), this.d.now()))
  }

  /** The page became visible or hidden: poll sooner or later. */
  visibilityChanged(): void {
    if (this.d.visible()) void this.poll()
    else this.schedule()
  }
}
