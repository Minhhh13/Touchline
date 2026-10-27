import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import type { Game, GameSettings } from '../types'
import { createGame, dailyGameSettings } from '../logic/setup'
import { beginArena, cupGameSettings, simArenaToEnd } from '../logic/arena'
import { compactGame } from '../logic/compact'
import { Rng } from '@engine/rng'
import { autoDraft } from '@engine/draft'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()

const seasonSettings = (seed: string): GameSettings => ({ mode: 'season', seed, formationId: '4-4-2', teamName: 'Cloud Town', shortName: 'CT', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated' })

function reset(game: Game | null, parked: Record<string, Game> = {}) {
  useStore.setState({ universe: u, loadedLeagues: ['england'], game, parked, h2h: null, screen: 'home', toast: null })
}

describe('cloud restores go through the store', () => {
  it('parks a downloaded game without touching the active one, through normaliseGame', async () => {
    const active = createGame(dailyGameSettings(u, 'daily-2026-10-25'))
    reset(active)
    const cloud = createGame(seasonSettings('CLOUD-1')) as Partial<Game>
    // an old save shape: a field added later is missing and must be filled in
    delete cloud.weekPlayed
    expect(await useStore.getState().importCloudGame('season', cloud as Game, 'park')).toBe(true)
    const s = useStore.getState()
    expect(s.game).toBe(active)
    expect(s.parked.season?.id).toBe(cloud.id)
    expect(s.parked.season?.weekPlayed).toEqual([])
  })

  it('never parks over the active game of the same slot, and replaces it only on "replace"', async () => {
    const active = createGame(seasonSettings('CLOUD-2'))
    reset(active)
    const cloud = { ...createGame(seasonSettings('CLOUD-2')), id: active.id }
    expect(await useStore.getState().importCloudGame('season', cloud, 'park')).toBe(false)
    expect(useStore.getState().game).toBe(active)
    expect(await useStore.getState().importCloudGame('season', cloud, 'replace')).toBe(true)
    expect(useStore.getState().game?.id).toBe(active.id)
    expect(useStore.getState().game).not.toBe(active)
  })

  it('parks an arena run in the arena slot with its run whole, and replaces the active one only on "replace"', async () => {
    const g = createGame(cupGameSettings(u, { teamName: 'Cloud XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed: 'CLOUD-ARENA', hardMode: false, twists: true, size: 8 }, 'CXI'))
    const rng = Rng.fromState(g.rngState)
    autoDraft(u, g.draft!, rng)
    g.rngState = rng.getState()
    beginArena(g, u)
    simArenaToEnd(g, u)
    // what the cloud hands back: the uploaded JSON
    const cloud = JSON.parse(JSON.stringify(compactGame(g))) as Game
    reset(createGame(seasonSettings('CLOUD-A')))
    expect(await useStore.getState().importCloudGame('season', cloud, 'park')).toBe(false)
    expect(await useStore.getState().importCloudGame('arena', cloud, 'park')).toBe(true)
    expect(JSON.parse(JSON.stringify(useStore.getState().parked.arena!.arena))).toEqual(JSON.parse(JSON.stringify(g.arena)))
    reset({ ...cloud, id: 'older-run' })
    expect(await useStore.getState().importCloudGame('arena', cloud, 'park')).toBe(false)
    expect(await useStore.getState().importCloudGame('arena', cloud, 'replace')).toBe(true)
    expect(useStore.getState().game?.id).toBe(g.id)
  })

  it('refuses a game in the wrong slot, a non-game, and a swap during a live match', async () => {
    const live = { ...createGame(seasonSettings('CLOUD-3')), phase: 'match' as const, live: { stop: 45 } as unknown as Game['live'] }
    reset(live)
    expect(await useStore.getState().importCloudGame('dynasty', createGame(seasonSettings('X')), 'park')).toBe(false)
    expect(await useStore.getState().importCloudGame('season', null as unknown as Game, 'park')).toBe(false)
    expect(await useStore.getState().importCloudGame('season', createGame(seasonSettings('CLOUD-3')), 'replace')).toBe(false)
    expect(useStore.getState().game).toBe(live)
  })

  it('loads the leagues a replaced game needs before it becomes active', async () => {
    const active = createGame(seasonSettings('CLOUD-4'))
    reset(active)
    const real = useStore.getState().ensureLeagues
    const ensure = vi.fn(async () => false)
    useStore.setState({ ensureLeagues: ensure })
    const cloud = { ...createGame({ ...seasonSettings('CLOUD-4'), leagueId: 'spain', wheelLeagues: ['spain'] }), id: active.id }
    expect(await useStore.getState().importCloudGame('season', cloud, 'replace')).toBe(false)
    // A standard game asks for no classic seasons (they load on demand, packs.ts)
    expect(ensure).toHaveBeenCalledWith(expect.arrayContaining(['spain']), false)
    expect(useStore.getState().game).toBe(active)
    useStore.setState({ ensureLeagues: real })
  })

  it('applies the merged profile and shortlist, keeping every default field', () => {
    reset(null)
    useStore.getState().applyCloudProfile({ achievements: { a: '2026-10-25' }, leaderboard: [], dailyStreak: 3, lastDailyDate: 'daily-2026-10-25', dailyResults: {}, gamesPlayed: 5, seasonsSimulated: 2, theme: 'dark', managerName: 'Minh' }, ['p1', 'p2'])
    const s = useStore.getState()
    expect(s.profile).toMatchObject({ dailyStreak: 3, managerName: 'Minh', theme: 'dark' })
    expect(s.shortlist).toEqual(['p1', 'p2'])
  })
})
