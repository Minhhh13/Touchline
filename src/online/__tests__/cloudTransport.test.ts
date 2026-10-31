import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { onlineConfigFrom } from '../config'
import { NOT_READY, OnlineError, SupabaseTransport, type ClaimArgs } from '../transport'
import { SLOT_IDS, type SaveMeta } from '../core/slots'

/**
 * The browser transport's cloud saves, profile and challenges (r10): what it asks supabase-js for, how it reads the
 * rows back and how a failure comes out. A stand-in client answers each table, bucket and RPC from a table of results
 * and records every call; the sync engine's own tests run against `FakeTransport` instead.
 */

const cfg = onlineConfigFrom({ VITE_SUPABASE_URL: 'https://yvqpmyqomkwtudxmkeou.supabase.co', VITE_SUPABASE_ANON_KEY: ['sb', 'publishable', 'test-key-0000'].join('_') })!
const USER = '2b8f2c0e-5d7a-4c61-9a3e-0f1e2d3c4b5a'

type Result = { data: unknown; error: { code?: string; message?: string } | null; status?: number }
const ok = (data: unknown): Result => ({ data, error: null })

function fakeClient(answers: Record<string, Result | ((args: unknown[]) => Result) | Error>) {
  const calls: string[] = []
  const answer = (key: string, args: unknown[] = []): PromiseLike<Result> => {
    const a = answers[key]
    if (a instanceof Error) return Promise.reject(a)
    return Promise.resolve(typeof a === 'function' ? a(args) : (a ?? ok(null)))
  }
  /** A PostgREST query: every step recorded, awaited as the table's answer. */
  const query = (table: string) => {
    const steps: string[] = []
    const b = {
      select: (cols: string) => (steps.push(`select(${cols})`), b),
      eq: (c: string, v: unknown) => (steps.push(`eq(${c},${String(v)})`), b),
      order: (c: string) => (steps.push(`order(${c})`), b),
      limit: (n: number) => (steps.push(`limit(${n})`), b),
      update: (v: unknown) => (steps.push(`update(${JSON.stringify(v)})`), b),
      insert: (v: unknown) => (steps.push(`insert(${JSON.stringify(v)})`), b),
      delete: () => (steps.push('delete()'), b),
      maybeSingle: () => (steps.push('maybeSingle()'), b),
      then: <T>(res: (r: Result) => T, rej?: (e: unknown) => T) => {
        calls.push(`${table}.${steps.join('.')}`)
        return answer(table).then(res, rej)
      },
    }
    return b
  }
  const sb = {
    from: query,
    rpc: (fn: string, args?: unknown) => {
      calls.push(`rpc:${fn}:${JSON.stringify(args ?? null)}`)
      return answer(`rpc:${fn}`, [args])
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: Blob, o: unknown) => (calls.push(`${bucket}.upload:${path}:${body.type}:${JSON.stringify(o)}`), answer(`${bucket}.upload`)),
        download: (path: string) => (calls.push(`${bucket}.download:${path}`), answer(`${bucket}.download`)),
        remove: (paths: string[]) => (calls.push(`${bucket}.remove:${paths.join(',')}`), answer(`${bucket}.remove`)),
        list: (folder: string, o: unknown) => (calls.push(`${bucket}.list:${folder}:${JSON.stringify(o)}`), answer(`${bucket}.list:${folder}`)),
      }),
    },
  }
  return { t: new SupabaseTransport(sb as unknown as SupabaseClient, cfg), calls }
}

const meta = { mode: 'arena', teamName: 'Minh FC', progress: [1, 3, 0, 3, 14, 0], arena: { format: 'gauntlet', step: 3, over: false } } as unknown as SaveMeta

describe('the browser transport: cloud saves', () => {
  it('reads the cloud rows, an arena slot with its previous game among them', async () => {
    const row = { slot: 'arena', revision: '4', game_id: 'g-arena', content_hash: 'h1', object_path: `${USER}/arena/a.json.gz`, meta, device_id: null, client_saved_at: '2026-10-29T10:00:00Z', deleted_at: null, updated_at: '2026-10-29T10:00:01Z', prev_game_id: 'g-old', prev_object_path: `${USER}/arena/b.json.gz`, prev_meta: { mode: 'arena' }, prev_saved_at: 7 }
    const { t, calls } = fakeClient({ cloud_saves: ok([row, { slot: 'runin', revision: 1, game_id: 'g-runin', content_hash: 'h2', meta: null }]) })
    const rows = await t.listSaves()
    expect(calls[0]).toMatch(/^cloud_saves\.select\(slot, revision, game_id.*prev_saved_at\)$/)
    expect(rows[0]).toEqual({ slot: 'arena', revision: 4, gameId: 'g-arena', contentHash: 'h1', objectPath: `${USER}/arena/a.json.gz`, meta, deviceId: '', clientSavedAt: '2026-10-29T10:00:00Z', deletedAt: null, updatedAt: '2026-10-29T10:00:01Z', prevGameId: 'g-old', prevObjectPath: `${USER}/arena/b.json.gz`, prevMeta: { mode: 'arena' }, prevSavedAt: null })
    // A row an older migration wrote, with no previous game and no summary
    expect(rows[1]).toMatchObject({ slot: 'runin', revision: 1, meta: {}, objectPath: null, prevMeta: null, updatedAt: '' })
    expect(await fakeClient({ cloud_saves: ok(null) }).t.listSaves()).toEqual([])
  })

  it("lists every slot's folder, the arena and the run-in included, and nothing outside the caller's", async () => {
    const { t, calls } = fakeClient({ [`saves.list:${USER}/quick`]: ok([{ name: 'q1.json.gz' }]), [`saves.list:${USER}/runin`]: ok([{ name: 'r1.json.gz' }, { name: 'r2.json.gz' }]) })
    const names = await t.listFolder(USER)
    expect(calls.map((c) => c.split(':')[1])).toEqual(SLOT_IDS.map((s) => `${USER}/${s}`))
    expect(names).toEqual([`${USER}/quick/q1.json.gz`, `${USER}/runin/r1.json.gz`, `${USER}/runin/r2.json.gz`])
  })

  it('uploads gzip bytes without overwriting, downloads them back, and removes nothing when given nothing', async () => {
    const bytes = new Uint8Array([31, 139, 8, 0, 1, 2, 3])
    const { t, calls } = fakeClient({ 'saves.download': ok(new Blob([bytes])) })
    await t.upload(`${USER}/season/x.json.gz`, bytes)
    expect(calls[0]).toBe(`saves.upload:${USER}/season/x.json.gz:application/gzip:{"contentType":"application/gzip","upsert":false}`)
    expect([...(await t.download(`${USER}/season/x.json.gz`))]).toEqual([...bytes])
    await t.remove([])
    expect(calls).toHaveLength(2)
    await t.remove([`${USER}/season/x.json.gz`, `${USER}/season/y.json.gz`])
    expect(calls[2]).toBe(`saves.remove:${USER}/season/x.json.gz,${USER}/season/y.json.gz`)
  })

  it('claims a slot with every argument the SQL takes, and reads any answer it does not know as a conflict', async () => {
    const args: ClaimArgs = { slot: 'runin', baseRevision: 2, gameId: 'g1', contentHash: 'h', objectPath: `${USER}/runin/g1.json.gz`, bytes: 1200, rawBytes: 9000, meta, deviceId: 'device-12345678', clientSavedAt: '2026-10-29T10:00:00Z', asPrevious: false }
    const answers = [{ status: 'ok', revision: 3, obsolete: ['old', 5, null] }, { status: 'stolen', revision: '9' }, null]
    const { t, calls } = fakeClient({ 'rpc:save_claim': () => ok(answers.shift()), 'rpc:save_delete': ok({ status: 'archived', revision: 4 }) })
    expect(await t.claim(args)).toEqual({ status: 'ok', revision: 3, obsolete: ['old'] })
    expect(JSON.parse(calls[0].replace('rpc:save_claim:', ''))).toEqual({ p_slot: 'runin', p_base_revision: 2, p_game_id: 'g1', p_content_hash: 'h', p_object_path: `${USER}/runin/g1.json.gz`, p_bytes: 1200, p_raw_bytes: 9000, p_meta: meta, p_device_id: 'device-12345678', p_client_saved_at: '2026-10-29T10:00:00Z', p_as_previous: false })
    expect(await t.claim(args)).toEqual({ status: 'conflict', revision: 9, obsolete: [] })
    expect(await t.claim(args)).toEqual({ status: 'conflict', revision: 0, obsolete: [] })
    expect(await t.deleteSlot('arena', 3, 'device-12345678')).toEqual({ status: 'archived', revision: 4, obsolete: [] })
    expect(calls.at(-1)).toBe('rpc:save_delete:{"p_slot":"arena","p_base_revision":3,"p_device_id":"device-12345678"}')
  })

  it('reads orphans and the names "Delete my cloud data" leaves to remove, whatever shape they come in', async () => {
    const { t } = fakeClient({ 'rpc:save_orphans': ok(['a', { save_orphans: 'b' }, { other: 1 }, '']), 'rpc:cloud_delete_all': ok({ objects: ['x', 2, 'y'] }) })
    expect(await t.orphans()).toEqual(['a', 'b'])
    expect(await t.deleteAll()).toEqual(['x', 'y'])
    expect(await fakeClient({ 'rpc:cloud_delete_all': ok(null) }).t.deleteAll()).toEqual([])
    expect(await fakeClient({ 'rpc:save_orphans': ok(null) }).t.orphans()).toEqual([])
  })
})

describe('the browser transport: failures', () => {
  it('normalises every failure into an OnlineError the sync engine branches on', async () => {
    const fail = async (r: Result | Error): Promise<OnlineError> => {
      try {
        await fakeClient({ cloud_saves: r }).t.listSaves()
      } catch (e) {
        return e as OnlineError
      }
      throw new Error('expected a failure')
    }
    expect(await fail(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'network', message: 'Failed to fetch' })
    expect(await fail({ data: null, error: { code: 'PGRST205', message: 'no table' }, status: 404 })).toMatchObject({ kind: 'unavailable', message: NOT_READY })
    expect(await fail({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 })).toMatchObject({ kind: 'auth', status: 401 })
    expect(await fail({ data: null, error: { message: 'slow down' }, status: 429 })).toMatchObject({ kind: 'rate' })
    expect(await fail({ data: null, error: { code: '23514', message: 'check' }, status: 400 })).toMatchObject({ kind: 'bad' })
    expect(await fail({ data: null, error: { message: 'gone' }, status: 404 })).toMatchObject({ kind: 'missing' })
    expect(await fail({ data: null, error: { message: 'boom' }, status: 502 })).toMatchObject({ kind: 'unavailable', status: 502 })
  })
})

describe('the browser transport: profile, account, pins and challenges', () => {
  it("puts and reads the profile document, and the account's name and flag", async () => {
    const { t, calls } = fakeClient({ cloud_profile: ok({ revision: '6', data: { v: 1 } }), 'rpc:profile_put': ok({ status: 'ok', revision: 7 }), profiles: ok({ display_name: 'Minh', country: 7 }) })
    expect(await t.getProfileDoc()).toEqual({ revision: 6, data: { v: 1 } })
    expect(await t.putProfileDoc(6, { v: 1 }, 'device-12345678')).toEqual({ status: 'ok', revision: 7, data: undefined })
    expect(await fakeClient({ 'rpc:profile_put': ok(null) }).t.putProfileDoc(6, {}, 'd')).toEqual({ status: 'conflict', revision: 0, data: undefined })
    expect(await fakeClient({ cloud_profile: ok(null) }).t.getProfileDoc()).toBeNull()
    expect(await t.getAccount(USER)).toEqual({ displayName: 'Minh', country: null })
    expect(calls.at(-1)).toBe(`profiles.select(display_name, country).eq(user_id,${USER}).maybeSingle()`)
    // A new account inserts its row with the user id; an existing one updates the name and flag only
    await t.saveAccount(USER, { displayName: 'Minh', country: 'VN' }, false)
    expect(calls.at(-1)).toBe(`profiles.insert({"user_id":"${USER}","display_name":"Minh","country":"VN"})`)
    await t.saveAccount(USER, { displayName: 'Minh', country: 'VN' }, true)
    expect(calls.at(-1)).toBe(`profiles.update({"display_name":"Minh","country":"VN"}).eq(user_id,${USER})`)
  })

  it('reads a Daily or weekly pin, and asks nothing for a week key that is not one', async () => {
    const pinRow = { seed: 'daily-2026-10-29', puzzle_date: '2026-10-29', settings: { formationId: '4-3-3' }, settings_hash: 'h', engine_version: 7, data_version: 'd' }
    const { t, calls } = fakeClient({ daily_puzzles: ok(pinRow), weekly_puzzles: ok({ ...pinRow, seed: 'weekly-2026-W44', week_key: '2026-W44' }) })
    expect(await t.pin('daily', '2026-10-29')).toEqual({ kind: 'daily', key: '2026-10-29', seed: 'daily-2026-10-29', settings: { formationId: '4-3-3' }, settingsHash: 'h', engineVersion: '7', dataVersion: 'd' })
    expect(await t.pin('weekly', '2026-W44')).toMatchObject({ kind: 'weekly', key: '2026-W44', seed: 'weekly-2026-W44' })
    expect(calls).toEqual(['daily_puzzles.select(*).eq(puzzle_date,2026-10-29).maybeSingle()', 'weekly_puzzles.select(*).eq(week_key,2026-W44).maybeSingle()'])
    expect(await t.pin('weekly', '2026-W60')).toBeNull()
    expect(calls).toHaveLength(2)
    expect(await fakeClient({ daily_puzzles: ok({ ...pinRow, seed: null }) }).t.pin('daily', '2026-10-29')).toBeNull()
  })

  it("lists the caller's short links newest first, and deletes one by its code", async () => {
    const { t, calls } = fakeClient({ challenges: ok([{ code: 'AB12CD34', created_at: 'c', expires_at: 'e', payload: { v: 2 } }]) })
    expect(await t.myChallenges()).toEqual([{ code: 'AB12CD34', createdAt: 'c', expiresAt: 'e', payload: { v: 2 } }])
    expect(calls[0]).toBe('challenges.select(code, created_at, expires_at, payload).order(created_at).limit(50)')
    await t.deleteChallenge('AB12CD34')
    expect(calls[1]).toBe('challenges.delete().eq(code,AB12CD34)')
    expect(await fakeClient({ challenges: ok(null) }).t.myChallenges()).toEqual([])
  })
})
