// TouchLine's Edge Function, deployed once per engine version as `touchline-e{ENGINE_VERSION}` (see
// scripts/online/deploy-function.mjs, which stages this file beside the verifier bundle). It is a thin adapter: the
// whole request flow lives in src/online/server/service.ts (bundled into ../_shared/verifier.js with the engine and the game
// rules) and is tested there; this file only wires it to the Supabase clients, Storage, Auth admin and the live site.
//
// Every request needs a signed-in user's JWT (withSupabase auth 'user'; the platform's verify_jwt stays on). The
// user id comes only from the verified claims. The service role is the platform's own (SUPABASE_SECRET_KEYS); no key
// is in this code. Secret TOUCHLINE_SITE_URL names the live site whose build.json and packs are the truth.
import { withSupabase } from '@supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServer, ENGINE_VERSION } from '../_shared/verifier.js'

const SITE = (Deno.env.get('TOUCHLINE_SITE_URL') ?? 'https://touchline.quest').replace(/\/+$/, '')
const SLOTS = ['quick', 'season', 'dynasty', 'h2h']
const MAX_BODY = 32768

type Json = Record<string, unknown>

class DbError extends Error {}

async function rpc(admin: SupabaseClient, fn: string, args: Json): Promise<unknown> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw new DbError(`${fn}: ${error.code ?? ''} ${error.message}`)
  return data
}

function pinFromRow(kind: 'daily' | 'weekly', row: Json | null): Json | null {
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
  }
}

function packFromJson(j: unknown): Json | null {
  if (!j || typeof j !== 'object') return null
  const r = j as Json
  return { version: r.version, leagues: r.leagues, files: r.files, firstSeenAt: r.firstSeenAt }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

function makeDeps(admin: SupabaseClient) {
  return {
    now: () => new Date(),
    log: (line: Json) => console.log(JSON.stringify({ fn: `touchline-e${ENGINE_VERSION}`, ...line })),
    sha256Hex,
    fetchSite: async (path: string): Promise<Uint8Array | null> => {
      const r = await fetch(`${SITE}/${path}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000) })
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
      pin: async (kind: 'daily' | 'weekly', date: string, settings: Json, hash: string, engine: string, data: string) => {
        const row = await rpc(admin, kind === 'daily' ? 'svc_daily_pin' : 'svc_weekly_pin', { [kind === 'daily' ? 'p_date' : 'p_week']: date, p_settings: settings, p_settings_hash: hash, p_engine: engine, p_data: data })
        const pin = pinFromRow(kind, row as Json)
        if (!pin) throw new DbError('the pin came back empty')
        return pin
      },
      submit: async (kind: 'daily' | 'weekly', userId: string, date: string, entry: Json) =>
        (await rpc(admin, kind === 'daily' ? 'svc_daily_submit' : 'svc_weekly_submit', { p_user: userId, [kind === 'daily' ? 'p_date' : 'p_week']: date, p_entry: entry })) as Json,
      dataPack: async (version: string) => packFromJson(await rpc(admin, 'svc_data_pack', { p_version: version })),
      registerDataPack: async (version: string, leagues: string[], files: Json) => {
        const r = (await rpc(admin, 'svc_register_data_pack', { p_version: version, p_leagues: leagues, p_files: files })) as Json
        return { status: r.status === 'ok' ? 'ok' : 'mismatch', pack: packFromJson(r) }
      },
    },
  }
}

// One server per isolate: it keeps the live build (5 minutes), the pins and the last two universes warm
let server: ReturnType<typeof createServer> | null = null

export default {
  fetch: withSupabase({ auth: 'user', errors: { detailed: false } }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ status: 405, code: 'bad_request', reason: 'POST a JSON body' }, { status: 405 })
    const length = Number(req.headers.get('content-length') ?? '0')
    if (length > MAX_BODY) return Response.json({ status: 413, code: 'bad_request', reason: 'The request is too large' }, { status: 413 })
    const userId = ctx.userClaims?.id
    if (!userId) return Response.json({ status: 401, code: 'unauthorised', reason: 'Sign in first' }, { status: 401 })
    const live = (server ??= createServer(makeDeps(ctx.supabaseAdmin)))
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    const text = (await req.text()).slice(0, MAX_BODY)
    const reply = await live.handle({ userId, isAnonymous: ctx.jwtClaims?.is_anonymous === true, jwt }, text)
    if (!reply) return Response.json({ status: 503, code: 'unavailable', reason: 'No answer' }, { status: 503 })
    return Response.json(reply.body, { status: reply.status })
  }),
}
