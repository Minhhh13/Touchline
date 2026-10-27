import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage: an in-memory stand-in that counts writes and can refuse them like a full storage
const disk = vi.hoisted(() => {
  const mem = new Map<string, string>()
  const state = { full: false, writes: 0, mem }
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (state.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
        state.writes++
        mem.set(k, v)
      },
      removeItem: (k: string) => void mem.delete(k),
    },
    configurable: true,
  })
  return state
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame, beginSeason } from '../logic/setup'
import { startSeasonProper } from '../logic/week'
import { normaliseGame } from '../logic/save'
import { createSaveStorage, decodeSave, encodeSave, parseSave } from '../saveStorage'
import { exportSaveJson, readSaveFile, SAVE_KEY, saveChangedElsewhere, saveStorage, useStore } from '../store'
import type { Game, GameSettings, Profile } from '../types'

const u = loadTestUniverse()

function settings(seed: string): GameSettings {
  return { mode: 'season', seed, formationId: '4-3-3', teamName: 'Robust XI', shortName: 'ROB', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2024, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

function started(seed: string): Game {
  const g = createGame(settings(seed))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

/** The persisted value of an imported file, as the next load reads it. */
const imported = (text: string) => JSON.parse(decodeSave(readSaveFile(text))!) as { state: { game: Game | null; parked: Record<string, Game>; profile: Profile }; version: number }

describe('a game the save cannot read is not a game', () => {
  it('needs an id, a phase, a mode, a seed and a generator state', () => {
    const g = started('robust-shape')
    expect(normaliseGame(JSON.parse(JSON.stringify(g)) as Game)).not.toBeNull()
    const broken: Array<Record<string, unknown>> = [
      { ...g, id: undefined },
      { ...g, phase: 'nonsense' },
      { ...g, phase: undefined },
      { ...g, rngState: undefined },
      { ...g, rngState: { a: 1, b: 2, c: 'x', d: 4 } },
      { ...g, settings: { ...g.settings, mode: undefined } },
      { ...g, settings: { ...g.settings, seed: 42 } },
    ]
    for (const b of broken) expect(normaliseGame(b as unknown as Game)).toBeNull()
  })
})

describe('importing a file', () => {
  it('refuses a damaged game, a save from another persist version and a file holding nothing, before anything is stored', () => {
    const g = started('robust-import')
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: g, parked: {} })
    const good = JSON.parse(exportSaveJson()) as { state: Record<string, unknown>; version: number }
    expect(() => readSaveFile(JSON.stringify({ ...good, version: 2 }))).toThrow('newer version')
    expect(() => readSaveFile(JSON.stringify({ ...good, version: 0 }))).toThrow('cannot read')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, game: { settings: {} } } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, game: 'a game' } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, parked: { season: { id: 'x' } } } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, parked: [1] } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, profile: 'me' } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ ...good, state: { ...good.state, h2h: { managers: [] } } }))).toThrow('damaged')
    expect(() => readSaveFile(JSON.stringify({ state: { shortlist: [] }, version: 1 }))).toThrow('not a Touchline save')
    // A file cut short says so, not the parser's message
    const text = JSON.stringify(good)
    expect(() => readSaveFile(text.slice(0, text.length >> 1))).toThrow('the file is damaged or incomplete')
    // The export itself still imports, with its game whole
    expect(imported(JSON.stringify(good)).state.game!.id).toBe(g.id)
  })

  it("keeps this browser's record when the file has a game but no record", () => {
    const g = started('robust-no-profile')
    useStore.setState({ universe: u, game: g, profile: { ...useStore.getState().profile, managerName: 'Robust Manager', gamesPlayed: 7 } })
    const out = imported(JSON.stringify({ state: { game: JSON.parse(JSON.stringify(g)) }, version: 1 }))
    expect(out.state.profile.managerName).toBe('Robust Manager')
    expect(out.state.profile.gamesPlayed).toBe(7)
    expect(out.version).toBe(1)
  })
})

describe('writes', () => {
  it('notice a save another page wrote unheard (back from the back-forward cache, a frozen tab)', () => {
    const mem = new Map<string, string>()
    const backing = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage
    const store = createSaveStorage<{ n: number }>({ storage: () => backing, delayMs: 0 })
    // Nothing stored, nothing read: nothing changed
    expect(store.changedElsewhere('k')).toBe(false)
    // What this page wrote, plain or as another build stored it, is its own
    store.setItem('k', { state: { n: 1 }, version: 1 })
    expect(store.changedElsewhere('k')).toBe(false)
    // What this page read on loading is its own too
    mem.set('k', encodeSave(JSON.stringify({ state: { n: 2 }, version: 1 })))
    const fresh = createSaveStorage<{ n: number }>({ storage: () => backing, delayMs: 0 })
    expect(fresh.changedElsewhere('k')).toBe(true)
    fresh.getItem('k')
    expect(fresh.changedElsewhere('k')).toBe(false)
    // Another page writes, or wipes
    mem.set('k', encodeSave(JSON.stringify({ state: { n: 3 }, version: 1 })))
    expect(fresh.changedElsewhere('k')).toBe(true)
    mem.delete('k')
    expect(fresh.changedElsewhere('k')).toBe(true)
  })


  it('skip a write that stores nothing new: a toast or a transient change writes nothing', () => {
    useStore.setState({ universe: u, game: started('robust-skip'), toast: null })
    saveStorage.flush()
    const writes = disk.writes
    const stored = disk.mem.get(SAVE_KEY)
    useStore.setState({ toast: 'hello' })
    saveStorage.flush()
    useStore.setState({ toast: null, digest: null, matchView: 'report' })
    saveStorage.flush()
    expect(disk.writes).toBe(writes)
    expect(disk.mem.get(SAVE_KEY)).toBe(stored)
    // A real change writes once
    useStore.getState().simWeeks(1)
    saveStorage.flush()
    expect(disk.writes).toBe(writes + 1)
  }, 60_000)

  it('a full storage raises a banner that stays while writes fail and goes with the next write that lands', () => {
    useStore.setState({ universe: u, game: started('robust-full'), toast: null, saveFailing: false })
    saveStorage.flush()
    disk.full = true
    try {
      useStore.getState().simWeeks(1)
      saveStorage.flush()
      expect(useStore.getState().saveFailing).toBe(true)
      // The toast goes after a few seconds; the banner does not
      useStore.setState({ toast: null })
      useStore.getState().simWeeks(1)
      saveStorage.flush()
      expect(useStore.getState().saveFailing).toBe(true)
    } finally {
      disk.full = false
    }
    useStore.getState().simWeeks(1)
    saveStorage.flush()
    expect(useStore.getState().saveFailing).toBe(false)
    expect(parseSave<{ game: Game }>(disk.mem.get(SAVE_KEY)!).state.game.season!.matchweek).toBe(useStore.getState().game!.season!.matchweek)
  }, 60_000)
})

// Last: a save written by another tab stops this page's writes for good
describe('two tabs', () => {
  it("another tab's save stops this page writing, so its older game never overwrites the newer one", () => {
    useStore.setState({ universe: u, game: started('robust-tabs'), saveIssue: null })
    saveStorage.flush()
    // Another key (a viewer preference) changing elsewhere is nothing to do with the save
    saveChangedElsewhere('touchline-match-speed')
    expect(useStore.getState().saveIssue).toBeNull()
    // The other tab plays on and saves
    const newer = 'the other tab\'s newer save'
    disk.mem.set(SAVE_KEY, newer)
    saveChangedElsewhere(SAVE_KEY)
    expect(useStore.getState().saveIssue).toBe('elsewhere')
    // This tab plays on in memory, and nothing it does reaches the storage, not even on hiding the page
    useStore.getState().simWeeks(2)
    saveStorage.flush()
    expect(disk.mem.get(SAVE_KEY)).toBe(newer)
    // localStorage.clear() in another tab (key null) counts too
    useStore.setState({ saveIssue: null })
    saveChangedElsewhere(null)
    expect(useStore.getState().saveIssue).toBe('elsewhere')
  }, 60_000)
})
