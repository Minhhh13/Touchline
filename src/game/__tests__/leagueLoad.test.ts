/**
 * O-10 (docs/QA.md): offline, a league whose pack never loaded left Start on "Loading league data…" for good. The store
 * now remembers a failed load, the start buttons say "Not downloaded: connect to load it" and Retry loads it again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }, configurable: true })
})
vi.setConfig({ testTimeout: 60_000 })
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { LEAGUE_LOADING_LABEL, LEAGUE_MISSING_LABEL, gateLabel, leagueGate, nextFailed, nextSeasonLeagues, type LeagueLoadState } from '../logic/leagueLoad'
import { useStore } from '../store'
import { show } from '../../ui/__tests__/qaSsr'
import { Setup } from '../../ui/screens/Setup'
import { RunInSetup } from '../../ui/screens/RunInSetup'
import { H2HSetup } from '../../ui/screens/H2H'
import { ArenaSetup } from '../../ui/screens/ArenaSetup'

const base: LeagueLoadState = { loadedLeagues: ['england'], failedLeagues: [], loadingLeagues: false, classicLoaded: false, classicFailed: false }

describe('the league gate', () => {
  it('is ready with every league needed loaded, loading while a load runs or has not been asked, missing once it failed', () => {
    expect(leagueGate(['england'], base)).toBe('ready')
    expect(leagueGate(['england', 'spain'], base)).toBe('loading')
    expect(leagueGate(['england', 'spain'], { ...base, failedLeagues: ['spain'] })).toBe('missing')
    // A retry in flight reads as loading again
    expect(leagueGate(['england', 'spain'], { ...base, failedLeagues: ['spain'], loadingLeagues: true })).toBe('loading')
    // A failure of another league says nothing about this one
    expect(leagueGate(['england', 'spain'], { ...base, failedLeagues: ['italy'] })).toBe('loading')
    // The classic seasons count only when asked for
    expect(leagueGate(['england'], { ...base, classicFailed: true })).toBe('ready')
    expect(leagueGate(['england'], { ...base, classicFailed: true }, true)).toBe('missing')
    expect(leagueGate(['england'], { ...base, classicLoaded: true }, true)).toBe('ready')
  })
  it('words the button, and keeps the failed list', () => {
    expect(gateLabel('ready', 'Start Draft')).toBe('Start Draft')
    expect(gateLabel('loading', 'Start Draft')).toBe(LEAGUE_LOADING_LABEL)
    expect(gateLabel('missing', 'Start Draft')).toBe('Not downloaded: connect to load it')
    expect(nextFailed([], ['spain', 'italy'], false)).toEqual(['spain', 'italy'])
    expect(nextFailed(['spain'], ['spain'], false)).toEqual(['spain'])
    expect(nextFailed(['spain', 'italy'], ['england', 'spain'], true)).toEqual(['italy'])
  })
  it("names a Dynasty summer's leagues as the store loads them", () => {
    expect(nextSeasonLeagues(null, ['england', 'spain'])).toEqual([])
    expect(nextSeasonLeagues({ pendingMove: { leagueId: 'spain' } }, ['england', 'spain'])).toEqual(['spain'])
    expect(nextSeasonLeagues({ pendingMove: null, qualifiedContinental: true }, ['england', 'spain'])).toEqual(['england', 'spain'])
  })
})

describe('offline, then back online', () => {
  afterEach(() => vi.unstubAllGlobals())
  // The packs as a server would send them, read from public/ (the test's stand-in for the network coming back)
  const disk = (url: string | URL | Request) => {
    const path = String(url).replace(/^\//, '')
    try {
      return Promise.resolve(new Response(readFileSync(join(__dirname, '..', '..', '..', 'public', path)), { status: 200 }))
    } catch {
      return Promise.resolve(new Response('', { status: 404 }))
    }
  }

  it('remembers a failed league, says so on the start buttons, and Retry loads it', async () => {
    const u = loadTestUniverse(['england'])
    show({ universe: u, loadedLeagues: ['england'], failedLeagues: [], loadingLeagues: false, game: null, screen: 'setup', setupMode: 'runin', toast: null })
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await useStore.getState().ensureLeagues(['spain'])).toBe(false)
    const s = useStore.getState()
    expect(s.failedLeagues).toEqual(['spain'])
    expect(s.loadingLeagues).toBe(false)
    expect(s.toast).toMatch(/Could not load league data/)
    expect(leagueGate(['spain'], s)).toBe('missing')
    // The screens: a league that is here starts as before; one that never came says so, with Retry, never the endless loading line
    const html = (C: () => unknown, patch: Parameters<typeof show>[0]) => {
      show(patch)
      return renderToString(createElement(C as () => null))
    }
    for (const [C, mode] of [[Setup, 'quick'], [Setup, 'season'], [RunInSetup, 'runin'], [ArenaSetup, 'arena'], [H2HSetup, 'quick']] as const) {
      const here = html(C, { setupMode: mode, loadedLeagues: ['england'], failedLeagues: [], loadingLeagues: false })
      expect(here).not.toContain(LEAGUE_MISSING_LABEL)
      expect(here).not.toContain('data-testid="league-retry"')
      const gone = html(C, { setupMode: mode, loadedLeagues: [], failedLeagues: ['england'], loadingLeagues: false })
      expect(gone).toContain(LEAGUE_MISSING_LABEL)
      expect(gone).toContain('data-testid="league-retry-btn"')
      expect(gone).not.toContain(LEAGUE_LOADING_LABEL)
      // While the retry runs: the loading line again
      expect(html(C, { setupMode: mode, loadedLeagues: [], failedLeagues: ['england'], loadingLeagues: true })).not.toContain(LEAGUE_MISSING_LABEL)
    }
    show({ loadedLeagues: ['england'], failedLeagues: ['spain'], loadingLeagues: false })

    // Back online: the retry loads it and clears the failure
    vi.stubGlobal('fetch', disk)
    expect(await useStore.getState().ensureLeagues(['spain'])).toBe(true)
    expect(useStore.getState().failedLeagues).toEqual([])
    expect(useStore.getState().loadedLeagues).toEqual(['england', 'spain'])
    expect(leagueGate(['spain'], useStore.getState())).toBe('ready')
  })

  it('remembers failed classic seasons, and clears them once they load', async () => {
    show({ universe: loadTestUniverse(['england']), loadedLeagues: ['england'], failedLeagues: [], classicLoaded: false, classicFailed: false, loadingLeagues: false })
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await useStore.getState().ensureClassic()).toBe(false)
    expect(useStore.getState().classicFailed).toBe(true)
    expect(leagueGate(['england'], useStore.getState(), true)).toBe('missing')
    vi.stubGlobal('fetch', disk)
    expect(await useStore.getState().ensureClassic()).toBe(true)
    expect(useStore.getState().classicFailed).toBe(false)
    expect(leagueGate(['england'], useStore.getState(), true)).toBe('ready')
  })
})
