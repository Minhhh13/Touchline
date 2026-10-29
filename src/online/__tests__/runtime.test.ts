import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '@game/store'
import { onlineConfigFrom } from '../config'
import { freshRecord, loadRecord, saveRecord, type OutboxEntry } from '../localState'
import { initialOnlineState, onlineStore } from '../state'
import { OnlineError } from '../transport'
import type { SessionLike } from '../auth'
import type { PuzzlePin } from '../server/dailyVerify'
import { FakeBackend, FakeTransport } from './fakeTransport'
import { ENGINE_VERSION } from '@engine/version'

/**
 * The running online layer (r11): `Runtime` over a stand-in supabase-js client (only `auth`, which is all the runtime
 * reads of it) and the in-memory `FakeTransport` in place of `SupabaseTransport`. No network: the session, the sync
 * timers and the page's events, the outbox flush and the pins are driven by hand on fake timers and a fake page.
 */

const h = vi.hoisted(() => ({ sb: null as unknown, transport: null as unknown }))
vi.mock('../client', () => ({ createOnlineClient: () => h.sb }))
vi.mock('../transport', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../transport')>()
  // A constructor that hands back the test's FakeTransport (`new` returns the object a constructor returns)
  return { ...orig, SupabaseTransport: function SupabaseTransport() { return h.transport } }
})

const { Runtime, startRuntime } = await import('../runtime')

const cfg = onlineConfigFrom({ VITE_SUPABASE_URL: 'https://yvqpmyqomkwtudxmkeou.supabase.co', VITE_SUPABASE_ANON_KEY: ['sb', 'publishable', 'test-key-0000'].join('_') })!
const USER = '2b8f2c0e-5d7a-4c61-9a3e-0f1e2d3c4b5a'
const OTHER = '9a1d0c3b-2e4f-4a5b-8c7d-6e5f4a3b2c1d'
const userSession = (id = USER): SessionLike => ({ user: { id, email: 'minh@example.com', app_metadata: { provider: 'email' } } })

/** The slice of supabase-js `auth` the runtime and `auth.ts` call, with the session in hand. */
function fakeAuth(transport: FakeTransport) {
  let session: SessionLike | null = null
  let listener: ((event: string, s: SessionLike | null) => void) | null = null
  const calls: string[] = []
  const set = (s: SessionLike | null) => {
    session = s
    transport.userId = s?.user.id ?? null
  }
  const auth = {
    onAuthStateChange: (fn: (event: string, s: SessionLike | null) => void) => {
      listener = fn
      return { data: { subscription: { unsubscribe: () => undefined } } }
    },
    getSession: async () => ({ data: { session } }),
    signOut: async (a?: { scope?: string }) => {
      calls.push(`signOut:${a?.scope}`)
      set(null)
      return { error: null }
    },
    verifyOtp: async (a: { token_hash?: string }) => {
      calls.push(`verifyOtp:${a.token_hash}`)
      if (a.token_hash === 'expired') return { error: { message: 'Token has expired or is invalid', status: 403 } }
      set(userSession())
      return { error: null }
    },
    signInWithOtp: async () => ({ error: null }),
    signInWithOAuth: async () => ({ error: null }),
  }
  return {
    auth,
    calls,
    set,
    /** supabase-js telling the page the session changed (another tab signed in or out, a token refresh). */
    fire: (event: string, s: SessionLike | null) => {
      set(s)
      listener?.(event, s)
    },
  }
}

class FakePage extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible'
}

function memoryStorage() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k) }
}

let backend: FakeBackend
let transport: FakeTransport
let fake: ReturnType<typeof fakeAuth>
let win: FakePage
let doc: FakePage
let nav: { onLine: boolean; userAgent: string; locks?: unknown }
let replaced: string[]
const live: Array<InstanceType<typeof Runtime>> = []

function makeRuntime(redirect: Parameters<typeof startRuntime>[0] = null) {
  const r = new Runtime(cfg, redirect)
  live.push(r)
  return r
}

/** Let promises, zero-delay timers and the page's own macrotasks run until the runtime is quiet. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await new Promise<void>((r) => setImmediate(r))
  }
}

const pin = (kind: 'daily' | 'weekly', key: string): PuzzlePin => ({ kind, key, seed: `${kind}-${key}`, settings: {} as PuzzlePin['settings'], settingsHash: 'abc', engineVersion: ENGINE_VERSION, dataVersion: '2026-10-25' })

function entry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return { id: 'daily:2026-10-29:g1', kind: 'daily', key: '2026-10-29', encoded: 'ENC', teamName: 'Minh FC', shortName: 'MFC', points: 71, at: '2026-10-29T11:00:00.000Z', attempts: 0, nextAt: 0, owner: null, engine: ENGINE_VERSION, ...over }
}

const syncPasses = () => backend.calls.filter((c) => c === 'listSaves').length

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'))
  backend = new FakeBackend()
  transport = new FakeTransport(backend, null)
  fake = fakeAuth(transport)
  h.transport = transport
  h.sb = { auth: fake.auth }
  win = new FakePage()
  doc = new FakePage()
  nav = { onLine: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1' }
  replaced = []
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('location', { href: 'https://touchline.quest/?token_hash=abc&type=email#c=XYZ', origin: 'https://touchline.quest', pathname: '/' })
  vi.stubGlobal('history', { state: null, replaceState: (_s: unknown, _t: string, href: string) => void replaced.push(href) })
  onlineStore.setState({ ...initialOnlineState }, true)
  useStore.setState({ toast: null })
})

afterEach(() => {
  for (const r of live.splice(0)) r.dispose()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the runtime: start and session', () => {
  it('starts signed out: reports the layer up, reads both pins and never asks the function to pin', async () => {
    backend.pins = [pin('daily', '2026-10-29')]
    const r = makeRuntime()
    await r.ready
    const s = onlineStore.getState()
    expect(s).toMatchObject({ configured: true, started: true, session: null })
    expect(s.pins).toEqual({ daily: backend.pins[0], weekly: null, day: '2026-10-29', week: '2026-W44' })
    expect(backend.calls.filter((c) => c.startsWith('invoke'))).toEqual([])
    expect(r.signedIn).toBe(false)
    expect(r.userId).toBeNull()
    // Nothing to sync without an account
    await r.syncNow()
    expect(syncPasses()).toBe(0)
    expect(await r.cloudHistory()).toEqual([])
    expect(await r.deleteCloudData()).toBe(0)
    expect(await r.restorePrevious({} as never)).toBe(false)
  })

  it('picks up a stored session: account, sync, outbox and pins, and asks the function to pin a missing one', async () => {
    fake.set(userSession())
    backend.accounts.set(USER, { displayName: 'Minh', country: 'VN' })
    backend.fn = (body) => (body.op === 'daily.pin' ? { status: 200, body: { pin: { ...pin('daily', '2026-10-29'), key: '2026-10-29' } } } : { status: 503, body: {} })
    const r = makeRuntime()
    await r.ready
    await settle()
    const s = onlineStore.getState()
    expect(s.session).toEqual({ userId: USER, maskedEmail: 'm•••@example.com', provider: 'email' })
    expect(s.account).toEqual({ displayName: 'Minh', country: 'VN' })
    expect(s.accountLoaded).toBe(true)
    expect(syncPasses()).toBeGreaterThanOrEqual(1)
    expect(backend.calls).toContain('orphans')
    expect(backend.calls).toContain('invoke:daily.pin')
    expect(backend.calls).toContain('invoke:weekly.pin')
    expect(s.pins.daily?.seed).toBe('daily-2026-10-29')
    // The weekly function answered with no pin: null, never a throw
    expect(s.pins.weekly).toBeNull()
    expect(s.lastSyncAt).not.toBeNull()
    // The device record now belongs to this account
    expect(loadRecord().userId).toBe(USER)
  })

  it('finishes a token_hash sign-in link, strips it from the address and says so', async () => {
    const r = makeRuntime({ kind: 'token_hash', tokenHash: 'abc', type: 'email' })
    await r.ready
    expect(fake.calls).toContain('verifyOtp:abc')
    expect(replaced).toEqual(['https://touchline.quest/#c=XYZ'])
    expect(useStore.getState().toast).toBe('Signed in.')
    expect(r.signedIn).toBe(true)
  })

  it('reports a link that did not sign in, and stays signed out', async () => {
    const r = makeRuntime({ kind: 'token_hash', tokenHash: 'expired', type: 'email' })
    await r.ready
    expect(useStore.getState().toast).toMatch(/expired|link/i)
    expect(r.signedIn).toBe(false)
    expect(replaced).toHaveLength(1)
  })

  it('follows the auth events: a sign-in elsewhere, a token refresh for the same account, then a sign-out', async () => {
    const r = makeRuntime()
    await r.ready
    fake.fire('SIGNED_IN', userSession())
    await settle()
    expect(r.userId).toBe(USER)
    const passes = syncPasses()
    // Same account again (TOKEN_REFRESHED): the session is reported, nothing restarts
    fake.fire('TOKEN_REFRESHED', userSession())
    await settle()
    expect(syncPasses()).toBe(passes)
    fake.fire('SIGNED_OUT', null)
    await settle()
    expect(r.signedIn).toBe(false)
    expect(onlineStore.getState()).toMatchObject({ session: null, account: null, accountLoaded: false, syncStatus: 'idle', conflicts: [] })
  })

  it('a different account on the device pauses sync until the player chooses', async () => {
    saveRecord({ ...freshRecord('device-1'), userId: OTHER })
    fake.set(userSession())
    const r = makeRuntime()
    await r.ready
    await settle()
    expect(onlineStore.getState()).toMatchObject({ syncStatus: 'paused', accountSwitch: { previousUserId: OTHER } })
    expect(syncPasses()).toBe(0)
    await r.chooseAccount('upload')
    expect(loadRecord().userId).toBe(USER)
    expect(syncPasses()).toBe(1)
  })

  it('signs out on this device only and clears the account from the screens', async () => {
    fake.set(userSession())
    const r = makeRuntime()
    await r.ready
    await settle()
    await r.signOut()
    expect(fake.calls).toContain('signOut:local')
    expect(r.signedIn).toBe(false)
    expect(onlineStore.getState().session).toBeNull()
    const passes = syncPasses()
    await r.syncNow({ force: true })
    expect(syncPasses()).toBe(passes)
  })

  it('says why the account could not be read, and reads it again when the connection is back', async () => {
    fake.set(userSession())
    backend.accounts.set(USER, { displayName: 'Minh', country: null })
    const r = makeRuntime()
    await r.ready
    await settle()
    onlineStore.setState({ accountLoaded: false, account: null })
    backend.failNext = [new OnlineError('network', 'Failed to fetch')]
    await r.loadAccount()
    expect(onlineStore.getState().accountError).toMatch(/connection/i)
    expect(onlineStore.getState().accountLoaded).toBe(false)
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(onlineStore.getState()).toMatchObject({ accountLoaded: true, accountError: null, account: { displayName: 'Minh' } })
  })
})

describe('the runtime: sync timers and the page', () => {
  async function signedIn() {
    fake.set(userSession())
    const r = makeRuntime()
    await r.ready
    await settle()
    return r
  }

  it('pushes a profile change ten seconds later, and several changes in one pass', async () => {
    await signedIn()
    const passes = syncPasses()
    const p = useStore.getState().profile
    useStore.setState({ profile: { ...p, managerName: 'Minh' } })
    useStore.setState({ profile: { ...useStore.getState().profile, managerName: 'Minh H' } })
    await vi.advanceTimersByTimeAsync(9000)
    expect(syncPasses()).toBe(passes)
    await vi.advanceTimersByTimeAsync(1500)
    await settle()
    expect(syncPasses()).toBe(passes + 1)
  })

  it('backs off after a failed pass: doubling from five seconds, a quarter hour when rate-limited, never on a refusal', async () => {
    const r = await signedIn()
    const passes = syncPasses()
    backend.failNext = [new OnlineError('network', 'Failed to fetch')]
    await r.syncNow()
    // 5 s to 6.5 s with the jitter
    await vi.advanceTimersByTimeAsync(4900)
    expect(syncPasses()).toBe(passes + 1)
    await vi.advanceTimersByTimeAsync(1700)
    await settle()
    expect(syncPasses()).toBe(passes + 2)
    backend.failNext = [new OnlineError('rate', 'Too many requests', '429', 429)]
    await r.syncNow()
    const after = syncPasses()
    await vi.advanceTimersByTimeAsync(14 * 60000)
    expect(syncPasses()).toBe(after)
    await vi.advanceTimersByTimeAsync(5 * 60000)
    await settle()
    expect(syncPasses()).toBeGreaterThan(after)
    // An auth refusal is not retried on a timer
    backend.failNext = [new OnlineError('auth', 'JWT expired', 'PGRST301', 401)]
    await r.syncNow()
    const refused = syncPasses()
    // (a retry would come within 6.5 s; the periodic pass is the only one in the next minute)
    await vi.advanceTimersByTimeAsync(40000)
    expect(syncPasses()).toBe(refused)
  })

  it('offline: says so without a request, and syncs and flushes when the connection comes back', async () => {
    const r = await signedIn()
    const passes = syncPasses()
    nav.onLine = false
    win.dispatchEvent(new Event('offline'))
    expect(onlineStore.getState().syncStatus).toBe('offline')
    await r.syncNow()
    expect(syncPasses()).toBe(passes)
    expect(onlineStore.getState().syncMessage).toMatch(/Offline/)
    nav.onLine = true
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(syncPasses()).toBe(passes + 1)
  })

  it('saves when the page is put away or closed, and again on return after a minute', async () => {
    await signedIn()
    const passes = syncPasses()
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(syncPasses()).toBe(passes + 1)
    // Back within the minute: nothing
    await vi.advanceTimersByTimeAsync(30000)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(syncPasses()).toBe(passes + 1)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    await vi.advanceTimersByTimeAsync(61000)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(syncPasses()).toBe(passes + 3)
    win.dispatchEvent(new Event('pagehide'))
    await settle()
    expect(syncPasses()).toBe(passes + 4)
  })

  it('syncs every five minutes while the page is visible, never while it is hidden', async () => {
    await signedIn()
    const passes = syncPasses()
    await vi.advanceTimersByTimeAsync(5 * 60000)
    await settle()
    expect(syncPasses()).toBe(passes + 1)
    doc.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(5 * 60000)
    await settle()
    expect(syncPasses()).toBe(passes + 1)
  })

  it('syncs only in the tab holding the lock', async () => {
    const asked: string[] = []
    let held = false
    nav.locks = {
      request: async (name: string, _o: unknown, fn: (lock: object | null) => Promise<void>) => {
        asked.push(name)
        return fn(held ? null : {})
      },
    }
    const r = await signedIn()
    const passes = syncPasses()
    expect(asked).toContain('touchline-cloud-sync')
    held = true
    await r.syncNow({ force: true })
    expect(syncPasses()).toBe(passes)
  })

  it('stops every timer and listener when disposed', async () => {
    const r = await signedIn()
    r.dispose()
    const passes = syncPasses()
    useStore.setState({ profile: { ...useStore.getState().profile, managerName: 'Later' } })
    win.dispatchEvent(new Event('online'))
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    win.dispatchEvent(new Event('pagehide'))
    doc.visibilityState = 'visible'
    await vi.advanceTimersByTimeAsync(11 * 60000)
    await settle()
    expect(syncPasses()).toBe(passes)
  })
})

describe('the runtime: the outbox and the pins', () => {
  const posted = (status = 200) => ({ status, body: { status: 'ranked', position: 3, total: 40, entry: { points: 71, claimMatched: true } } })

  it('signed out, a run waits for sign-in; signed in, it posts and the pins are read again', async () => {
    saveRecord({ ...freshRecord('device-1'), outbox: [entry()] })
    const r = makeRuntime()
    await r.ready
    await r.flushOutbox()
    expect(onlineStore.getState().posts['daily:2026-10-29']).toMatchObject({ state: 'waiting', reason: 'sign_in' })
    expect(onlineStore.getState().outboxCount).toBe(1)
    backend.fn = (body) => (body.op === 'daily.submit' ? posted() : { status: 404, body: {} })
    fake.fire('SIGNED_IN', userSession())
    await settle()
    expect(backend.calls).toContain('invoke:daily.submit')
    expect(onlineStore.getState().posts['daily:2026-10-29']).toMatchObject({ state: 'posted', position: 3 })
    expect(onlineStore.getState().outboxCount).toBe(0)
    expect(loadRecord().outbox).toEqual([])
  })

  it('keeps a run filed while a flush is under way, and one flush at a time', async () => {
    fake.set(userSession())
    let release: () => void = () => undefined
    const waiting = new Promise<void>((res) => (release = res))
    backend.fn = async (body) => {
      if (body.op === 'daily.submit') await waiting
      return body.op === 'daily.submit' || body.op === 'weekly.submit' ? posted() : { status: 404, body: {} }
    }
    saveRecord({ ...freshRecord('device-1'), userId: USER, outbox: [entry()] })
    const r = makeRuntime()
    await settle()
    // The first flush is waiting on the function: file a second run, then let it answer
    const late = entry({ id: 'weekly:2026-W44:g2', kind: 'weekly', key: '2026-W44' })
    const rec = loadRecord()
    saveRecord({ ...rec, outbox: [...rec.outbox, late] })
    // A second call while one runs joins it
    const again = r.flushOutbox()
    expect(r.flushOutbox()).toBe(again)
    release()
    await again
    expect(loadRecord().outbox.map((e) => e.id)).toEqual([late.id])
    expect(onlineStore.getState()).toMatchObject({ outboxCount: 1, posts: { 'daily:2026-10-29': { state: 'posted' } } })
    await r.flushOutbox()
    expect(loadRecord().outbox).toEqual([])
    expect(backend.calls.filter((c) => c === 'invoke:daily.submit')).toHaveLength(1)
    expect(onlineStore.getState().posts['weekly:2026-W44']).toMatchObject({ state: 'posted' })
  })

  it('retries a post that failed for want of a connection, on its own timer', async () => {
    fake.set(userSession())
    let fail = true
    backend.fn = () => {
      if (fail) throw new OnlineError('network', 'Failed to fetch')
      return posted()
    }
    saveRecord({ ...freshRecord('device-1'), userId: USER, outbox: [entry()] })
    const r = makeRuntime()
    await r.ready
    await settle()
    expect(onlineStore.getState().posts['daily:2026-10-29']).toMatchObject({ state: 'waiting', reason: 'retry' })
    fail = false
    await vi.advanceTimersByTimeAsync(10 * 60000)
    await settle()
    expect(onlineStore.getState().posts['daily:2026-10-29']).toMatchObject({ state: 'posted' })
  })

  it('reads the pins again only when a post has just landed, not for every flush after', async () => {
    fake.set(userSession())
    backend.fn = (body) => (body.op === 'daily.submit' ? posted() : { status: 200, body: {} })
    saveRecord({ ...freshRecord('device-1'), userId: USER, outbox: [entry()] })
    const r = makeRuntime()
    await r.ready
    await settle()
    expect(onlineStore.getState().posts['daily:2026-10-29']).toMatchObject({ state: 'posted' })
    const reads = backend.calls.filter((c) => c === 'pin').length
    await r.flushOutbox()
    await r.flushOutbox()
    await settle()
    expect(backend.calls.filter((c) => c === 'pin').length).toBe(reads)
  })

  it('reads the pins once when asked twice at the same time, and a failed read is no pin', async () => {
    const r = makeRuntime()
    await r.ready
    const before = backend.calls.filter((c) => c === 'pin').length
    await Promise.all([r.refreshPins(), r.refreshPins()])
    expect(backend.calls.filter((c) => c === 'pin').length - before).toBe(2)
    transport.pin = async () => {
      throw new OnlineError('network', 'Failed to fetch')
    }
    await r.refreshPins()
    expect(onlineStore.getState().pins).toMatchObject({ daily: null, weekly: null, day: '2026-10-29' })
  })
})

describe('the runtime: deleting the account', () => {
  it('says what the server answered when it refuses, and keeps the session', async () => {
    fake.set(userSession())
    backend.fn = () => ({ status: 409, body: { reason: 'Type DELETE to confirm.' } })
    const r = makeRuntime()
    await r.ready
    expect(await r.deleteAccount()).toEqual({ ok: false, message: 'Type DELETE to confirm.' })
    backend.fn = () => ({ status: 500, body: {} })
    expect(await r.deleteAccount()).toEqual({ ok: false, message: 'The server answered 500' })
    expect(r.signedIn).toBe(true)
  })

  it('deletes, signs out and starts the device record afresh, keeping the device id', async () => {
    fake.set(userSession())
    backend.fn = (body) => (body.op === 'account.delete' ? { status: 200, body: { ok: true } } : { status: 404, body: {} })
    saveRecord({ ...freshRecord('device-7'), userId: USER, outbox: [entry({ owner: USER, nextAt: Date.now() + 3600000 })], posts: { 'daily:2026-10-28': { state: 'closed' } } })
    const r = makeRuntime()
    await r.ready
    await settle()
    const out = await r.deleteAccount()
    expect(out.ok).toBe(true)
    expect(backend.calls).toContain('invoke:account.delete')
    expect(fake.calls).toContain('signOut:local')
    const rec = loadRecord()
    expect(rec).toMatchObject({ deviceId: 'device-7', userId: null, outbox: [], posts: {} })
    expect(onlineStore.getState()).toMatchObject({ session: null, posts: {}, outboxCount: 0 })
  })
})

describe('startRuntime', () => {
  it('is null in a build without the variables, and starts once with them', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(startRuntime()).toBeNull()
    vi.stubEnv('VITE_SUPABASE_URL', cfg.url)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', cfg.key)
    const a = startRuntime()
    expect(a).not.toBeNull()
    expect(startRuntime()).toBe(a)
    live.push(a!)
    await a!.ready
    expect(onlineStore.getState().started).toBe(true)
  })
})
