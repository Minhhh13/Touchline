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
import { roomEnded, ROOM_IDLE_MINUTES, ROOM_WAIT_MINUTES, type RoomManagerInput, type RoomSettings, type RoomView } from '@game/logic/h2hRoom'
import { olderEngine } from './engineRoute'
import { normaliseCode } from './core/codes'
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
  /** A rematch: the code of the room it was made from, and the manager it is for (the waiting room's words, the second press of Rematch). */
  rematchOf?: string
  opponent?: string | null
}

/** A rematch room as the screens see it: the room it came from and the manager to send it to. */
export interface RematchNote {
  of: string
  opponent: string | null
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
  /** Epoch ms of the last read or answer the server gave (null until the first). */
  syncedAt?: number | null
  /** Reads in a row that failed (a dropped connection): the next one waits longer (`pollDelay`). */
  failures?: number
  /** This device made the room as a rematch (kept on its seat, so a reload still says who it is for). */
  rematch?: RematchNote | null
}

/** A read or call with no answer after this long is given up (an iOS tab put away mid-request may never answer). */
export const CALL_TIMEOUT_MS = 20000
/** The longest wait between reads while the connection keeps failing. */
export const MAX_BACKOFF_MS = 30000

/**
 * How long until the next poll, or null to stop: quick while the other manager picks, slower otherwise, slow when the
 * tab is hidden, and backing off (6, 12, 24, then 30 s) while reads keep failing, so a dropped connection is retried
 * without hammering the server.
 */
export function pollDelay(view: RoomView | null, seat: 0 | 1 | null, visible: boolean, failures = 0): number | null {
  if (view && roomEnded(view.status)) return null
  let ms = !view ? 3000 : view.status === 'waiting' ? 3000 : view.turn === seat ? 6000 : 2000
  if (failures > 0) ms = Math.min(MAX_BACKOFF_MS, Math.max(ms, 3000 * 2 ** Math.min(failures, 4)))
  if (!visible) ms = Math.max(ms, 15000)
  return ms
}

/** What the server sent beside a refusal's code (the room's engine or status), for the words. */
export interface RefusalExtra {
  roomEngine?: string
  roomStatus?: string
}

/**
 * The player's words for a refusal or a failed call: what happened, then what to do next. The server's own reason is
 * used only where it names something the player typed (a name, a club), since only it knows which.
 */
export function roomMessage(code: string, reason: string | undefined, extra: RefusalExtra = {}, engine?: string): string {
  switch (code) {
    case 'network':
      return 'The connection dropped: this device keeps trying, or tap Try again once you are back online.'
    case 'timeout':
      return 'The server took too long to answer: the room reloads to show where it is. If your pick is not in, make it again.'
    case 'rate_limited':
      return 'Too many tries from this connection: wait a few minutes, then try again.'
    case 'rooms_busy':
      return 'Too many rooms are open just now: wait a few minutes, then make the room again.'
    case 'engine_mismatch':
      if (extra.roomEngine && engine && olderEngine(extra.roomEngine, engine)) return 'This room started on an earlier version of the game and cannot be played on this one: make a new room.'
      return 'This room plays on a newer version of the game: reload the page, then open the room again.'
    case 'data_mismatch':
      return 'This room plays on another version of the player data: reload the page, or make a new room if that does not help.'
    case 'no_room':
      return 'No room has that code: check the code, or ask the other manager for a new link.'
    case 'room_full':
      return 'Two managers are already in this room: you can watch the draft here, or make a room of your own.'
    case 'room_closed':
      return extra.roomStatus === 'finished' ? 'This room has finished: its result is below.' : 'This room has closed: make a new room to play again.'
    case 'stale':
      return 'The room moved on while you chose: it has reloaded with the latest picks, so check your pick and make it again.'
    case 'not_your_turn':
      return 'It is the other manager\'s pick: yours opens as soon as they have picked.'
    case 'not_seated':
      return 'This device does not hold a seat in this room: sign in on the account that made it to take the seat back, or make a new room.'
    case 'invalid_pick':
      return reason ? `${reason.replace(/[.\s]+$/, '')}: pick another player or slot.` : 'That pick is not allowed: pick another player or slot.'
    case 'invalid_manager':
    case 'invalid_room':
    case 'bad_request':
      return reason ? `${reason.replace(/[.\s]+$/, '')}: change it and try again.` : 'The room did not accept that: change it and try again.'
    default:
      return 'The server could not do that just now: wait a moment and try again.'
  }
}

/** Where a draft's clock stands: how long the manager to pick has been on it, and how long until the room times out. */
export interface TurnClock {
  /** Milliseconds since the last move (the turn began). */
  elapsed: number
  /** Milliseconds until the room times out with no move (0 once past). */
  left: number
  /** Long enough with no pick that the other manager may have gone (a third of the idle limit). */
  quiet: boolean
}

/** The turn's clock from the room's own deadline (`idleAt` is the last move plus the idle limit). Null when not drafting. */
export function turnClock(view: Pick<RoomView, 'status' | 'idleAt'>, now: number): TurnClock | null {
  if (view.status !== 'drafting' || !view.idleAt) return null
  const end = Date.parse(view.idleAt)
  if (!Number.isFinite(end)) return null
  const limit = ROOM_IDLE_MINUTES * 60000
  const elapsed = Math.min(limit, Math.max(0, now - (end - limit)))
  return { elapsed, left: Math.max(0, end - now), quiet: elapsed >= limit / 3 }
}

/** How long a waiting room has waited, and how long it has left (`expiresAt` is its creation plus the wait limit). */
export function waitClock(view: Pick<RoomView, 'status' | 'expiresAt'>, now: number): { elapsed: number; left: number } | null {
  if (view.status !== 'waiting') return null
  const end = Date.parse(view.expiresAt)
  if (!Number.isFinite(end)) return null
  const limit = ROOM_WAIT_MINUTES * 60000
  return { elapsed: Math.min(limit, Math.max(0, now - (end - limit))), left: Math.max(0, end - now) }
}

/** A clock's figure as the screens print it: "0:42", "12:05". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The words a share sheet or a copied message carries beside the link: who invites and the room's code (a rematch says so). */
export function roomInviteText(hostName: string | null, code: string, rematch?: RematchNote | null): string {
  const pretty = `${code.slice(0, 4)}-${code.slice(4)}`
  if (rematch) return `${rematch.opponent ? `${rematch.opponent}, rematch? ` : 'Rematch? '}${hostName ? `${hostName} has` : 'I have'} a new TouchLine head-to-head room, same settings: ${pretty}, no account needed.`
  return `${hostName ? `${hostName} invites you to` : 'Join me for'} a TouchLine head-to-head. Room ${pretty}, no account needed.`
}

/** The manager this seat's rematch keeps (name, shape, club) and the other one's name, from the room it follows. */
export function rematchOf(view: Pick<RoomView, 'code' | 'managers'>, seat: 0 | 1): { manager: RoomManagerInput; note: RematchNote } | null {
  const me = view.managers[seat]
  if (!me) return null
  const other = view.managers[seat === 0 ? 1 : 0]
  return { manager: { name: me.name, formationId: me.formationId, hostClubId: me.hostClubId }, note: { of: view.code, opponent: other?.name ?? null } }
}

/** The text with a URL-encoded link's marks read back ("%23h%3D" is "#h="). */
function decoded(text: string): string {
  if (!/%[0-9A-F]{2}/i.test(text)) return text
  try {
    return decodeURIComponent(text)
  } catch {
    // A stray "%" or an escape cut short at the end of a paste: every whole run of escapes still reads, so "%20K7Q2-MX9A"
    // is " K7Q2-MX9A" and the printed code is found (QA r13, R13-3)
    return text.replace(/(?:%[0-9A-F]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run)
      } catch {
        return run.replace(/%23/gi, '#').replace(/%3D/gi, '=').replace(/%2D/gi, '-').replace(/%20/gi, ' ')
      }
    })
  }
}

/** The room code box's length: a whole invite pasted URL-encoded (a rematch's, with two 24-letter names, is about 240) fits. */
export const ROOM_CODE_INPUT_MAX = 600

/**
 * A room's code from whatever the player put in the box: a typed code ("k7q2 mx9a", "K7Q2-MX9A"), or the whole invite
 * link pasted in (`https://touchline.quest/#h=K7Q2MX9A`, with or without the address, even inside the invite's text).
 */
export function roomCodeFrom(raw: string): string | null {
  // Full-width letters, digits and marks typed on a Japanese keyboard fold to plain ones (NFKC), and a link or invite
  // pasted URL-encoded ("%23h%3D", "%20") reads as it was written (QA r11, R11-O2)
  // A dash a text editor or keyboard swapped in (en dash, minus, the katakana long mark) reads as the invite's hyphen (QA r13, R13-2)
  const input = decoded(raw.normalize('NFKC')).replace(/[\u2010-\u2015\u2212\u30FC]/g, '-')
  const link = /#h=([A-Za-z0-9]{4}-?[A-Za-z0-9]{4})(?![A-Za-z0-9])/i.exec(input)
  if (link) return normaliseCode(link[1])
  const whole = normaliseCode(input.trim())
  if (whole) return whole
  // The invite's words without its link (a share sheet or a messaging app that passes the text alone): its code as it
  // prints it, in capitals, "Room K7Q2-MX9A" or "same settings: K7Q2-MX9A" (a hyphenated word is not one; QA r11)
  const printed = /(?<![A-Za-z0-9])([A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9])/.exec(input)
  return printed ? normaliseCode(printed[1]) : null
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
  /** This build's engine, for the words of an `engine_mismatch` refusal. */
  engine?: string
  /** Settle `p` or reject after `ms` (the browser's timers by default; the tests hand in their own). */
  withTimeout?: <T>(p: Promise<T>, ms: number) => Promise<T>
}

/** The answer did not come in time (`withTimeout`). */
export class CallTimeout extends Error {}

function browserTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new CallTimeout('timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

type Answer = { ok: true; body: Record<string, unknown> } | { ok: false; code: string; message: string; room: RoomView | null }

const noteOf = (rec: SeatRecord | null | undefined): RematchNote | null => (rec?.rematchOf ? { of: rec.rematchOf, opponent: rec.opponent ?? null } : null)

export class RoomSession {
  private ui: RoomUi | null = null
  private timer: unknown = null
  /** When the read in flight started (null when none): a read older than CALL_TIMEOUT_MS no longer blocks the next. */
  private pollingSince: number | null = null

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

  private timed<T>(p: Promise<T>): Promise<T> {
    return (this.d.withTimeout ?? browserTimeout)(p, CALL_TIMEOUT_MS)
  }

  private async call(body: Record<string, unknown>): Promise<Answer> {
    let reply: FunctionReply
    try {
      reply = await this.timed(this.d.transport.invoke(body, { guest: true }))
    } catch (e) {
      const code = e instanceof CallTimeout ? 'timeout' : 'network'
      return { ok: false, code, message: roomMessage(code, undefined), room: null }
    }
    if (reply.status === 200 && reply.body.status === 'ok') return { ok: true, body: reply.body }
    const code = typeof reply.body.code === 'string' ? reply.body.code : String(reply.status)
    const reason = typeof reply.body.reason === 'string' ? reply.body.reason : undefined
    const extra: RefusalExtra = {
      roomEngine: typeof reply.body.roomEngine === 'string' ? reply.body.roomEngine : undefined,
      roomStatus: typeof reply.body.roomStatus === 'string' ? reply.body.roomStatus : undefined,
    }
    return { ok: false, code, message: roomMessage(code, reason, extra, this.d.engine), room: null }
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
    const ms = pollDelay(this.ui.view, this.ui.seat, this.d.visible(), this.ui.failures ?? 0)
    if (ms === null) return
    this.timer = this.d.setTimer(() => {
      this.timer = null
      void this.poll()
    }, ms)
  }

  /** Read the room now (the public reader). A read still in flight blocks another unless it has hung (CALL_TIMEOUT_MS). */
  async poll(): Promise<void> {
    const ui = this.ui
    const now = this.d.now()
    if (!ui || (this.pollingSince !== null && now - this.pollingSince < CALL_TIMEOUT_MS)) return
    this.pollingSince = now
    try {
      const got = await this.timed(this.d.transport.rpc<Record<string, unknown> | null>('h2h_peek', { p_code: ui.code, p_since: ui.view?.version ?? null }))
      if (this.ui?.code !== ui.code) return
      const fine = this.ui.errorCode === 'network' || this.ui.errorCode === 'timeout' ? { error: null, errorCode: null } : {}
      if (!got) {
        this.set({ ...fine, missing: true, view: null, failures: 0, syncedAt: this.d.now() })
        return
      }
      this.set({ ...fine, failures: 0, syncedAt: this.d.now() })
      if (got.unchanged === true) {
        this.schedule()
        return
      }
      this.accept(got as unknown as RoomView)
    } catch {
      if (this.ui?.code === ui.code) {
        this.set({ error: roomMessage('network', undefined), errorCode: 'network', failures: (this.ui.failures ?? 0) + 1 })
        this.schedule()
      }
    } finally {
      if (this.pollingSince === now) this.pollingSince = null
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
    this.ui = { code, view: null, seat: rec?.seat ?? null, error: null, errorCode: null, busy: false, missing: false, syncedAt: null, failures: 0, rematch: noteOf(rec) }
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
      // The room moved on or ended under us, or the answer never came (the pick may have gone in): read it again so the screen shows where it is
      if (['stale', 'not_your_turn', 'room_closed', 'room_full', 'timeout', 'engine_mismatch'].includes(a.code)) void this.poll()
      else if (a.code === 'network') this.schedule()
      if (a.code === 'no_room') this.set({ missing: true })
      return false
    }
    after?.(a.body)
    this.set({ syncedAt: this.d.now(), failures: 0 })
    const view = a.body.room as RoomView | undefined
    if (view) this.accept(view)
    return true
  }

  /** Make a room: this device takes seat 0 (a rematch notes the room it follows). Resolves to the room's code, or the refusal's words. */
  async create(settings: RoomSettings, manager: RoomManagerInput, engine: string, data: string, rematch?: RematchNote): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
    const a = await this.call({ op: 'room.create', settings, manager, engine, data })
    if (!a.ok) return { ok: false, message: a.message }
    const view = a.body.room as RoomView
    const rec: SeatRecord = { seat: 0, token: String(a.body.token), at: this.d.now(), ...(rematch ? { rematchOf: rematch.of, opponent: rematch.opponent } : {}) }
    this.keepSeat(view.code, rec)
    this.close()
    this.ui = { code: view.code, view: null, seat: 0, error: null, errorCode: null, busy: false, missing: false, syncedAt: this.d.now(), failures: 0, rematch: noteOf(rec) }
    this.accept(view)
    return { ok: true, code: view.code }
  }

  /** The rematch this device already made of a room, newest first, if its seat is still kept. */
  rematchMade(code: string): string | null {
    const all = Object.entries(liveSeats(this.d.seats.get(), this.d.now())).filter(([, r]) => r.rematchOf === code && r.seat === 0)
    all.sort((a, b) => b[1].at - a[1].at)
    return all[0]?.[0] ?? null
  }

  /**
   * A rematch of a finished or ended room through the ordinary `room.create`: the same settings, this seat's name,
   * shape and club. A second press opens the rematch already made while it still waits or drafts, so two presses never
   * leave two rooms for one friend; one that has closed is replaced by a new room.
   */
  async rematch(view: RoomView, seat: 0 | 1, engine: string, data: string): Promise<{ ok: true; code: string; reused: boolean } | { ok: false; message: string }> {
    const from = rematchOf(view, seat)
    if (!from) return { ok: false, message: roomMessage('invalid_room', undefined) }
    const prior = this.rematchMade(view.code)
    if (prior) {
      await this.open(prior)
      const status = this.ui?.code === prior ? this.ui.view?.status : undefined
      if (status === 'waiting' || status === 'drafting') return { ok: true, code: prior, reused: true }
    }
    const made = await this.create(view.settings, from.manager, engine, data, from.note)
    if (!made.ok && prior && this.ui?.code === prior) await this.open(view.code)
    return made.ok ? { ...made, reused: false } : made
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
    // Newest first: the room just made or joined heads the list
    return Object.entries(liveSeats(this.d.seats.get(), this.d.now()))
      .sort((a, b) => b[1].at - a[1].at)
      .map(([code]) => code)
  }

  /** The page became visible or hidden (or came back from the back-forward cache): read now, or plan a slower read. */
  visibilityChanged(): void {
    if (this.d.visible()) void this.poll()
    else this.schedule()
  }

  /** The browser says the connection is back or gone: read at once, or say so and wait for it. */
  connectionChanged(online: boolean): void {
    if (!this.ui) return
    if (online) {
      this.set({ failures: 0 })
      void this.poll()
    } else if (!this.ui.view || !roomEnded(this.ui.view.status)) this.set({ error: roomMessage('network', undefined), errorCode: 'network' })
  }
}
