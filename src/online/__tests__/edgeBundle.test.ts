import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '@engine/version'
// The same builder the Vite build (dist/edge/verifier-<hash16>.js) and scripts/online/build-loader.mjs use
import { buildEdgeBundle, EDGE_GLOBAL } from '../../../scripts/online/edgeBundle.mjs'

interface Edge {
  ENGINE_VERSION: string
  EDGE_MAX_BODY: number
  createEdgeHandler(opts: { site: string }): (req: Request, ctx: unknown) => Promise<Response>
}

/** Run the bundle the way the loader's fallback does (Function), and take the handler factory off the global. */
function evaluate(code: string): Edge {
  const g = globalThis as Record<string, unknown>
  delete g[EDGE_GLOBAL]
  new Function(code)()
  const edge = g[EDGE_GLOBAL] as Edge
  delete g[EDGE_GLOBAL]
  return edge
}

describe('the hashed edge bundle the loader runs', () => {
  it('is the same bytes on every build, named by its SHA-256, with no import or export statement', async () => {
    const a = await buildEdgeBundle()
    const b = await buildEdgeBundle()
    expect(b.sha256).toBe(a.sha256)
    expect(a.sha256).toBe(createHash('sha256').update(a.bytes).digest('hex'))
    expect(a.file).toBe(`edge/verifier-${a.sha256.slice(0, 16)}.js`)
    // A script as well as a module: the loader may run it through Function
    expect(/^\s*(import|export)\b/m.test(a.code)).toBe(false)
  }, 120000)

  it('defines the handler for this engine, which refuses before any database call', async () => {
    const edge = evaluate((await buildEdgeBundle()).code)
    expect(edge.ENGINE_VERSION).toBe(ENGINE_VERSION)
    const handle = edge.createEdgeHandler({ site: 'https://example.invalid/' })
    // No admin client is touched on these paths: a refusal needs nothing from Supabase
    const ctx = { userClaims: null, jwtClaims: null, supabaseAdmin: null }
    expect((await handle(new Request('https://f.invalid/', { method: 'GET' }), ctx)).status).toBe(405)
    expect((await handle(new Request('https://f.invalid/', { method: 'POST', headers: { 'content-length': String(edge.EDGE_MAX_BODY + 1) }, body: 'x' }), ctx)).status).toBe(413)
    const signedOut = await handle(new Request('https://f.invalid/', { method: 'POST', body: '{"op":"status"}' }), ctx)
    expect(signedOut.status).toBe(401)
    expect(await signedOut.json()).toMatchObject({ code: 'unauthorised' })
    // A guest (the publishable key, no JWT) reaches the server, which keeps it to the rooms before touching anything
    const guest = await handle(new Request('https://f.invalid/', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' }, body: '{"op":"daily.pin"}' }), { ...ctx, authMode: 'publishable' })
    expect(guest.status).toBe(401)
    expect(await guest.json()).toMatchObject({ code: 'unauthorised', reason: 'Sign in first' })
    // Any other credential mode without a user is refused at the door
    expect((await handle(new Request('https://f.invalid/', { method: 'POST', body: '{"op":"room.leave"}' }), { ...ctx, authMode: 'none' })).status).toBe(401)
  }, 120000)

  it('is what the loader template pins: every placeholder filled by build-loader.mjs, users and the publishable key checked by withSupabase', () => {
    const loader = readFileSync(path.resolve(__dirname, '..', '..', '..', 'supabase', 'functions', 'touchline', 'loader.ts'), 'utf8')
    for (const p of ['__ENGINE__', '__VERIFIER_SHA256__', '__SUPABASE_JS__', '__SUPABASE_SERVER__']) expect(loader).toContain(p)
    expect(loader).toContain("withSupabase({ auth: ['user', 'publishable']")
    expect(loader).toContain('if (got !== VERIFIER_SHA256)')
    expect(loader).toMatch(/\/edge\/verifier-\$\{VERIFIER_SHA256\.slice\(0, 16\)\}\.js/)
    expect(Buffer.byteLength(loader)).toBeLessThan(6 * 1024)
  })
})
