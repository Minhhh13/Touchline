import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENGINE_VERSION } from '@engine/version'
import { attemptFromJson, casualPinFromJson, createEdgeHandler, EDGE_MAX_BODY, randomToken, readBody, sha256Hex, type EdgeContext } from '../server/edge'
import { guestSubject } from '../server/service'
import { DELETE_CONFIRMATION, MAX_BODY_BYTES } from '../server/validate'
import { SLOT_IDS } from '../core/slots'
import type { ErrorReport } from '../core/errorReport'

/**
 * The Edge Function's adapter (`server/edge.ts`): the request checks before `createServer`, and the wiring of its
 * dependencies to the admin client (RPCs, Storage, Auth admin). `service.test.ts` drives the service with fakes; this
 * drives the adapter with a fake admin client, so the names and arguments of what it calls are checked as well.
 */

type Json = Record<string, unknown>
interface Call {
  kind: string
  name: string
  args?: unknown
}

/** A stand-in for the admin client: answers RPCs from `rpcs`, Storage listings from `folders`, records every call. */
function fakeAdmin(opts: { rpcs?: Record<string, (args: Json) => unknown>; folders?: Record<string, Array<{ id: string | null; name: string }>>; signOutFails?: boolean } = {}) {
  const calls: Call[] = []
  const admin = {
    rpc: async (fn: string, args: Json) => {
      calls.push({ kind: 'rpc', name: fn, args })
      const f = opts.rpcs?.[fn]
      if (!f) return { data: null, error: { code: 'P0001', message: `no ${fn}` } }
      return { data: f(args), error: null }
    },
    from: (table: string) => ({
      select: () => ({ eq: (column: string, value: string) => ({ maybeSingle: async () => (calls.push({ kind: 'select', name: table, args: { column, value } }), { data: null, error: null }) }) }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string, o: { limit: number; offset: number }) => {
          calls.push({ kind: 'list', name: `${bucket}:${folder}`, args: o })
          return { data: (opts.folders?.[folder] ?? []).slice(o.offset, o.offset + o.limit), error: null }
        },
        remove: async (paths: string[]) => (calls.push({ kind: 'remove', name: bucket, args: paths }), { data: [], error: null }),
        download: async (path: string) => (calls.push({ kind: 'download', name: `${bucket}:${path}` }), { data: null, error: { message: 'not found' } }),
        upload: async (path: string) => (calls.push({ kind: 'upload', name: `${bucket}:${path}` }), { data: null, error: null }),
      }),
    },
    auth: {
      admin: {
        signOut: async (jwt: string, scope: string) => (calls.push({ kind: 'signOut', name: scope, args: jwt }), { error: opts.signOutFails ? { message: 'gone' } : null }),
        deleteUser: async (id: string) => (calls.push({ kind: 'deleteUser', name: id }), { error: null }),
      },
    },
  }
  return { admin: admin as unknown as SupabaseClient, calls }
}

const SITE = 'https://touchline.example/'
const USER = '2b8f2c0e-5d7a-4c61-9a3e-0f1e2d3c4b5a'
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://fn.example/touchline', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const userCtx = (admin: SupabaseClient, anonymous = false): EdgeContext => ({ userClaims: { id: USER }, jwtClaims: { is_anonymous: anonymous }, authMode: 'user', supabaseAdmin: admin })
const guestCtx = (admin: SupabaseClient): EdgeContext => ({ userClaims: null, authMode: 'publishable', supabaseAdmin: admin })
const report = (): ErrorReport => ({
  kind: 'boundary', message: 'TypeError: x is undefined', stack: 'render /assets/Draft-abc.js:1:200', build: '2026-10-27T00:00:00.000Z', engine: ENGINE_VERSION,
  screen: 'game', phase: 'draft', viewport: '1280x720', ua: 'chrome/windows', device: '0f8e2d1c-3b4a-4c5d-8e6f-7a8b9c0d1e2f', count: 1, at: '2026-10-27T10:00:00.000Z',
})

const fetched: string[] = []
beforeEach(() => {
  fetched.length = 0
  // The live site: nothing served (the status op then reports no live build); every fetch is recorded
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(String(url))
    return new Response('missing', { status: 404 })
  })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Edge Function adapter: before the service', () => {
  it('takes only a POST, within the size limit, from a user or the publishable key', async () => {
    const { admin, calls } = fakeAdmin()
    const handle = createEdgeHandler({ site: SITE })
    expect((await handle(new Request('https://fn.example/touchline'), userCtx(admin))).status).toBe(405)
    // A content-length over the limit is refused unread
    expect((await handle(post('{}', { 'content-length': String(EDGE_MAX_BODY + 1) }), userCtx(admin))).status).toBe(413)
    // A body over the limit with no (or a false) content-length is refused while it streams in
    const big = await handle(post(JSON.stringify({ op: 'status', pad: 'x'.repeat(EDGE_MAX_BODY) })), userCtx(admin))
    expect(big.status).toBe(413)
    expect(await big.json()).toMatchObject({ code: 'bad_request' })
    // Neither a user nor the publishable key: refused here, before the service or the database
    const none = await handle(post({ op: 'status' }), { userClaims: null, authMode: 'anon', supabaseAdmin: admin })
    expect(none.status).toBe(401)
    expect(calls).toEqual([])
    // The adapter's limit is the service's, with room for a request's framing: never below what the service takes
    expect(EDGE_MAX_BODY).toBeGreaterThanOrEqual(MAX_BODY_BYTES)
  })

  it('reads a body in chunks and stops at the limit', async () => {
    const chunks = ['{"op":', '"status"', '}']
    const stream = () => new ReadableStream<Uint8Array>({ start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close() } })
    expect(await readBody(new Request('https://x', { method: 'POST', body: stream(), duplex: 'half' } as RequestInit), 100)).toBe('{"op":"status"}')
    expect(await readBody(new Request('https://x', { method: 'POST', body: stream(), duplex: 'half' } as RequestInit), 10)).toBeNull()
    expect(await readBody(new Request('https://x', { method: 'POST' }), 10)).toBe('')
    // A multi-byte character split across chunks is decoded whole
    const bytes = new TextEncoder().encode('"Atlético"')
    const split = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 6)); c.enqueue(bytes.slice(6)); c.close() } })
    expect(await readBody(new Request('https://x', { method: 'POST', body: split, duplex: 'half' } as RequestInit), 100)).toBe('"Atlético"')
  })
})

describe('the Edge Function adapter: through the service', () => {
  it('answers status with the engine, asking the live site (no trailing slash) for its build', async () => {
    const { admin } = fakeAdmin()
    const handle = createEdgeHandler({ site: SITE })
    const r = await handle(post({ op: 'status' }), userCtx(admin))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ status: 'ok', engine: ENGINE_VERSION, live: null })
    expect(fetched[0]).toBe('https://touchline.example/build.json')
  })

  it("meters a guest by a hash of the first forwarded address, files error reports, and refuses a guest's board op", async () => {
    const limits: Json[] = []
    const { admin, calls } = fakeAdmin({ rpcs: { svc_take_rate_limit: (a) => (limits.push(a), true), svc_error_report: (a) => (a.p_reports as unknown[]).length } })
    const handle = createEdgeHandler({ site: SITE })
    const r = await handle(post({ op: 'errors.report', reports: [report(), report()] }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), guestCtx(admin))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'ok', taken: 2 })
    expect(limits[0]).toEqual({ p_bucket: 'errors.report', p_subject: await guestSubject('203.0.113.9', sha256Hex), p_limit: 20, p_window_seconds: 3600 })
    // The address itself goes nowhere: only its hash
    expect(JSON.stringify(calls)).not.toContain('203.0.113.9')
    // A guest may not pin or post
    const pin = await handle(post({ op: 'daily.pin' }), guestCtx(admin))
    expect(pin.status).toBe(401)
    // An anonymous session's JWT may not post to the boards either
    expect((await handle(post({ op: 'daily.pin' }), userCtx(admin, true))).status).toBe(403)
  })

  it('a rate limit spent is a 429; a database error is a 503 that is safe to retry', async () => {
    const handle = createEdgeHandler({ site: SITE })
    const spent = fakeAdmin({ rpcs: { svc_take_rate_limit: () => false } })
    expect((await handle(post({ op: 'daily.pin', date: '2026-10-29' }), userCtx(spent.admin))).status).toBe(429)
    const broken = fakeAdmin()
    const r = await createEdgeHandler({ site: SITE })(post({ op: 'daily.pin', date: '2026-10-29' }), userCtx(broken.admin))
    expect(r.status).toBe(503)
    expect(await r.json()).toMatchObject({ code: 'unavailable' })
  })

  it('deletes an account: every save in every slot folder (paged by 1000, removed by 100), then signs out and deletes the user', async () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ id: `id-${i}`, name: `save-${i}.json.gz` }))
    const folders: Record<string, Array<{ id: string | null; name: string }>> = {
      [USER]: [{ id: null, name: 'quick' }, { id: 'old', name: 'legacy.json.gz' }],
      [`${USER}/quick`]: many,
      [`${USER}/runin`]: [{ id: 'r1', name: 'a.json.gz' }],
      [`${USER}/arena`]: [{ id: 'a1', name: 'b.json.gz' }],
    }
    const { admin, calls } = fakeAdmin({ rpcs: { svc_take_rate_limit: () => true }, folders, signOutFails: true })
    const r = await createEdgeHandler({ site: SITE })(post({ op: 'account.delete', confirm: DELETE_CONFIRMATION }, { authorization: 'Bearer jwt.token.here' }), userCtx(admin))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'deleted', objects: 1 + 1234 + 2 })
    // Every slot folder is listed: the adapter's folder list is the cloud slots' list (invariant 18)
    const listed = [...new Set(calls.filter((c) => c.kind === 'list').map((c) => c.name.replace('saves:', '')))]
    expect(listed).toEqual([USER, ...SLOT_IDS.map((s) => `${USER}/${s}`)])
    expect(calls.filter((c) => c.kind === 'list' && c.name === `saves:${USER}/quick`).map((c) => (c.args as { offset: number }).offset)).toEqual([0, 1000])
    const removed = calls.filter((c) => c.kind === 'remove').map((c) => c.args as string[])
    expect(removed.map((p) => p.length)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 37])
    expect(removed.flat()).toContain(`${USER}/legacy.json.gz`)
    expect(removed.flat()).not.toContain(`${USER}/quick`)
    expect(removed.flat().every((p) => p.startsWith(`${USER}/`))).toBe(true)
    // A failed sign-out is logged, never a reason to keep the account
    const order = calls.filter((c) => c.kind === 'signOut' || c.kind === 'deleteUser')
    expect(order).toEqual([{ kind: 'signOut', name: 'global', args: 'jwt.token.here' }, { kind: 'deleteUser', name: USER }])
  })

  it('a guest leaving a room: an unknown answer from the room writer reads as unavailable, a known one as itself', async () => {
    const token = randomToken()
    const answers: Json[] = [{ status: 'surprise' }, { status: 'not_seated' }]
    const { admin } = fakeAdmin({ rpcs: { svc_take_rate_limit: () => true, svc_h2h_room_leave: () => answers.shift() } })
    const handle = createEdgeHandler({ site: SITE })
    const body = { op: 'room.leave', code: 'ABCD2345', token }
    expect((await handle(post(body), guestCtx(admin))).status).toBe(503)
    expect((await handle(post(body), guestCtx(admin))).status).toBe(403)
  })
})

describe('the Edge Function adapter: its own helpers', () => {
  it('seat tokens are 32 random bytes in base64url, never twice the same', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const t = randomToken()
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
      seen.add(t)
    }
    expect(seen.size).toBe(500)
  })

  it('hashes with SHA-256 in lower-case hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('reads a casual pin and a chase attempt from their JSON, and refuses anything else', () => {
    const pin = { board: 'runin', key: '2026-W44', seed: 'runin-2026-W44', settings: { formationId: '4-3-3' }, settingsHash: 'h', engineVersion: ENGINE_VERSION, dataVersion: 'd', createdAt: 'c' }
    expect(casualPinFromJson(pin)).toEqual(pin)
    for (const bad of [null, 'x', { ...pin, board: 'daily' }, { ...pin, key: 4 }, { ...pin, settings: null }]) expect(casualPinFromJson(bad)).toBeNull()
    const attempt = { code: 'AB12CD34', seed: 7, leagueId: 'england', formationId: '4-4-2', ratings: 'odd', engineVersion: 7, dataVersion: 'd', createdAt: 'c', expiresAt: 'e' }
    expect(attemptFromJson(attempt)).toEqual({ code: 'AB12CD34', seed: '7', leagueId: 'england', formationId: '4-4-2', ratings: 'season', benchPicks: 0, engineVersion: '7', dataVersion: 'd', createdAt: 'c', expiresAt: 'e', submittedAt: null })
    expect(attemptFromJson({ ...attempt, ratings: 'prime', benchPicks: 2, submittedAt: 's' })).toMatchObject({ ratings: 'prime', benchPicks: 2, submittedAt: 's' })
    for (const bad of [null, 3, { ...attempt, code: 1 }, { ...attempt, leagueId: undefined }]) expect(attemptFromJson(bad)).toBeNull()
  })
})
