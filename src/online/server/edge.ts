/**
 * The Edge Function's request handling, moved out of `supabase/functions/touchline/index.ts` so it ships inside the
 * hashed verifier bundle the site publishes (`dist/edge/verifier-<hash>.js`, `scripts/online/edgeBundle.mjs`): the
 * function itself is a small loader that checks the bundle's SHA-256 against a pinned constant and runs it. This file
 * wires `createServer` (service.ts) to the Supabase admin client, Storage, Auth admin and the live site. It imports no
 * Supabase code at run time: the loader passes the client in (`ctx.supabaseAdmin`, from `withSupabase`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION } from '@engine/version'
import { createServer, type DataPackRow, type ServerDeps, type StoredPin } from './service'
import type { ChaseAttempt } from './chaseVerify'

const SLOTS = ['quick', 'season', 'dynasty', 'h2h']
/** The most a request body may hold before it is refused (413). */
export const EDGE_MAX_BODY = 32768

type Json = Record<string, unknown>

/** What `withSupabase({ auth: 'user' })` hands the handler: the verified claims and the admin client. */
export interface EdgeContext {
  userClaims?: { id?: string } | null
  jwtClaims?: { is_anonymous?: boolean } | null
  supabaseAdmin: SupabaseClient
}

class DbError extends Error {}

async function rpc(admin: SupabaseClient, fn: string, args: Json): Promise<unknown> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new DbError(`${fn}: ${error.code ?? ''} ${error.message}`)
  return data
}

// Rows come from our own SQL (public.*_puzzles, svc_* results): mapped by name, the shapes the migrations define
function pinFromRow(kind: 'daily' | 'weekly', row: Json | null): StoredPin | null {
  if (!row || !row.seed) return null
  return {
    kind,
    key: kind === 'daily' ? row.puzzle_date : row.week_key,
    seed: row.seed,
    settings: row.settings,
    settingsHash: row.settings_hash,
    engineVersion: row.engine_version,
    dataVersion: row.data_version,
    createdAt: row.created_at,
  } as StoredPin
}

function packFromJson(j: unknown): DataPackRow | null {
  if (!j || typeof j !== 'object') return null
  const r = j as Json
  return { version: r.version, leagues: r.leagues, files: r.files, firstSeenAt: r.firstSeenAt } as DataPackRow
}

/** An attempt as `private.chase_attempt_json` writes it (our own SQL), or null. */
export function attemptFromJson(j: unknown): ChaseAttempt | null {
  if (!j || typeof j !== 'object') return null
  const r = j as Json
  if (typeof r.code !== 'string' || typeof r.leagueId !== 'string' || typeof r.formationId !== 'string') return null
  return {
    code: r.code,
    seed: String(r.seed),
    leagueId: r.leagueId,
    formationId: r.formationId,
    engineVersion: String(r.engineVersion),
    dataVersion: String(r.dataVersion),
    createdAt: String(r.createdAt),
    expiresAt: String(r.expiresAt),
    submittedAt: typeof r.submittedAt === 'string' ? r.submittedAt : null,
  }
}

/** Lower-case hex SHA-256 of some bytes (Web Crypto, as in Deno). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

function makeDeps(admin: SupabaseClient, site: string): ServerDeps {
  return {
    now: () => new Date(),
    log: (line: Json) => console.log(JSON.stringify({ fn: `touchline-e${ENGINE_VERSION}`, ...line })),
    sha256Hex,
    fetchSite: async (path: string): Promise<Uint8Array | null> => {
      const r = await fetch(`${site}/${path}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000) })
      if (!r.ok) {
        await r.body?.cancel()
        return null
      }
      return new Uint8Array(await r.arrayBuffer())
    },
    storage: {
      getPack: async (path: string): Promise<Uint8Array | null> => {
        const { data, error } = await admin.storage.from('packs').download(path)
        if (error || !data) return null
        return new Uint8Array(await data.arrayBuffer())
      },
      putPack: async (path: string, bytes: Uint8Array): Promise<void> => {
        const { error } = await admin.storage.from('packs').upload(path, bytes, { upsert: false, contentType: 'application/json' })
        // An object already there keeps its bytes: the registry's hashes decide which bytes are the archive
        if (error && !/exists|duplicate/i.test(error.message)) throw new DbError(`packs upload ${path}: ${error.message}`)
      },
      listSaves: async (userId: string): Promise<string[]> => {
        const out: string[] = []
        for (const folder of [userId, ...SLOTS.map((s) => `${userId}/${s}`)]) {
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await admin.storage.from('saves').list(folder, { limit: 1000, offset })
            if (error) throw new DbError(`saves list: ${error.message}`)
            // Folders come back without an id; only objects are removed
            for (const o of data ?? []) if (o.id) out.push(`${folder}/${o.name}`)
            if (!data || data.length < 1000) break
          }
        }
        return out
      },
      removeSaves: async (paths: string[]): Promise<void> => {
        for (let i = 0; i < paths.length; i += 100) {
          const { error } = await admin.storage.from('saves').remove(paths.slice(i, i + 100))
          if (error) throw new DbError(`saves remove: ${error.message}`)
        }
      },
    },
    auth: {
      signOutEverywhere: async (jwt: string) => {
        const { error } = await admin.auth.admin.signOut(jwt, 'global')
        if (error) throw new DbError(`sign out: ${error.message}`)
      },
      deleteUser: async (userId: string) => {
        const { error } = await admin.auth.admin.deleteUser(userId)
        if (error) throw new DbError(`delete user: ${error.message}`)
      },
    },
    db: {
      rateLimit: async (bucket: string, userId: string, limit: number, windowSeconds: number) =>
        (await rpc(admin, 'svc_take_rate_limit', { p_bucket: bucket, p_subject: userId, p_limit: limit, p_window_seconds: windowSeconds })) === true,
      getPin: async (kind: 'daily' | 'weekly', date: string) => {
        const table = kind === 'daily' ? 'daily_puzzles' : 'weekly_puzzles'
        const column = kind === 'daily' ? 'puzzle_date' : 'week_start'
        const { data, error } = await admin.from(table).select('*').eq(column, date).maybeSingle()
        if (error) throw new DbError(`${table}: ${error.code ?? ''} ${error.message}`)
        return pinFromRow(kind, data as Json | null)
      },
      pin: async (kind, date, settings, hash, engine, data) => {
        const row = await rpc(admin, kind === 'daily' ? 'svc_daily_pin' : 'svc_weekly_pin', { [kind === 'daily' ? 'p_date' : 'p_week']: date, p_settings: settings as unknown as Json, p_settings_hash: hash, p_engine: engine, p_data: data })
        const pin = pinFromRow(kind, row as Json)
        if (!pin) throw new DbError('the pin came back empty')
        return pin
      },
      submit: async (kind, userId, date, entry) =>
        (await rpc(admin, kind === 'daily' ? 'svc_daily_submit' : 'svc_weekly_submit', { p_user: userId, [kind === 'daily' ? 'p_date' : 'p_week']: date, p_entry: entry as unknown as Json })) as { status: string } & Json,
      chaseStart: async (userId, leagueId, formationId, engine, data) => {
        const r = ((await rpc(admin, 'svc_chase_start', { p_user: userId, p_league: leagueId, p_formation: formationId, p_engine: engine, p_data: data })) ?? {}) as Json
        const attempt = attemptFromJson(r.attempt)
        return { ...r, status: String(r.status ?? ''), ...(attempt ? { attempt } : {}) }
      },
      chaseAttempt: async (userId, code) => attemptFromJson(await rpc(admin, 'svc_chase_attempt', { p_user: userId, p_code: code })),
      chaseSubmit: async (userId, code, entry) => (await rpc(admin, 'svc_chase_submit', { p_user: userId, p_code: code, p_entry: entry as unknown as Json })) as { status: string } & Json,
      dataPack: async (version: string) => packFromJson(await rpc(admin, 'svc_data_pack', { p_version: version })),
      registerDataPack: async (version, leagues, files) => {
        const r = (await rpc(admin, 'svc_register_data_pack', { p_version: version, p_leagues: leagues, p_files: files })) as Json
        const pack = packFromJson(r)
        if (!pack) throw new DbError('the data pack registry answered nothing')
        return { status: r.status === 'ok' ? 'ok' : 'mismatch', pack }
      },
    },
  }
}

/** The body as text, or null once it passes `max` bytes: read in chunks so a body without a content-length (or with a
 * false one) is never buffered whole before the size check. */
export async function readBody(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.byteLength
  }
  return new TextDecoder().decode(all)
}

const json = (body: Json, status: number) => Response.json(body, { status })

/**
 * The function's handler for one isolate: `site` is the live site (`TOUCHLINE_SITE_URL`, no trailing slash). One server
 * per isolate keeps the live build (5 minutes), the pins and the last two universes warm.
 */
export function createEdgeHandler(opts: { site: string }): (req: Request, ctx: EdgeContext) => Promise<Response> {
  const site = opts.site.replace(/\/+$/, '')
  let server: ReturnType<typeof createServer> | null = null
  return async (req, ctx) => {
    if (req.method !== 'POST') return json({ status: 405, code: 'bad_request', reason: 'POST a JSON body' }, 405)
    const length = Number(req.headers.get('content-length') ?? '0')
    if (length > EDGE_MAX_BODY) return json({ status: 413, code: 'bad_request', reason: 'The request is too large' }, 413)
    const userId = ctx.userClaims?.id
    if (!userId) return json({ status: 401, code: 'unauthorised', reason: 'Sign in first' }, 401)
    const live = (server ??= createServer(makeDeps(ctx.supabaseAdmin, site)))
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const text = await readBody(req, EDGE_MAX_BODY)
    if (text === null) return json({ status: 413, code: 'bad_request', reason: 'The request is too large' }, 413)
    const reply = await live.handle({ userId, isAnonymous: ctx.jwtClaims?.is_anonymous === true, jwt }, text)
    if (!reply) return json({ status: 503, code: 'unavailable', reason: 'No answer' }, 503)
    return Response.json(reply.body, { status: reply.status })
  }
}
