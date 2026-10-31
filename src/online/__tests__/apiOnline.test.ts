import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import { challengeFromGame } from '@game/logic/challenge'
import { useStore } from '@game/store'
import { initialOnlineState, onlineStore } from '../state'
import { OnlineError } from '../transport'
import type { SessionLike } from '../auth'
import { FakeBackend, FakeTransport } from './fakeTransport'
import { ENGINE_VERSION } from '@engine/version'

/**
 * `api.ts`'s online half (r11): a build with both variables, the runtime replaced by a stand-in over `FakeTransport`
 * and a fake auth, the board readers by spies. What each call asks of the runtime, what it gives a screen when the
 * runtime is signed out or could not load, and how it words a refusal. No network.
 */

const h = vi.hoisted(() => ({ runtime: null as unknown, fail: false, starts: 0, boards: [] as string[], cleared: 0 }))
vi.mock('../runtime', () => ({
  startRuntime: () => {
    h.starts++
    if (h.fail) throw new TypeError('Failed to fetch dynamically imported module')
    return h.runtime
  },
}))
vi.mock('../boards', () => {
  const reader = (name: string, out: unknown) => async (t: unknown, ...args: unknown[]) => {
    h.boards.push(`${name}:${t instanceof Object ? 'transport' : 'none'}:${JSON.stringify(args)}`)
    return out
  }
  return {
    fetchBoard: reader('board', [{ name: 'Row' }]),
    fetchSummary: reader('summary', { total: 3 }),
    rankOf: reader('rank', { position: 2 }),
    fetchAlltime: reader('alltime', [{ name: 'A' }]),
    fetchAlltimeMine: reader('alltimeMine', { position: 9 }),
    myEntries: reader('mine', [{ key: '2026-10-29' }]),
    fetchChaseBoard: reader('chaseBoard', [{ name: 'C' }]),
    fetchChaseSummary: reader('chaseSummary', { total: 1 }),
    fetchChaseStatus: reader('chaseStatus', { left: 2 }),
    fetchCasualBoard: reader('casualBoard', [{ name: 'K' }]),
    fetchCasualSummary: reader('casualSummary', { total: 4 }),
    myCasualEntries: reader('casualMine', [{ board: 'arena' }]),
  }
})
vi.mock('../errors', () => ({ clearErrorReports: () => void h.cleared++ }))

const api = await import('../api')

const u = loadTestUniverse()
const URL_ = 'https://yvqpmyqomkwtudxmkeou.supabase.co'
const KEY = ['sb', 'publishable', 'test-key-0000'].join('_')
const USER = '2b8f2c0e-5d7a-4c61-9a3e-0f1e2d3c4b5a'

let backend: FakeBackend
let transport: FakeTransport
let calls: string[]
let session: SessionLike | null

function fakeRuntime() {
  const rec = (name: string) => (...args: unknown[]) => {
    calls.push(`${name}${args.length ? ':' + JSON.stringify(args) : ''}`)
  }
  const auth = {
    signInWithOtp: async (a: unknown) => (calls.push(`otp:${JSON.stringify(a)}`), { error: null }),
    verifyOtp: async (a: { token?: string }) => (calls.push(`verify:${a.token}`), a.token === '000000' ? { error: { message: 'Token has expired or is invalid', status: 403 } } : { error: null }),
    signInWithOAuth: async (a: unknown) => (calls.push(`oauth:${JSON.stringify(a)}`), { error: null }),
    signOut: async () => ({ error: null }),
    getSession: async () => ({ data: { session } }),
  }
  const rooms = {
    open: async (code: string) => rec('rooms.open')(code),
    close: () => rec('rooms.close')(),
    create: async () => ({ ok: true, code: 'ROOM1234' }),
    rematch: async () => ({ ok: true, code: 'ROOM5678', reused: false }),
    join: async () => true,
    pick: async (id: string, slot: string) => (rec('rooms.pick')(id, slot), true),
    leave: async () => true,
    resume: async () => false,
    poll: async () => rec('rooms.poll')(),
    openSeats: () => ['ROOM1234'],
  }
  return {
    ready: Promise.resolve(),
    transport,
    auth,
    rooms,
    get signedIn() {
      return !!session
    },
    get userId() {
      return session?.user.id ?? null
    },
    signOut: async () => rec('signOut')(),
    syncNow: async (o: unknown) => rec('syncNow')(o),
    chooseAccount: async (c: string) => rec('chooseAccount')(c),
    cloudHistory: async () => [{ slot: 'quick' }],
    restorePrevious: async () => true,
    deleteCloudData: async () => 3,
    deleteAccount: async () => ({ ok: true, message: 'Deleted.' }),
    flushOutbox: async () => rec('flushOutbox')(),
    refreshPins: async () => rec('refreshPins')(),
    loadAccount: async () => rec('loadAccount')(),
  }
}

const signIn = () => {
  session = { user: { id: USER, email: 'minh@example.com' } }
  transport.userId = USER
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', URL_)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', KEY)
  vi.stubGlobal('location', { origin: 'https://touchline.quest', pathname: '/', href: 'https://touchline.quest/' })
  vi.stubGlobal('navigator', { onLine: true })
  backend = new FakeBackend()
  transport = new FakeTransport(backend, null)
  calls = []
  session = null
  h.runtime = fakeRuntime()
  h.fail = false
  h.boards = []
  onlineStore.setState({ ...initialOnlineState, configured: true }, true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the online API with a runtime', () => {
  it('is on, and starts the runtime for an online surface', async () => {
    expect(api.onlineAvailable()).toBe(true)
    expect(await api.startOnline()).toBe(true)
  })

  it('a runtime chunk that does not load is "could not reach", not "not in this build", and every reader falls back', async () => {
    h.fail = true
    expect(await api.startOnline()).toBe(false)
    expect(await api.emailCode('minh@example.com')).toEqual({ ok: false, message: 'Could not reach the online service: check your connection, then try again.' })
    expect(await api.board('daily', '2026-10-29', null)).toEqual([])
    expect(await api.cloudHistory()).toEqual([])
    expect(await api.deleteCloudData()).toBe(0)
    expect(await api.restorePrevious({} as never)).toBe(false)
    expect(await api.deleteAccount()).toMatchObject({ ok: false })
    expect(await api.createRoom({} as never, {} as never, '7', 'x')).toEqual({ ok: false, message: 'Online rooms are not available in this build.' })
    expect(await api.joinRoom({} as never, '7', 'x')).toBe(false)
    expect(await api.roomSeats()).toEqual([])
    expect(await api.openRoom('ROOM1234')).toBe(false)
    expect(await api.casualMine()).toEqual([])
    expect(await api.chaseStatus()).toBeNull()
    expect(await api.startChaseRun('england', '4-3-3', { ratings: 'season', benchPicks: 0 }, 'Minh FC')).toEqual({ ok: false, message: 'Online features are not available in this build.' })
    const link = await api.shareLink({} as never).catch(() => null)
    expect(link === null || link.fallback === 'not_configured').toBe(true)
    // The chunk loads on the next try: the auth calls work again
    h.fail = false
    expect(await api.emailCode('minh@example.com')).toEqual({ ok: true })
  })

  it('signs in by email code and Google through the runtime\'s auth, back to this page', async () => {
    expect(await api.emailCode('minh@example.com')).toEqual({ ok: true })
    expect(calls[0]).toContain('"email":"minh@example.com"')
    expect(calls[0]).toContain('https://touchline.quest/')
    expect(await api.emailVerify('minh@example.com', '123456')).toEqual({ ok: true })
    expect((await api.emailVerify('minh@example.com', '000000')).ok).toBe(false)
    expect(await api.googleSignIn()).toEqual({ ok: true })
    expect(calls.some((c) => c.startsWith('oauth:') && c.includes('google'))).toBe(true)
    await api.signOutOnline()
    expect(calls).toContain('signOut')
  })

  it('checks a name locally first, then on the server when signed in, and keeps the local verdict when that fails', async () => {
    expect((await api.checkName('')).state).toBe('invalid')
    expect(await api.checkName('Minh')).toEqual({ state: 'unknown', name: 'Minh' })
    expect(backend.calls).toEqual([])
    signIn()
    transport.rpc = (async (fn: string) => (calls.push(`rpc:${fn}`), { name: 'Minh', available: false, reason: 'taken' })) as typeof transport.rpc
    expect((await api.checkName('Minh')).state).toBe('taken')
    expect(calls).toContain('rpc:display_name_check')
    transport.rpc = (async () => ({ name: 'Minh', available: true })) as typeof transport.rpc
    expect((await api.checkName('Minh')).state).toBe('free')
    transport.rpc = (async () => {
      throw new OnlineError('network', 'Failed to fetch')
    }) as typeof transport.rpc
    expect((await api.checkName('Minh')).state).toBe('unknown')
  })

  it('saves the account name and flag, and words each refusal', async () => {
    expect(await api.saveAccount('Minh', 'VN')).toEqual({ ok: false, message: 'Sign in first.' })
    signIn()
    expect((await api.saveAccount('', 'VN')).ok).toBe(false)
    expect(await api.saveAccount('Minh', 'vn')).toEqual({ ok: true })
    expect(backend.accounts.get(USER)).toEqual({ displayName: 'Minh', country: 'VN' })
    expect(onlineStore.getState().account).toEqual({ displayName: 'Minh', country: 'VN' })
    // An update of the row this account has (the store knows the account now)
    expect(await api.saveAccount('Minh H', null)).toEqual({ ok: true })
    expect(backend.accounts.get(USER)).toEqual({ displayName: 'Minh H', country: null })
    backend.accounts.set('someone-else', { displayName: 'Taken', country: null })
    expect(await api.saveAccount('Taken', null)).toEqual({ ok: false, message: 'That name is taken: try another.' })
    backend.failNext = [new OnlineError('bad', 'violates check constraint', '23514', 400)]
    expect(await api.saveAccount('Minh', null)).toMatchObject({ ok: false, message: expect.stringMatching(/plain letters/) })
    backend.failNext = [new OnlineError('network', 'Failed to fetch')]
    expect(await api.saveAccount('Minh', null)).toMatchObject({ ok: false, message: expect.stringMatching(/No connection/) })
    backend.failNext = [new OnlineError('bad', 'something else', '42501', 403)]
    expect(await api.saveAccount('Minh', null)).toEqual({ ok: false, message: 'something else' })
  })

  it('passes the sync controls on: Sync now resumes, a resolution leaves the list at once', async () => {
    await api.syncNow()
    expect(calls).toContain('syncNow:[{"force":true,"resume":true}]')
    onlineStore.setState({ conflicts: [{ kind: 'newer', slot: 'quick', remote: null }, { kind: 'newer', slot: 'season', remote: null }], accountError: 'x' })
    await api.resolveConflict({ slot: 'quick', choice: 'cloud' } as never)
    expect(onlineStore.getState().conflicts.map((c) => c.slot)).toEqual(['season'])
    expect(calls.at(-1)).toBe('syncNow:[{"force":true,"resolve":{"slot":"quick","choice":"cloud"}}]')
    await api.chooseAccount('keep')
    expect(calls).toContain('chooseAccount:["keep"]')
    expect(await api.cloudHistory()).toEqual([{ slot: 'quick' }])
    expect(await api.restorePrevious({} as never)).toBe(true)
    expect(await api.deleteCloudData()).toBe(3)
    expect(await api.deleteAccount()).toEqual({ ok: true, message: 'Deleted.' })
    await api.reloadAccount()
    expect(onlineStore.getState().accountError).toBeNull()
    expect(calls).toContain('loadAccount')
    await api.refreshPins()
    expect(calls).toContain('refreshPins')
  })

  it('flushes the outbox and closes a room only once the runtime has started', async () => {
    await api.flushOutboxSoon()
    api.closeRoom()
    await new Promise<void>((r) => setImmediate(r))
    expect(calls).toEqual([])
    onlineStore.setState({ started: true })
    await api.flushOutboxSoon()
    api.closeRoom()
    await new Promise<void>((r) => setImmediate(r))
    expect(calls).toEqual(['flushOutbox', 'rooms.close'])
  })

  it('reads the boards through the runtime\'s transport; the caller\'s own rows only signed in', async () => {
    expect(await api.board('daily', '2026-10-29', 'VN', 50)).toEqual([{ name: 'Row' }])
    expect(await api.boardSummary('daily', '2026-10-29', null)).toEqual({ total: 3 })
    expect(await api.boardRank('weekly', '2026-W44', { points: 71, lost: 1, goalDiff: 40, goalsFor: 80 }, null)).toEqual({ position: 2 })
    expect(await api.alltime('points', null)).toEqual([{ name: 'A' }])
    expect(await api.chaseBoard('week', '2026-W44', null)).toEqual([{ name: 'C' }])
    expect(await api.chaseSummary('alltime', null, null)).toEqual({ total: 1 })
    expect(await api.casualBoard('arena', '2026-10-29', null)).toEqual([{ name: 'K' }])
    expect(await api.casualSummary('runin', '2026-W44', null)).toEqual({ total: 4 })
    expect(h.boards[0]).toBe('board:transport:["daily","2026-10-29","VN",50]')
    // Signed out: nothing of one's own is asked for
    const asked = h.boards.length
    expect(await api.alltimeMine('points', null)).toBeNull()
    expect(await api.mine('daily')).toEqual([])
    expect(await api.chaseStatus()).toBeNull()
    expect(await api.casualMine('arena')).toEqual([])
    expect(await api.myChallenges()).toEqual([])
    expect(h.boards.length).toBe(asked)
    signIn()
    expect(await api.alltimeMine('points', null)).toEqual({ position: 9 })
    expect(await api.mine('daily')).toEqual([{ key: '2026-10-29' }])
    expect(await api.chaseStatus()).toEqual({ left: 2 })
    expect(await api.casualMine()).toEqual([{ board: 'arena' }])
    expect(h.boards.at(-1)).toBe('casualMine:transport:[null]')
  })

  it('makes a short link signed in, the long one signed out or offline, and opens a code', async () => {
    const g = createGame({ ...dailyGameSettings(u, 'daily-2026-10-25'), mode: 'quick', seed: 'API-ONLINE' })
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    const payload = challengeFromGame(g, u, 'Minh')!
    expect(await api.shareLink(payload)).toMatchObject({ code: null, fallback: 'signed_out' })
    signIn()
    const short = await api.shareLink(payload)
    expect(short.code).toMatch(/^K7Q2-MX/)
    expect(short.url).toMatch(/^https:\/\/touchline\.quest\/#s=/)
    expect(await api.resolveShort(short.code!)).toMatchObject({ ok: true })
    expect((await api.myChallenges()).map((c) => c.code)).toHaveLength(1)
    await api.deleteChallenge(short.code!.replace('-', ''))
    expect(await api.myChallenges()).toEqual([])
    vi.stubGlobal('navigator', { onLine: false })
    expect(await api.shareLink(payload)).toMatchObject({ code: null, fallback: 'offline' })
  })

  it('passes the room calls to the runtime\'s room session', async () => {
    expect(await api.openRoom('ROOM1234')).toBe(true)
    expect(calls).toContain('rooms.open:["ROOM1234"]')
    expect(await api.createRoom({} as never, {} as never, '7', 'd')).toEqual({ ok: true, code: 'ROOM1234' })
    expect(await api.rematchRoom({} as never, 0, '7', 'd')).toEqual({ ok: true, code: 'ROOM5678', reused: false })
    expect(await api.joinRoom({} as never, '7', 'd')).toBe(true)
    expect(await api.pickInRoom('p@2020@c', 'GK')).toBe(true)
    expect(await api.leaveRoom()).toBe(true)
    expect(await api.resumeRoom()).toBe(false)
    await api.refreshRoom()
    expect(calls).toContain('rooms.poll')
    expect(await api.roomSeats()).toEqual(['ROOM1234'])
  })

  it('the Profile\'s Error reports switched off empties the queue; on does nothing', async () => {
    const before = h.cleared
    await api.errorReportsChanged(true)
    expect(h.cleared).toBe(before)
    await api.errorReportsChanged(false)
    expect(h.cleared).toBe(before + 1)
  })

  it('offers Google when forced, or when the project says it is on; unreadable is no button', async () => {
    vi.stubEnv('VITE_GOOGLE_AUTH', '1')
    expect(await api.googleSignInAvailable()).toBe(true)
    vi.stubEnv('VITE_GOOGLE_AUTH', '')
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      asked.push(`${url}|${init.headers.apikey}`)
      return { ok: true, json: async () => ({ external: { google: true } }) }
    })
    expect(await api.googleSignInAvailable()).toBe(true)
    // Read once a page
    expect(await api.googleSignInAvailable()).toBe(true)
    expect(asked).toEqual([`${URL_}/auth/v1/settings|${KEY}`])
  })
})

describe('the 38-0 chase through the API', () => {
  const options = { ratings: 'season' as const, benchPicks: 0 }

  beforeEach(() => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], classicLoaded: false, game: null })
  })

  it('asks a signed-out player to sign in before spending anything', async () => {
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toEqual({ ok: false, message: 'Sign in to play the 38-0 chase.', signIn: true })
    expect(backend.calls).toEqual([])
  })

  it('words a dropped connection, an expired session, a refusal and a wheel this build cannot play', async () => {
    signIn()
    backend.failNext = [new OnlineError('network', 'Failed to fetch')]
    expect((await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).ok).toBe(false)
    backend.fn = () => ({ status: 401, body: {} })
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toMatchObject({ ok: false, signIn: true })
    backend.fn = () => ({ status: 429, body: { reason: 'Three attempts a day.' } })
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toEqual({ ok: false, message: 'Three attempts a day.' })
    backend.fn = () => ({ status: 503, body: {} })
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toEqual({ ok: false, message: 'The server answered 503' })
    backend.fn = () => ({ status: 200, body: { attempt: { code: 'not-a-code' }, left: 2 } })
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toMatchObject({ ok: false, message: expect.stringMatching(/reload the page/) })
    expect(useStore.getState().game).toBeNull()
    expect(await api.startChaseRun('nowhere', '4-3-3', options, 'Minh FC')).toMatchObject({ ok: false })
  })

  it('starts the Quick Draft on the attempt the server issued', async () => {
    signIn()
    const asked: Array<Record<string, unknown>> = []
    backend.fn = (body) => (asked.push(body), { status: 200, body: { attempt: { code: 'K7Q2MX9A3B' }, left: 2 } })
    expect(await api.startChaseRun('england', '4-3-3', options, 'Minh FC')).toEqual({ ok: true, left: 2 })
    expect(asked[0]).toMatchObject({ op: 'chase.start', leagueId: 'england', formationId: '4-3-3', engine: ENGINE_VERSION, data: u.generatedAt })
    expect(useStore.getState().game?.settings.seed).toBe('chase-K7Q2MX9A3B')
    useStore.setState({ game: null })
  })

  it('refuses to file a game that is not a chase run, and one before the data has loaded', async () => {
    const g = createGame({ ...dailyGameSettings(u, 'daily-2026-10-25'), mode: 'quick', seed: 'NOT-A-CHASE' })
    expect((await api.submitChase(g)).ok).toBe(false)
    useStore.setState({ universe: null })
    expect(await api.submitChase(g)).toEqual({ ok: false, message: 'The game data is still loading.' })
  })
})
