/**
 * A build from before the arena and Run-in slots, sharing an account with one that has them. The slot module is
 * mocked back to that build's four slots (`SLOT_IDS`, and `gameSlot`/`slotContents` that know no arena or run-in
 * slot); the sync engine, the planner and the fake backend are the real ones.
 */
import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import type { Game, GameSettings, Profile } from '@game/types'
import { beginSeason, createGame } from '@game/logic/setup'
import { beginArena, cupGameSettings } from '@game/logic/arena'
import { normaliseGame } from '@game/logic/save'
import { freshRecord } from '../localState'
import { SyncEngine, type SyncStoreLike, type SyncView } from '../sync'
import { FakeBackend, FakeTransport } from './fakeTransport'

const old = vi.hoisted(() => ({ on: false }))
vi.mock('../core/slots', async (importOriginal) => {
  const m = await importOriginal<typeof import('../core/slots')>()
  const known = (s: string | null) => (s === 'arena' || s === 'runin' ? null : s)
  return {
    ...m,
    get SLOT_IDS() {
      return old.on ? ['quick', 'season', 'dynasty', 'h2h'] : m.SLOT_IDS
    },
    gameSlot: (g: Game) => (old.on ? known(m.gameSlot(g)) : m.gameSlot(g)),
    slotContents: (s: Parameters<typeof m.slotContents>[0]) => {
      const out = m.slotContents(s)
      if (old.on) {
        delete out.arena
        delete out.runin
      }
      return out
    },
  }
})
const slots = await import('../core/slots')

const u = loadTestUniverse()
const profile = (): Profile => ({ achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' })

function season(seed: string): Game {
  const settings: GameSettings = { mode: 'season', seed, formationId: '4-4-2', teamName: 'Old Town', shortName: 'OT', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return normaliseGame(g)!
}

function arena(seed: string): Game {
  const g = createGame(cupGameSettings(u, { teamName: 'Cloud XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, size: 8 }, 'CXI'))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginArena(g, u)
  return normaliseGame(g)!
}

class Store implements SyncStoreLike {
  s: SyncView = { game: null, parked: {}, h2h: null, profile: profile(), shortlist: [], screen: 'home' }
  imported: string[] = []
  getState() {
    return this.s
  }
  async importCloudGame(slot: string, g: Game) {
    this.imported.push(slot)
    this.s = { ...this.s, parked: { ...this.s.parked, [slot]: g } }
    return true
  }
  importCloudH2H() {}
  applyCloudProfile(p: Profile, shortlist: string[]) {
    this.s = { ...this.s, profile: p, shortlist }
  }
  discardSlot() {}
  showToast() {}
}

let t = Date.UTC(2026, 9, 27, 9)
function device(b: FakeBackend, name: string) {
  const store = new Store()
  let rec = freshRecord(`device-${name}-0000`)
  const reports: Array<Record<string, unknown>> = []
  const engine = new SyncEngine({ transport: new FakeTransport(b, 'user-a'), store, userId: 'user-a', load: () => rec, save: (r) => (rec = r), now: () => (t += 180000), meta: { dataVersion: u.generatedAt, engineVersion: 'test', appBuild: 'test', deviceLabel: name }, report: (p) => void reports.push(p) })
  return { store, engine, last: () => reports.reduce((a, p) => ({ ...a, ...p }), {}) }
}

describe('an older build on the same account as one with the arena and Run-in slots', () => {
  const run = arena('OLD-ARENA')
  const seas = season('OLD-SEASON')

  it('the mock stands in the older build only while it is on', () => {
    old.on = true
    expect(slots.SLOT_IDS).toEqual(['quick', 'season', 'dynasty', 'h2h'])
    expect(slots.gameSlot(run)).toBeNull()
    old.on = false
    expect(slots.gameSlot(run)).toBe('arena')
  })

  it('leaves the arena row alone: no download, no claim, no question, and the slots it knows still sync', async () => {
    const b = new FakeBackend()
    old.on = false
    const fresh = device(b, 'new')
    fresh.store.s = { ...fresh.store.s, game: run, parked: { season: seas } }
    await fresh.engine.sync()
    const before = structuredClone(b.rows.get('user-a|arena'))
    expect(before?.gameId).toBe(run.id)

    old.on = true
    const older = device(b, 'old')
    older.store.s = { ...older.store.s, game: arena('OLD-ARENA-2') }
    const out = await older.engine.sync()
    expect(out.ok).toBe(true)
    expect(older.last()).toMatchObject({ syncStatus: 'idle', conflicts: [] })
    expect(older.store.imported).toEqual(['season'])
    expect(b.rows.get('user-a|arena')).toEqual(before)
    expect([...b.objects.keys()].filter((k) => k.includes('/arena/'))).toEqual([before!.objectPath])
    old.on = false
  })

  it('"Delete my cloud data" on the older build still takes the arena objects (the server lists every row)', async () => {
    const b = new FakeBackend()
    old.on = false
    const fresh = device(b, 'new')
    fresh.store.s = { ...fresh.store.s, game: run }
    await fresh.engine.sync()
    old.on = true
    const older = device(b, 'old')
    await older.engine.deleteCloudData()
    expect(b.objects.size).toBe(0)
    expect(b.rows.size).toBe(0)
    old.on = false
  })
})
