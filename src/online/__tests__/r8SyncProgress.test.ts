/**
 * QA round 3 (r8): a game's progress for the cloud sync. A Season sits on the match report (phase `match`, the
 * whistle gone, no live match) between matchweeks, and the sync uploads it there; the manager plays on, and the next
 * sync must see the newer copy as ahead, never as "an older save loaded after a storage failure" to restore over.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import type { Game, GameSettings, Profile } from '@game/types'
import { beginSeason, createGame } from '@game/logic/setup'
import { normaliseGame } from '@game/logic/save'
import { gameSlot, progressKey, compareProgress, type GameSlotId, type SlotId } from '../core/slots'
import { freshRecord, type OnlineRecord } from '../localState'
import { SyncEngine, type SyncStoreLike, type SyncView } from '../sync'
import { FakeBackend, FakeTransport } from './fakeTransport'

const u = loadTestUniverse()

function season(seed: string): Game {
  const settings: GameSettings = { mode: 'season', seed, formationId: '4-4-2', teamName: 'Sync Town', shortName: 'ST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'brentford', leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return normaliseGame(g)!
}

/** The same game at matchweek `mw`, on the report (`match`, no live match) or the hub (`week`). */
function at(g: Game, mw: number, phase: 'match' | 'week'): Game {
  const c = structuredClone(g)
  c.season!.matchweek = mw
  c.phase = phase
  c.live = null
  return c
}

const baseProfile = (): Profile => ({ achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' })

class FakeStore implements SyncStoreLike {
  s: SyncView = { game: null, parked: {}, h2h: null, profile: baseProfile(), shortlist: [], screen: 'home' }
  engine: SyncEngine | null = null
  set(patch: Partial<SyncView>) {
    const prev = this.s
    this.s = { ...prev, ...patch }
    this.engine?.observe(prev, this.s)
  }
  getState() {
    return this.s
  }
  async importCloudGame(slot: GameSlotId, raw: Game, mode: 'park' | 'replace') {
    const g = normaliseGame(raw)
    if (!g || gameSlot(g) !== slot) return false
    if (!this.s.game || gameSlot(this.s.game) !== slot) {
      this.set({ parked: { ...this.s.parked, [slot]: g } })
      return true
    }
    if (mode === 'park') return false
    this.set({ game: g })
    return true
  }
  importCloudH2H() {}
  applyCloudProfile(profile: Profile, shortlist: string[]) {
    this.set({ profile, shortlist })
  }
  discardSlot(slot: SlotId) {
    if (this.s.game && gameSlot(this.s.game) === slot) this.set({ game: null })
  }
  showToast() {}
}

const clock = { t: Date.UTC(2026, 9, 28, 9) }
const tick = (ms = 3 * 60000) => (clock.t += ms)

function device(b: FakeBackend, name: string) {
  const store = new FakeStore()
  let rec: OnlineRecord = freshRecord(`device-${name}-0000`)
  const engine = new SyncEngine({ transport: new FakeTransport(b, 'user-a'), store, userId: 'user-a', load: () => rec, save: (r) => (rec = r), now: () => clock.t, meta: { dataVersion: u.generatedAt, engineVersion: 'test', appBuild: 'test', deviceLabel: `Test · ${name}` }, report: () => {} })
  store.engine = engine
  return { store, engine }
}

describe('QA r8: progress for the cloud sync', () => {
  const g = season('R8-SYNC')

  it('a later matchweek is ahead whatever screen either copy is on', () => {
    const key = (mw: number, phase: 'match' | 'week') => progressKey({ kind: 'game', game: at(g, mw, phase) } as never)
    expect(compareProgress(key(15, 'week'), key(10, 'match'))).toBeGreaterThan(0)
    expect(compareProgress(key(10, 'match'), key(30, 'week'))).toBeLessThan(0)
    // Within one matchweek the hub after the report is not behind it
    expect(compareProgress(key(10, 'week'), key(10, 'match'))).toBeGreaterThanOrEqual(0)
  })

  it('uploaded on the report, played on five matchweeks: the next sync uploads, never restores the report over them', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: at(g, 10, 'match') })
    await a.engine.sync()
    tick()
    a.store.set({ game: at(g, 15, 'week') })
    await a.engine.sync()
    expect(a.store.s.game!.season!.matchweek).toBe(15)
    expect(b.rows.get('user-a|season')!.revision).toBe(2)
  })
  it('a preseason friendly\'s report sits between two pre-seasons, and the season moves on from both', () => {
    const pre = (friendlies: number, phase: 'preseason' | 'match' | 'week') => {
      const c = at(g, 0, 'week')
      c.phase = phase
      c.friendliesPlayed = friendlies
      return progressKey({ kind: 'game', game: c } as never)
    }
    expect(compareProgress(pre(1, 'match'), pre(0, 'preseason'))).toBeGreaterThan(0)
    expect(compareProgress(pre(1, 'preseason'), pre(1, 'match'))).toBeGreaterThanOrEqual(0)
    expect(compareProgress(pre(1, 'week'), pre(1, 'preseason'))).toBeGreaterThanOrEqual(0)
  })

  it('an arena run rises through a step: the hub, a shoot-out waiting, the report, a bonus spin, the next hub', () => {
    const settings: GameSettings = { ...g.settings, mode: 'arena', arena: { format: 'gauntlet' } }
    const arena = (step: number, phase: Game['phase'], pending = false, over = false) => {
      const c = structuredClone(g)
      c.settings = settings
      c.season = null
      c.phase = phase
      c.arena = { format: 'gauntlet', step, over, clubs: {}, next: null, log: [], streams: { field: '', ties: '', draw: '' }, ...(pending ? { pending: {} } : {}) } as unknown as Game['arena']
      return progressKey({ kind: 'game', game: c } as never)
    }
    const order = [arena(0, 'draft'), arena(0, 'week'), arena(0, 'match', true), arena(1, 'match'), arena(1, 'draft'), arena(1, 'week'), arena(1, 'match', true), arena(2, 'match', false, true), arena(2, 'summary', false, true)]
    for (let i = 1; i < order.length; i++) expect(compareProgress(order[i], order[i - 1]), `step ${i}`).toBeGreaterThan(0)
  })
})
