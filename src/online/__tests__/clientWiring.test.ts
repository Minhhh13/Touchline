import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlineConfigFrom } from '../config'
import { AUTH_KEY } from '../localState'
import { REQUEST_TIMEOUT_MS } from '../transport'

/**
 * The two places the online layer meets the browser's own objects (r11): the supabase-js client (`client.ts`, its
 * options and its timed `fetch`), with supabase-js's `createClient` replaced by a recorder; and the error reporter's
 * page wiring (`installErrorReporting`: the window's error events, the screen boundary's signal, the post), on a fake
 * window and a fake `fetch`. No request leaves the test.
 */

const h = vi.hoisted(() => ({ created: [] as Array<{ url: string; key: string; options: Record<string, unknown> }> }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: Record<string, unknown>) => {
    h.created.push({ url, key, options })
    return { auth: {} }
  },
}))

const URL_ = 'https://yvqpmyqomkwtudxmkeou.supabase.co'
const KEY = ['sb', 'publishable', 'test-key-0000'].join('_')
const cfg = onlineConfigFrom({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: KEY })!

function memoryStorage() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k) }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the Supabase client', () => {
  beforeEach(() => {
    h.created = []
  })

  it('holds the publishable key only, keeps the session under its own key and finishes PKCE sign-ins', async () => {
    const { createOnlineClient } = await import('../client')
    createOnlineClient(cfg)
    expect(h.created).toHaveLength(1)
    const c = h.created[0]
    expect(c.url).toBe(URL_)
    expect(c.key).toBe(KEY)
    expect(c.options.auth).toEqual({ flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY })
  })

  it('gives every request a minute, and the caller\'s own abort still works', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const seen: AbortSignal[] = []
    vi.stubGlobal('fetch', (_input: unknown, init: { signal: AbortSignal }) => {
      seen.push(init.signal)
      return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
    })
    const { createOnlineClient } = await import('../client')
    createOnlineClient(cfg)
    const timed = (h.created[0].options.global as { fetch: typeof fetch }).fetch
    // A request that never answers gives up after REQUEST_TIMEOUT_MS
    const hung = timed(`${URL_}/rest/v1/profiles`).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
    expect(seen[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(((await hung) as DOMException).name).toBe('TimeoutError')
    // The caller's own signal
    const ctl = new AbortController()
    const mine = timed(`${URL_}/rest/v1/profiles`, { signal: ctl.signal }).catch((e: unknown) => e)
    ctl.abort(new Error('left the screen'))
    expect(((await mine) as Error).message).toBe('left the screen')
  })
})

describe('the error reporter on the page', () => {
  async function install(withConfig = true) {
    vi.resetModules()
    if (withConfig) {
      vi.stubEnv('VITE_SUPABASE_URL', URL_)
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', KEY)
    } else {
      vi.stubEnv('VITE_SUPABASE_URL', '')
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    }
    const errors = await import('../errors')
    const signal = await import('../core/errorSignal')
    return { ...errors, ...signal }
  }

  const posts: Array<{ url: string; headers: Record<string, string>; body: { op: string; reports: Array<{ kind: string; message: string }> } }> = []
  let win: EventTarget & { innerWidth: number; innerHeight: number }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
    posts.length = 0
    win = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 })
    vi.stubGlobal('window', win)
    // The game store, imported fresh with the reporter, watches the page too
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    vi.stubGlobal('location', { origin: 'https://touchline.quest', pathname: '/', href: 'https://touchline.quest/' })
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1' })
    vi.stubGlobal('localStorage', memoryStorage())
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
      posts.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return { status: 200, body: null }
    })
  })

  it('does nothing in a build without the online layer', async () => {
    const { installErrorReporting } = await install(false)
    expect(installErrorReporting()).toBeNull()
  })

  it('starts once, posts a page error as a guest, and posts nothing when the setting is off', async () => {
    const { installErrorReporting } = await install()
    const rep = installErrorReporting()
    expect(rep).not.toBeNull()
    expect(installErrorReporting()).toBe(rep)
    win.dispatchEvent(Object.assign(new Event('error'), { error: new TypeError('Cannot read properties of undefined (reading "season")') }))
    await vi.advanceTimersByTimeAsync(30000)
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toBe(`${URL_}/functions/v1/touchline-e7?forceFunctionRegion=ap-southeast-2`)
    expect(posts[0].headers).toEqual({ 'content-type': 'application/json', apikey: KEY })
    expect(posts[0].body.op).toBe('errors.report')
    expect(posts[0].body.reports[0]).toMatchObject({ kind: 'error' })
    expect(posts[0].body.reports[0].message).toContain('reading "season"')
    localStorage.setItem('touchline-error-reports-v1', 'off')
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('later') }))
    await vi.advanceTimersByTimeAsync(30000)
    expect(posts).toHaveLength(1)
  })

  it('takes a rejection, a chunk that did not load and the screen boundary\'s signal, early ones included', async () => {
    const { installErrorReporting, signalError } = await install()
    // A render error before the reporter started: buffered, then taken
    signalError('boundary', new Error('Early render error'))
    installErrorReporting()
    win.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('Rejected promise') }))
    win.dispatchEvent(Object.assign(new Event('vite:preloadError'), { payload: new Error('Failed to fetch dynamically imported module') }))
    signalError('boundary', new Error('Late render error'))
    await vi.advanceTimersByTimeAsync(30000)
    const sent = posts.flatMap((p) => p.body.reports.map((r) => `${r.kind}:${r.message}`))
    expect(sent).toEqual(expect.arrayContaining(['boundary:Early render error', 'rejection:Rejected promise', 'chunk:Failed to fetch dynamically imported module', 'boundary:Late render error']))
  })

  it('keeps reports offline and sends them when the connection is back', async () => {
    const { installErrorReporting } = await install()
    installErrorReporting()
    vi.stubGlobal('navigator', { onLine: false, userAgent: 'x' })
    win.dispatchEvent(Object.assign(new Event('error'), { error: new Error('Offline error') }))
    await vi.advanceTimersByTimeAsync(30000)
    expect(posts).toEqual([])
    vi.stubGlobal('navigator', { onLine: true, userAgent: 'x' })
    win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(posts.flatMap((p) => p.body.reports.map((r) => r.message))).toContain('Offline error')
  })
})
