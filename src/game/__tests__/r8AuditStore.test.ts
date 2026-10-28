import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { createGame, beginSeason } from '../logic/setup'
import type { Game, GameSettings } from '../types'
import { persistedState, useStore } from '../store'

const u = loadTestUniverse()
const LONG = 300_000

function settings(seed: string, mode: GameSettings['mode']): GameSettings {
  return { mode, seed, formationId: '4-3-3', teamName: 'Audit XI', shortName: 'AUD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: mode === 'dynasty', difficulty: 'calibrated' }
}

function preseason(seed: string, mode: GameSettings['mode']): Game {
  const g = createGame(settings(seed, mode))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return g
}

describe('r8 audit: the store', () => {
  it('a second Sim 5 while one is running in slices sims five weeks, not ten', async () => {
    for (const seed of ['r8-sim-twice-1', 'r8-sim-twice-2']) {
      const start = preseason(seed, 'season')
      useStore.setState({ universe: u, loadedLeagues: ['england'], game: start, screen: 'game', playingWeek: false, digest: null })
      await useStore.getState().simWeeksSoon(5, { sliceMs: 0 })
      const once = useStore.getState().game!.season!.matchweek
      useStore.setState({ game: start, digest: null })
      const a = useStore.getState().simWeeksSoon(5, { sliceMs: 0 })
      const b = useStore.getState().simWeeksSoon(5, { sliceMs: 0 })
      await Promise.all([a, b])
      expect(useStore.getState().game!.season!.matchweek, seed).toBe(once)
      // The same for Sim to the next big match
      useStore.setState({ game: start, simStop: null })
      await useStore.getState().simToNextBigMatchSoon({ sliceMs: 0 })
      const stopOnce = JSON.stringify(useStore.getState().game)
      useStore.setState({ game: start, simStop: null })
      await Promise.all([useStore.getState().simToNextBigMatchSoon({ sliceMs: 0 }), useStore.getState().simToNextBigMatchSoon({ sliceMs: 0 })])
      expect(JSON.stringify(useStore.getState().game), seed).toBe(stopOnce)
    }
  }, LONG)

  it('a game started while a parked game is resuming is kept, never dropped', async () => {
    const active = preseason('r8-resume-active', 'season')
    const parkedQuick = createGame({ ...settings('r8-resume-quick', 'quick') })
    useStore.setState({ universe: u, loadedLeagues: ['england'], classicLoaded: false, game: active, parked: { quick: parkedQuick }, screen: 'home' })
    useStore.getState().resumeGame('quick')
    // Before the resume's league check resolves, a Dynasty is started
    useStore.getState().startGame(settings('r8-resume-new', 'dynasty'))
    const started = useStore.getState().game!
    expect(started.settings.mode).toBe('dynasty')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const s = useStore.getState()
    const all = [s.game, ...Object.values(s.parked)].map((g) => g?.id)
    expect(all).toContain(started.id)
    expect(all).toContain(active.id)
    expect(all).toContain(parkedQuick.id)
  })

  it('persists a parked game compacted once, not again on every change to the active game', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: preseason('r8-parked-cache', 'season'), digest: null })
    useStore.getState().simWeeks(4)
    const parked = useStore.getState().game!
    const s0 = { game: null, parked: { season: parked }, shortlist: [], h2h: null, profile: useStore.getState().profile, screen: 'home' as const }
    const a = persistedState(s0)
    // A played season compacts to a new object; the next write (another change) reuses it
    expect(a.parked.season).not.toBe(parked)
    const b = persistedState({ ...s0, shortlist: ['x'] })
    expect(b.parked.season).toBe(a.parked.season)
  })
})
