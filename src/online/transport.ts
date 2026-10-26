/**
 * Every call the client makes to the backend, behind one interface: the sync engine, the outbox, the boards and
 * the short links talk to `OnlineTransport` only, so the tests drive them with `FakeTransport`
 * (`__tests__/fakeTransport.ts`, the same compare-and-set and idempotency contract as the SQL) and the browser
 * with `SupabaseTransport`. Errors come out normalised as `OnlineError` with a kind the callers branch on.
 *
 * This file imports supabase-js for its types only; the client itself is created in `client.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChallengePayload } from '@engine/challenge'
import type { OnlineConfig } from './config'
import type { SaveMeta, SlotId } from './core/slots'
import type { PuzzlePin, PuzzleSettings } from './server/dailyVerify'
import type { AccountProfile } from './state'
import { weekStartOf } from './weekly'

export type ErrorKind = 'network' | 'auth' | 'guest' | 'rate' | 'unavailable' | 'bad' | 'taken' | 'missing'

export class OnlineError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly code = '',
    readonly status = 0,
  ) {
    super(message)
    this.name = 'OnlineError'
  }
}

/** Whether a failure is worth retrying later (as opposed to a definitive answer). */
export const isTransient = (e: unknown) => !(e instanceof OnlineError) || e.kind === 'network' || e.kind === 'unavailable' || e.kind === 'rate'

/** A PostgREST or Storage error (`{ code, message }` plus the HTTP status) as an `OnlineError`. */
/** What a player reads when the backend does not have a feature yet. */
export const NOT_READY = 'This online feature is not switched on yet. Your games are safe on this device; try again later.'

export function normaliseError(error: { code?: string; message?: string; statusCode?: string | number } | null | undefined, status = 0): OnlineError {
  const code = String(error?.code ?? '')
  const message = error?.message || 'The server did not answer'
  const http = Number(error?.statusCode ?? status) || 0
  if (code === 'PT401' || code === 'PGRST301' || code === 'PGRST303' || http === 401) return new OnlineError('auth', message, code || '401', 401)
  if (code === 'PT403') return new OnlineError('guest', message, code, 403)
  if (code === 'PT429' || http === 429) return new OnlineError('rate', message, code || '429', 429)
  if (code === 'PT503' || http >= 500) return new OnlineError('unavailable', message, code || String(http), http || 503)
  if (code === '23505') return new OnlineError('taken', message, code, 409)
  // The database does not have this function or table yet (a migration not applied): the feature is not switched on,
  // which is the server's state, not the player's mistake, so it reads like an outage and is retried later
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01') return new OnlineError('unavailable', NOT_READY, code, 503)
  if (code === '22023' || code === '23514' || code === '42501' || code === 'P0001' || (http >= 400 && http < 500 && http !== 404)) return new OnlineError('bad', message, code || String(http), http || 400)
  if (http === 404) return new OnlineError('missing', message, code || '404', 404)
  // No code and no status: the request never got an answer (offline, DNS, CORS, a dropped connection)
  return new OnlineError('network', message, code, http)
}

export interface CloudRow {
  slot: SlotId
  revision: number
  gameId: string
  contentHash: string
  objectPath: string | null
  meta: Partial<SaveMeta>
  deviceId: string
  clientSavedAt: string | null
  deletedAt: string | null
  updatedAt: string
  prevGameId: string | null
  prevObjectPath: string | null
  prevMeta: Partial<SaveMeta> | null
  prevSavedAt: string | null
}

export interface ClaimArgs {
  slot: SlotId
  baseRevision: number
  gameId: string
  contentHash: string
  objectPath: string
  bytes: number
  rawBytes: number
  meta: SaveMeta
  deviceId: string
  clientSavedAt: string
  asPrevious: boolean
}

export interface ClaimResult {
  status: 'ok' | 'archived' | 'unchanged' | 'conflict'
  revision: number
  obsolete: string[]
}

export interface FunctionReply {
  status: number
  body: Record<string, unknown>
}

export interface ChallengeRow {
  code: string
  createdAt: string
  expiresAt: string
  payload: ChallengePayload
}

export interface OnlineTransport {
  // cloud saves (rows, objects and the profile document)
  listSaves(): Promise<CloudRow[]>
  upload(path: string, bytes: Uint8Array): Promise<void>
  download(path: string): Promise<Uint8Array>
  remove(paths: string[]): Promise<void>
  /** Every object name in the caller's folder. */
  listFolder(userId: string): Promise<string[]>
  claim(a: ClaimArgs): Promise<ClaimResult>
  deleteSlot(slot: SlotId, baseRevision: number, deviceId: string): Promise<ClaimResult>
  orphans(): Promise<string[]>
  /** `cloud_delete_all()`: the rows go, the object names come back for the client to remove. */
  deleteAll(): Promise<string[]>
  getProfileDoc(): Promise<{ revision: number; data: unknown } | null>
  putProfileDoc(baseRevision: number, data: unknown, deviceId: string): Promise<{ status: string; revision: number; data?: unknown }>
  // the account's own name and flag
  getAccount(userId: string): Promise<AccountProfile | null>
  saveAccount(userId: string, account: AccountProfile, exists: boolean): Promise<void>
  // boards, pins, the Edge Function
  pin(kind: 'daily' | 'weekly', key: string): Promise<PuzzlePin | null>
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>
  invoke(body: Record<string, unknown>): Promise<FunctionReply>
  // challenge short codes
  myChallenges(): Promise<ChallengeRow[]>
  deleteChallenge(code: string): Promise<void>
}

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export function cloudRowFrom(r: Row): CloudRow {
  return {
    slot: r.slot as SlotId,
    revision: Number(r.revision),
    gameId: String(r.game_id),
    contentHash: String(r.content_hash),
    objectPath: str(r.object_path),
    meta: (r.meta as Partial<SaveMeta>) ?? {},
    deviceId: String(r.device_id ?? ''),
    clientSavedAt: str(r.client_saved_at),
    deletedAt: str(r.deleted_at),
    updatedAt: String(r.updated_at ?? ''),
    prevGameId: str(r.prev_game_id),
    prevObjectPath: str(r.prev_object_path),
    prevMeta: (r.prev_meta as Partial<SaveMeta> | null) ?? null,
    prevSavedAt: str(r.prev_saved_at),
  }
}

/** A `daily_puzzles` or `weekly_puzzles` row as a pin. */
export function pinFromRow(kind: 'daily' | 'weekly', r: Row | null): PuzzlePin | null {
  if (!r || typeof r.seed !== 'string' || !r.settings) return null
  return {
    kind,
    key: String(kind === 'daily' ? r.puzzle_date : r.week_key),
    seed: r.seed,
    settings: r.settings as PuzzleSettings,
    settingsHash: String(r.settings_hash),
    engineVersion: String(r.engine_version),
    dataVersion: String(r.data_version),
  }
}

export function claimFrom(v: unknown): ClaimResult {
  const r = (v ?? {}) as Row
  const status = r.status === 'ok' || r.status === 'archived' || r.status === 'unchanged' || r.status === 'conflict' ? r.status : 'conflict'
  return { status, revision: Number(r.revision ?? 0), obsolete: Array.isArray(r.obsolete) ? r.obsolete.filter((x): x is string => typeof x === 'string') : [] }
}

/** The Edge Function's address, pinned to the project's region with `forceFunctionRegion` (the CORS-safe form). */
export function functionUrl(cfg: Pick<OnlineConfig, 'url' | 'functionName' | 'region'>): string {
  return `${cfg.url}/functions/v1/${cfg.functionName}?forceFunctionRegion=${encodeURIComponent(cfg.region)}`
}

const SAVE_COLUMNS ='slot, revision, game_id, content_hash, object_path, meta, device_id, client_saved_at, deleted_at, updated_at, prev_game_id, prev_object_path, prev_meta, prev_saved_at'
const SLOTS: SlotId[] = ['quick', 'season', 'dynasty', 'h2h']

/** The browser transport over a supabase-js client. */
export class SupabaseTransport implements OnlineTransport {
  constructor(
    private readonly sb: SupabaseClient,
    private readonly cfg: OnlineConfig,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async q<T>(p: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null; status?: number }>): Promise<T> {
    let res: { data: unknown; error: { code?: string; message?: string } | null; status?: number }
    try {
      res = await p
    } catch (e) {
      throw new OnlineError('network', e instanceof Error ? e.message : String(e))
    }
    if (res.error) throw normaliseError(res.error, res.status ?? 0)
    return res.data as T
  }

  async listSaves(): Promise<CloudRow[]> {
    const rows = await this.q<Row[]>(this.sb.from('cloud_saves').select(SAVE_COLUMNS))
    return (rows ?? []).map(cloudRowFrom)
  }

  async upload(path: string, bytes: Uint8Array): Promise<void> {
    await this.q(this.sb.storage.from('saves').upload(path, new Blob([bytes as BlobPart], { type: 'application/gzip' }), { contentType: 'application/gzip', upsert: false }))
  }

  async download(path: string): Promise<Uint8Array> {
    const blob = await this.q<Blob>(this.sb.storage.from('saves').download(path))
    return new Uint8Array(await blob.arrayBuffer())
  }

  async remove(paths: string[]): Promise<void> {
    if (!paths.length) return
    await this.q(this.sb.storage.from('saves').remove(paths))
  }

  async listFolder(userId: string): Promise<string[]> {
    const out: string[] = []
    for (const slot of SLOTS) {
      const items = await this.q<Array<{ name: string }>>(this.sb.storage.from('saves').list(`${userId}/${slot}`, { limit: 100 }))
      for (const it of items ?? []) out.push(`${userId}/${slot}/${it.name}`)
    }
    return out
  }

  async claim(a: ClaimArgs): Promise<ClaimResult> {
    return claimFrom(
      await this.q(
        this.sb.rpc('save_claim', { p_slot: a.slot, p_base_revision: a.baseRevision, p_game_id: a.gameId, p_content_hash: a.contentHash, p_object_path: a.objectPath, p_bytes: a.bytes, p_raw_bytes: a.rawBytes, p_meta: a.meta, p_device_id: a.deviceId, p_client_saved_at: a.clientSavedAt, p_as_previous: a.asPrevious }),
      ),
    )
  }

  async deleteSlot(slot: SlotId, baseRevision: number, deviceId: string): Promise<ClaimResult> {
    return claimFrom(await this.q(this.sb.rpc('save_delete', { p_slot: slot, p_base_revision: baseRevision, p_device_id: deviceId })))
  }

  async orphans(): Promise<string[]> {
    const rows = await this.q<unknown[]>(this.sb.rpc('save_orphans'))
    return (rows ?? []).map((r) => (typeof r === 'string' ? r : String((r as Row).save_orphans ?? ''))).filter(Boolean)
  }

  async deleteAll(): Promise<string[]> {
    const r = await this.q<Row>(this.sb.rpc('cloud_delete_all'))
    return Array.isArray(r?.objects) ? r.objects.filter((x): x is string => typeof x === 'string') : []
  }

  async getProfileDoc(): Promise<{ revision: number; data: unknown } | null> {
    const r = await this.q<Row | null>(this.sb.from('cloud_profile').select('revision, data').maybeSingle())
    return r ? { revision: Number(r.revision), data: r.data } : null
  }

  async putProfileDoc(baseRevision: number, data: unknown, deviceId: string): Promise<{ status: string; revision: number; data?: unknown }> {
    const r = await this.q<Row>(this.sb.rpc('profile_put', { p_base_revision: baseRevision, p_data: data, p_device_id: deviceId }))
    return { status: String(r?.status ?? 'conflict'), revision: Number(r?.revision ?? 0), data: r?.data }
  }

  async getAccount(userId: string): Promise<AccountProfile | null> {
    const r = await this.q<Row | null>(this.sb.from('profiles').select('display_name, country').eq('user_id', userId).maybeSingle())
    return r ? { displayName: String(r.display_name), country: str(r.country) } : null
  }

  async saveAccount(userId: string, account: AccountProfile, exists: boolean): Promise<void> {
    // Two calls rather than an upsert: the client may update the name and the country, never the user id
    if (exists) await this.q(this.sb.from('profiles').update({ display_name: account.displayName, country: account.country }).eq('user_id', userId))
    else await this.q(this.sb.from('profiles').insert({ user_id: userId, display_name: account.displayName, country: account.country }))
  }

  async pin(kind: 'daily' | 'weekly', key: string): Promise<PuzzlePin | null> {
    if (kind === 'daily') return pinFromRow('daily', await this.q<Row | null>(this.sb.from('daily_puzzles').select('*').eq('puzzle_date', key).maybeSingle()))
    if (!weekStartOf(key)) return null
    return pinFromRow('weekly', await this.q<Row | null>(this.sb.from('weekly_puzzles').select('*').eq('week_key', key).maybeSingle()))
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return this.q<T>(this.sb.rpc(fn, args))
  }

  async invoke(body: Record<string, unknown>): Promise<FunctionReply> {
    const { data } = await this.sb.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { status: 401, body: { code: 'signed_out', reason: 'Sign in first' } }
    let res: Response
    try {
      // The region goes in the query, never as an `x-region` header: the function's CORS allow-list (supabase-js's
      // corsHeaders, which withSupabase answers the preflight with) does not name it, so a browser would refuse the call
      res = await this.fetchImpl(functionUrl(this.cfg), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: this.cfg.key },
        body: JSON.stringify(body),
      })
    } catch (e) {
      throw new OnlineError('network', e instanceof Error ? e.message : String(e))
    }
    let parsed: Record<string, unknown> = {}
    try {
      parsed = (await res.json()) as Record<string, unknown>
    } catch {
      parsed = {}
    }
    return { status: res.status, body: parsed && typeof parsed === 'object' ? parsed : {} }
  }

  async myChallenges(): Promise<ChallengeRow[]> {
    const rows = await this.q<Row[]>(this.sb.from('challenges').select('code, created_at, expires_at, payload').order('created_at', { ascending: false }).limit(50))
    return (rows ?? []).map((r) => ({ code: String(r.code), createdAt: String(r.created_at), expiresAt: String(r.expires_at), payload: r.payload as ChallengePayload }))
  }

  async deleteChallenge(code: string): Promise<void> {
    await this.q(this.sb.from('challenges').delete().eq('code', code))
  }
}
