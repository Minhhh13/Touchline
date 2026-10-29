import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'
import { createGame, dailyGameSettings } from '@game/logic/setup'
import { runQuickSeason } from '@game/logic/quick'
import type { Game } from '@game/types'
import { ENGINE_VERSION } from '@engine/version'

/**
 * The online layer's dynamic entry (r11): `boot.ts` runs as it is imported (main.tsx imports it only in a configured
 * build), so each case stubs the page, then imports a fresh copy. The runtime, the error reporter and the API's flush
 * are spies: what boot decides is whether the Supabase runtime starts at once, what it mirrors into the online state,
 * and that a finished ranked Daily is filed in the outbox whether or not anyone is signed in.
 */

const h = vi.hoisted(() => ({ started: [] as unknown[], installed: 0, flushed: 0 }))
vi.mock('../runtime', () => ({ startRuntime: (redirect: unknown) => void h.started.push(redirect) }))
vi.mock('../errors', () => ({ installErrorReporting: () => void h.installed++ }))
vi.mock('../api', () => ({ flushOutboxSoon: async () => void h.flushed++ }))

const u = loadTestUniverse()

function memoryStorage(init: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(init))
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)), removeItem: (k: string) => void map.delete(k) }
}

/** Import a fresh boot (and with it a fresh game store and online state) on this page. */
async function boot(href = 'https://touchline.quest/', storage = memoryStorage()) {
  vi.stubGlobal('location', { href, origin: 'https://touchline.quest', pathname: '/' })
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()
  await import('../boot')
  const { useStore } = await import('@game/store')
  const { onlineStore } = await import('../state')
  const local = await import('../localState')
  // The runtime and the API's flush come in through dynamic imports
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
  return { useStore, onlineStore, local, storage }
}

beforeEach(() => {
  h.started = []
  h.installed = 0
  h.flushed = 0
})

afterEach(() => vi.unstubAllGlobals())

describe('the online layer boot', () => {
  it('with no session and no sign-in link: the error reporter only, the runtime waits for an online surface', async () => {
    const { onlineStore } = await boot()
    expect(h.installed).toBe(1)
    expect(h.started).toEqual([])
    expect(onlineStore.getState()).toMatchObject({ configured: true, started: false, syncStatus: 'idle', outboxCount: 0, posts: {} })
  })

  it('starts the runtime at once for a stored session, and mirrors the device\'s posts', async () => {
    const local = await import('../localState')
    const rec = { ...local.freshRecord('device-1'), posts: { 'daily:2026-10-28': { state: 'closed' as const } } }
    const { onlineStore } = await boot('https://touchline.quest/', memoryStorage({ [local.AUTH_KEY]: '{"access_token":"x"}', [local.ONLINE_KEY]: JSON.stringify(rec) }))
    expect(h.started).toEqual([null])
    expect(onlineStore.getState().posts).toEqual({ 'daily:2026-10-28': { state: 'closed' } })
  })

  it('starts the runtime with the sign-in link the page was opened with', async () => {
    await boot('https://touchline.quest/?token_hash=pkce_abc&type=email#c=XYZ')
    expect(h.started).toEqual([{ kind: 'token_hash', tokenHash: 'pkce_abc', type: 'email' }])
  })

  it('files a finished ranked Daily signed out, once, and asks for a flush', async () => {
    const { useStore, onlineStore, local } = await boot()
    const g: Game = createGame(dailyGameSettings(u, 'daily-2026-10-29'))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    runQuickSeason(g, u)
    useStore.setState({ universe: u, game: { ...g, phase: 'kickoff' } })
    useStore.setState({ game: { ...g, phase: 'summary' } })
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
    const rec = local.loadRecord()
    expect(rec.outbox).toHaveLength(1)
    expect(rec.outbox[0]).toMatchObject({ kind: 'daily', key: '2026-10-29', owner: null, engine: ENGINE_VERSION })
    expect(rec.posts['daily:2026-10-29']).toMatchObject({ state: 'waiting', reason: 'sign_in' })
    expect(onlineStore.getState().outboxCount).toBe(1)
    expect(h.flushed).toBe(1)
    // The same game seen finishing again (a reload into the summary, "Play it again"): nothing more is filed
    useStore.setState({ game: { ...g, phase: 'kickoff' } })
    useStore.setState({ game: { ...g, phase: 'summary' } })
    expect(local.loadRecord().outbox).toHaveLength(1)
  })

  it('files nothing for a Quick Draft or a finished game arriving from the cloud', async () => {
    const { useStore, local } = await boot()
    const g: Game = createGame({ ...dailyGameSettings(u, 'daily-2026-10-29'), mode: 'quick', seed: 'BOOT-QUICK' })
    useStore.setState({ universe: u, game: { ...g, phase: 'kickoff' } })
    useStore.setState({ game: { ...g, phase: 'summary' } })
    const d: Game = createGame(dailyGameSettings(u, 'daily-2026-10-29'))
    useStore.setState({ game: null })
    useStore.setState({ game: { ...d, phase: 'summary' } })
    expect(local.loadRecord().outbox).toEqual([])
    expect(h.flushed).toBe(0)
  })
})
