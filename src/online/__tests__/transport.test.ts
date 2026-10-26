import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { corsHeaders } from '@supabase/supabase-js/cors'
import { onlineConfigFrom } from '../config'
import { functionUrl, SupabaseTransport } from '../transport'

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
})
