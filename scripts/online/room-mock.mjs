#!/usr/bin/env node
// A local stand-in for the Supabase project, for Playwright runs of the online head-to-head rooms (docs/ONLINE.md,
// "Rooms in a real browser"). Never point a build at the real project for this.
//
// It runs the Edge Function's own request flow (`createServer` in src/online/server/service.ts) over the in-memory
// database of src/online/__tests__/serverHarness.ts (the svc_* contracts the SQL keeps), bundled with esbuild on
// start, and answers the public `h2h_peek` reader as the SQL does (`unchanged` when `p_since` is the room's version).
// Its clock is the real one, moved forward by POST /__mock/advance?minutes=N (deadlines: the 30-minute wait, the
// 15-minute idle limit). Everything else a signed-out page asks the project for gets an empty answer.
//
//   node scripts/online/room-mock.mjs [--port 54321]
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=sb_publishable_roommock npm run build
//   npx vite preview --port 4173 --strictPort
//
// Endpoints: POST /functions/v1/touchline-e<N> (every op; a request with only the publishable key is a guest),
// POST /rest/v1/rpc/h2h_peek, GET /__mock/rooms (the rooms as the database holds them, tokens hashed),
// POST /__mock/advance?minutes=N, POST /__mock/fail?n=N (the next N room reads and calls answer 503: a bad connection).
import { createServer as httpServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const port = Number(arg('port', process.env.ROOM_MOCK_PORT ?? '54321'))

// Bundle the harness (TypeScript, path aliases) into a temporary module and load it
const out = mkdtempSync(path.join(tmpdir(), 'room-mock-'))
const file = path.join(out, 'harness.mjs')
await build({
  stdin: {
    contents: `export { makeHarness, fakeRoomView } from './src/online/__tests__/serverHarness.ts'\nexport { buildInfoFrom } from './src/online/buildInfo.ts'\nexport { ENGINE_VERSION } from './src/engine/version.ts'`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: path.join(root, 'tsconfig.app.json'),
  // The harness finds public/data from its own folder
  define: { __dirname: JSON.stringify(path.join(root, 'src', 'online', '__tests__')) },
  outfile: file,
  logLevel: 'warning',
})
const { makeHarness, fakeRoomView, buildInfoFrom, ENGINE_VERSION } = await import(pathToFileURL(file).href)
rmSync(out, { recursive: true, force: true })

const info = buildInfoFrom(readFileSync(path.join(root, 'src/engine/version.ts'), 'utf8'), readFileSync(path.join(root, 'public/data/leagues.json'), 'utf8'), new Date().toISOString())
const h = makeHarness(new Date(), info)
// The real clock, plus whatever /__mock/advance added
let offset = 0
Object.defineProperty(h.clock, 'now', { get: () => new Date(Date.now() + offset), set: () => {} })
let failNext = 0
const FUNCTION = `/functions/v1/touchline-e${ENGINE_VERSION}`

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': '*',
}
const send = (res, status, body) => {
  res.writeHead(status, { ...cors, 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const bodyOf = (req) =>
  new Promise((resolve) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
  })
/** private.normalise_code: upper case, the separators dropped. */
const normalise = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
/** A short note per request, so a smoke's log shows what the page asked. */
const note = (line) => {
  if (!process.env.ROOM_MOCK_QUIET) console.log(`[room-mock] ${line}`)
}

const server = httpServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
  if (req.method === 'OPTIONS') return send(res, 204)
  const text = req.method === 'POST' || req.method === 'PATCH' ? await bodyOf(req) : ''
  try {
    if (url.pathname === '/__mock/rooms') {
      return send(res, 200, [...h.rooms.values()].map((r) => ({ ...fakeRoomView(r, h.clock.now.getTime()), seed: r.seed })))
    }
    if (url.pathname === '/__mock/advance') {
      offset += Number(url.searchParams.get('minutes') ?? '0') * 60000
      return send(res, 200, { now: h.clock.now.toISOString() })
    }
    if (url.pathname === '/__mock/fail') {
      failNext = Number(url.searchParams.get('n') ?? '1')
      return send(res, 200, { failNext })
    }
    if (url.pathname === FUNCTION || url.pathname.startsWith('/functions/v1/')) {
      if (url.pathname !== FUNCTION) return send(res, 404, { status: 404, code: 'not_found', reason: `No function ${url.pathname}` })
      let op = '?'
      try {
        op = String(JSON.parse(text).op)
      } catch {
        // validate.ts answers a body that is not JSON
      }
      if (failNext > 0 && op.startsWith('room.')) {
        failNext--
        note(`${op} -> 503 (failing on purpose)`)
        return send(res, 503, { status: 503, code: 'unavailable', reason: 'Failing on purpose' })
      }
      const auth = req.headers.authorization ?? ''
      // The page sends only the publishable key as a guest; a bearer JWT would be a signed-in user, which this mock has none of
      const caller = auth.startsWith('Bearer ') && auth.slice(7) !== req.headers.apikey ? { userId: '11111111-1111-4111-8111-111111111111', isAnonymous: false, jwt: auth.slice(7) } : { guest: true, subject: '55555555-5555-4555-8555-555555555555' }
      const reply = await h.server.handle(caller, text)
      note(`${op} -> ${reply.status} ${reply.body.status ?? ''}${reply.body.code ? ` ${reply.body.code}` : ''}`)
      return send(res, reply.status, reply.body)
    }
    if (url.pathname === '/rest/v1/rpc/h2h_peek') {
      if (failNext > 0) {
        failNext--
        return send(res, 503, { message: 'Failing on purpose' })
      }
      const args = text ? JSON.parse(text) : {}
      const r = h.rooms.get(normalise(args.p_code))
      if (!r) return send(res, 200, null)
      const view = fakeRoomView(r, h.clock.now.getTime())
      if (args.p_since !== null && args.p_since !== undefined && args.p_since === r.version && view.status === r.status) return send(res, 200, { unchanged: true, version: r.version, status: view.status })
      return send(res, 200, view)
    }
    // Anything else a signed-out page reads (boards, pins, auth): empty
    note(`${req.method} ${url.pathname} -> empty`)
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(res, 200, null)
    if (url.pathname.startsWith('/rest/v1/')) return send(res, 200, [])
    return send(res, 200, {})
  } catch (e) {
    console.error('[room-mock]', e)
    return send(res, 500, { status: 500, code: 'mock_error', reason: e instanceof Error ? e.message : String(e) })
  }
})
server.listen(port, '127.0.0.1', () => console.log(`[room-mock] engine ${ENGINE_VERSION}, data ${info.data}, listening on http://127.0.0.1:${port}`))
