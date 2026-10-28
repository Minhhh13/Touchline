import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '@supabase/supabase-js/cors'
import { onlineConfigFrom } from '../config'
import { functionUrl, OnlineError, SupabaseTransport, timedFetch } from '../transport'

const cfg = onlineConfigFrom({ VITE_SUPABASE_URL: 'https://yvqpmyqomkwtudxmkeou.supabase.co', VITE_SUPABASE_ANON_KEY: ['sb', 'publishable', 'test-key-0000'].join('_') })!

describe('the browser transport to the Edge Function', () => {
  it('sends only headers the function\'s CORS preflight allows, and pins the region in the query', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-token' } } }) } } as unknown as SupabaseClient
    const t = new SupabaseTransport(sb, cfg, fakeFetch)
    const reply = await t.invoke({ op: 'status' })
    expect(reply.status).toBe(200)
    expect(seen).toHaveLength(1)
    // withSupabase answers the preflight with supabase-js's corsHeaders: a header outside it fails every browser call
    const allowed = new Set(corsHeaders['Access-Control-Allow-Headers'].split(',').map((h) => h.trim().toLowerCase()))
    const sent = Object.keys(seen[0].init.headers as Record<string, string>).map((h) => h.toLowerCase())
    for (const h of sent) expect(allowed, `header ${h}`).toContain(h)
    expect(sent).not.toContain('x-region')
    expect(seen[0].url).toBe(functionUrl(cfg))
    expect(new URL(seen[0].url).searchParams.get('forceFunctionRegion')).toBe('ap-southeast-2')
    expect(new URL(seen[0].url).pathname).toBe(`/functions/v1/${cfg.functionName}`)
  })

  it('calls the rooms as a guest with the publishable key alone, and keeps a signed-out call local otherwise', async () => {
    const seen: RequestInit[] = []
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(init ?? {})
      return new Response('{"status":"ok"}', { status: 200 })
    }) as typeof fetch
    const sb = { auth: { getSession: async () => ({ data: { session: null } }) } } as unknown as SupabaseClient
    const t = new SupabaseTransport(sb, cfg, fakeFetch)
    expect((await t.invoke({ op: 'daily.pin' })).status).toBe(401)
    expect(seen).toHaveLength(0)
    expect((await t.invoke({ op: 'room.leave' }, { guest: true })).status).toBe(200)
    const headers = seen[0].headers as Record<string, string>
    expect(headers.apikey).toBe(cfg.key)
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain('authorization')
  })

  it('calls an older engine\'s function for a run filed on that engine, and only with a digits-only stamp', async () => {
    const seen: string[] = []
    const fakeFetch = (async (url: string | URL | Request) => {
      seen.push(String(url))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-token' } } }) } } as unknown as SupabaseClient
    const t = new SupabaseTransport(sb, cfg, fakeFetch)
    await t.invoke({ op: 'daily.submit' }, { engine: '4' })
    await t.invoke({ op: 'daily.submit' }, { engine: '../x' })
    await t.invoke({ op: 'daily.submit' })
    expect(new URL(seen[0]).pathname).toBe('/functions/v1/touchline-e4')
    expect(new URL(seen[1]).pathname).toBe(`/functions/v1/${cfg.functionName}`)
    expect(new URL(seen[2]).pathname).toBe(`/functions/v1/${cfg.functionName}`)
  })
})

describe('requests that never settle (r8 audit)', () => {
  /** A fetch that answers only when aborted, as an iOS tab put away mid-request can leave one. */
  const hanging = (calls: RequestInit[]) =>
    ((_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      // As fetch does: an aborted signal rejects at once, a later abort rejects then
      return new Promise<Response>((_, reject) => (init?.signal?.aborted ? reject(init.signal.reason) : init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))))
    }) as typeof fetch

  /** Timers the test fires by hand. */
  function manualTimers() {
    const due: Array<{ fn: () => void; ms: number; live: boolean }> = []
    return {
      due,
      set: (fn: () => void, ms: number) => {
        const t = { fn, ms, live: true }
        due.push(t)
        return t
      },
      clear: (t: unknown) => void ((t as { live: boolean }).live = false),
      fire: () => due.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn())),
    }
  }

  it('gives up on a request after its timeout, as a request with no answer', async () => {
    const calls: RequestInit[] = []
    const timers = manualTimers()
    const f = timedFetch(hanging(calls), 60000, timers)
    const p = f('https://example.test/rest/v1/cloud_saves')
    expect(timers.due.map((t) => t.ms)).toEqual([60000])
    timers.fire()
    await expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(calls[0].signal?.aborted).toBe(true)
  })

  it("passes an answer through and clears its timer; the caller's own signal still aborts", async () => {
    const timers = manualTimers()
    const ok = timedFetch((async () => new Response('{}', { status: 200 })) as typeof fetch, 1000, timers)
    expect((await ok('https://example.test/a')).status).toBe(200)
    expect(timers.due.every((t) => !t.live)).toBe(true)
    const calls: RequestInit[] = []
    const f = timedFetch(hanging(calls), 1000, manualTimers())
    const own = new AbortController()
    const p = f('https://example.test/b', { signal: own.signal })
    own.abort(new Error('the caller gave up'))
    await expect(p).rejects.toThrow('the caller gave up')
    const already = new AbortController()
    already.abort(new Error('before it started'))
    await expect(f('https://example.test/c', { signal: already.signal })).rejects.toThrow('before it started')
  })

  it('turns an Edge Function call that never answers into a network error the outbox retries', async () => {
    const timers = manualTimers()
    const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-token' } } }) } } as unknown as SupabaseClient
    const t = new SupabaseTransport(sb, cfg, timedFetch(hanging([]), 90000, timers))
    const p = t.invoke({ op: 'daily.submit' })
    await Promise.resolve()
    await Promise.resolve()
    timers.fire()
    const e = await p.catch((x: unknown) => x)
    expect(e).toBeInstanceOf(OnlineError)
    expect((e as OnlineError).kind).toBe('network')
  })
})
