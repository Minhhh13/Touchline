import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { newH2HDraft, h2hSpin } from '@engine/h2h'
import type { Game, GameSettings, Profile } from '@game/types'
import type { H2HGame } from '@game/store'
import { beginSeason, createGame } from '@game/logic/setup'
import { normaliseGame } from '@game/logic/save'
import { gzipText } from '../core/bytes'
import { gameSlot, type SlotId } from '../core/slots'
import { freshRecord, type OnlineRecord } from '../localState'
import { encodeSlot, SyncEngine, restorable, type SyncStoreLike, type SyncView } from '../sync'
import { OnlineError } from '../transport'
import type { OnlineState } from '../state'
import { FakeBackend, FakeTransport } from './fakeTransport'

const u = loadTestUniverse()

function managed(mode: 'season' | 'dynasty', seed: string, host = 'brentford'): Game {
  const settings: GameSettings = { mode, seed, formationId: '4-4-2', teamName: 'Sync Town', shortName: 'ST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: host, leagueSeason: 2023, rules: { ...SEASON_RULES, leagues: ['england'] }, jobSecurity: true, difficulty: 'calibrated' }
  const g = createGame(settings)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  return normaliseGame(g)!
}

/** The same game, `n` matchweeks further on (the engine treats the save as opaque). */
function advance(g: Game, n: number): Game {
  const c = structuredClone(g)
  c.season!.matchweek += n
  c.phase = 'week'
  return c
}

function hotSeat(): H2HGame {
  const rng = new Rng('sync-h2h')
  const draft = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], { ...QUICK_RULES, respins: 0, hardMode: false, leagues: ['england'], twists: false })
  h2hSpin(u, draft, rng)
  return { managers: [{ name: 'Ana', shortName: 'ANA', formationId: '4-3-3', hostClubId: 'arsenal' }, { name: 'Ben', shortName: 'BEN', formationId: '4-4-2', hostClubId: 'chelsea' }], leagueId: 'england', wheelLeagues: ['england'], leagueSeason: 2020, difficulty: 'calibrated', seed: 'sync-h2h', rngState: rng.getState(), draft, result: null, hardMode: false }
}

const baseProfile = (): Profile => ({ achievements: {}, leaderboard: [], dailyStreak: 0, lastDailyDate: null, dailyResults: {}, gamesPlayed: 0, seasonsSimulated: 0, theme: 'auto', managerName: '' })

class FakeStore implements SyncStoreLike {
  s: SyncView = { game: null, parked: {}, h2h: null, profile: baseProfile(), shortlist: [], screen: 'home' }
  toasts: string[] = []
  engine: SyncEngine | null = null
  set(patch: Partial<SyncView>) {
    const prev = this.s
    this.s = { ...prev, ...patch }
    this.engine?.observe(prev, this.s)
  }
  getState() {
    return this.s
  }
  async importCloudGame(slot: 'quick' | 'season' | 'dynasty', raw: Game, mode: 'park' | 'replace') {
    const g = normaliseGame(raw)
    if (!g || gameSlot(g) !== slot) return false
    const active = !!this.s.game && gameSlot(this.s.game) === slot
    if (!active) {
      this.set({ parked: { ...this.s.parked, [slot]: g } })
      return true
    }
    if (mode === 'park') return false
    this.set({ game: g })
    return true
  }
  importCloudH2H(h: H2HGame, mode: 'park' | 'replace') {
    if (mode === 'park' && this.s.h2h) return
    this.set({ h2h: h })
  }
  applyCloudProfile(profile: Profile, shortlist: string[]) {
    this.set({ profile, shortlist })
  }
  discardSlot(slot: SlotId) {
    if (slot === 'h2h') return this.set({ h2h: null })
    if (this.s.game && gameSlot(this.s.game) === slot) return this.set({ game: null })
    const parked = { ...this.s.parked }
    delete parked[slot]
    this.set({ parked })
  }
  showToast(t: string) {
    this.toasts.push(t)
  }
}

const clock = { t: Date.UTC(2026, 9, 25, 9) }
const tick = (ms = 3 * 60000) => (clock.t += ms)

function device(b: FakeBackend, name: string, userId = 'user-a', record?: OnlineRecord) {
  const store = new FakeStore()
  let rec = record ?? freshRecord(`device-${name}-0000`)
  const reports: Array<Partial<OnlineState>> = []
  const transport = new FakeTransport(b, userId)
  const engine = new SyncEngine({ transport, store, userId, load: () => rec, save: (r) => (rec = r), now: () => clock.t, meta: { dataVersion: u.generatedAt, engineVersion: 'test', appBuild: 'test', deviceLabel: `Test · ${name}` }, report: (p) => void reports.push(p) })
  store.engine = engine
  const last = () => reports.reduce<Partial<OnlineState>>((a, p) => ({ ...a, ...p }), {})
  return { store, engine, transport, rec: () => rec, reports, last }
}

const claims = (b: FakeBackend) => b.calls.filter((c) => c === 'claim').length
const row = (b: FakeBackend, slot: SlotId, uid = 'user-a') => b.rows.get(`${uid}|${slot}`)

describe('cloud sync engine', () => {
  const season = managed('season', 'SYNC-SEAS')
  const otherSeason = managed('season', 'SYNC-OTHER', 'fulham')

  it('uploads a new slot (row 6), then finds it in sync (row 8) without another claim', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    expect((await a.engine.sync()).ok).toBe(true)
    expect(row(b, 'season')).toMatchObject({ revision: 1, gameId: season.id })
    expect(row(b, 'season')!.contentHash).toBe((await encodeSlot({ slot: 'season', kind: 'game', game: season, active: true })).hash)
    expect(claims(b)).toBe(1)
    tick()
    await a.engine.sync()
    expect(claims(b)).toBe(1)
    expect(a.rec().slots.season).toMatchObject({ gameId: season.id, revision: 1 })
    expect(a.last()).toMatchObject({ syncStatus: 'idle', conflicts: [] })
  })

  it('parks the cloud copy on a fresh device and never makes it active (row 2)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const d2 = device(b, 'b')
    d2.store.set({ game: null })
    await d2.engine.sync()
    expect(d2.store.s.game).toBeNull()
    expect(d2.store.s.parked.season?.id).toBe(season.id)
    expect(d2.rec().slots.season?.revision).toBe(1)
    // and the hash agrees once parked, so nothing moves
    tick()
    await d2.engine.sync()
    expect(claims(b)).toBe(1)
  })

  it('continues on the other device: B uploads its progress (row 9) and A downloads it (row 10)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const d2 = device(b, 'b')
    await d2.engine.sync()
    tick()
    d2.store.set({ parked: { season: advance(d2.store.s.parked.season!, 4) } })
    await d2.engine.sync({ force: true })
    expect(row(b, 'season')!.revision).toBe(2)
    tick()
    await a.engine.sync()
    expect(a.store.s.game!.season!.matchweek).toBe(season.season!.matchweek + 4)
    expect(a.store.toasts.join(' ')).toMatch(/continued on Test · b/)
    expect(claims(b)).toBe(2)
  })

  it('never swaps the game on screen: it offers "Load it" and loads only on the answer', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season, screen: 'game' })
    await a.engine.sync()
    const d2 = device(b, 'b')
    await d2.engine.sync()
    tick()
    d2.store.set({ parked: { season: advance(d2.store.s.parked.season!, 2) } })
    await d2.engine.sync({ force: true })
    tick()
    await a.engine.sync()
    expect(a.store.s.game!.season!.matchweek).toBe(season.season!.matchweek)
    expect(a.last().conflicts).toEqual([expect.objectContaining({ kind: 'newer', slot: 'season' })])
    await a.engine.sync({ resolve: { slot: 'season', choice: 'load' } })
    expect(a.store.s.game!.season!.matchweek).toBe(season.season!.matchweek + 2)
  })

  it('resolves the same game played on both devices by progress, keeping the other copy as the previous one (row 12)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const d2 = device(b, 'b')
    await d2.engine.sync()
    tick()
    a.store.set({ game: advance(season, 2) })
    d2.store.set({ parked: { season: advance(d2.store.s.parked.season!, 5) } })
    await d2.engine.sync({ force: true })
    tick()
    await a.engine.sync({ force: true })
    // B was further on: A takes it, and A's own copy is filed in Cloud history
    expect(a.store.s.game!.season!.matchweek).toBe(season.season!.matchweek + 5)
    const r = row(b, 'season')!
    expect(r.prevGameId).toBe(season.id)
    expect(r.prevMeta?.matchweek).toBe(season.season!.matchweek + 2)
    expect(a.store.toasts.join(' ')).toMatch(/Cloud history/)
    // the losing copy went up once, as the previous copy, and nothing more moves
    const n = claims(b)
    tick()
    await a.engine.sync()
    await d2.engine.sync()
    expect(claims(b)).toBe(n)
  })

  it('asks when two different games claim a slot (row 13); either answer uploads once and keeps the other', async () => {
    for (const choice of ['keep_local', 'use_cloud'] as const) {
      const b = new FakeBackend()
      const a = device(b, 'a')
      a.store.set({ game: season })
      await a.engine.sync()
      const d2 = device(b, 'b')
      d2.store.set({ game: otherSeason })
      await d2.engine.sync()
      expect(d2.last().conflicts).toEqual([expect.objectContaining({ kind: 'different', slot: 'season' })])
      expect(d2.store.s.game!.id).toBe(otherSeason.id)
      const before = claims(b)
      await d2.engine.sync({ resolve: { slot: 'season', choice } })
      expect(claims(b)).toBe(before + 1)
      const r = row(b, 'season')!
      if (choice === 'keep_local') {
        expect(r.gameId).toBe(otherSeason.id)
        expect(r.prevGameId).toBe(season.id)
        expect(d2.store.s.game!.id).toBe(otherSeason.id)
      } else {
        expect(r.gameId).toBe(season.id)
        expect(r.prevGameId).toBe(otherSeason.id)
        expect(d2.store.s.game!.id).toBe(season.id)
      }
      expect(restorable(r)).toBe(true)
    }
  })

  it('deletes in the cloud only after it saw the game leave this device (row 3); the other device is asked (row 5)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const d2 = device(b, 'b')
    await d2.engine.sync()
    tick()
    a.store.set({ game: null })
    expect(a.rec().tombstones).toEqual([expect.objectContaining({ slot: 'season', gameId: season.id })])
    await a.engine.sync()
    expect(row(b, 'season')!.deletedAt).not.toBeNull()
    expect(a.rec().tombstones).toEqual([])
    tick()
    await d2.engine.sync()
    expect(d2.last().conflicts).toEqual([expect.objectContaining({ kind: 'abandoned', slot: 'season' })])
    expect(d2.store.s.parked.season).toBeDefined()
    await d2.engine.sync({ resolve: { slot: 'season', choice: 'remove' } })
    expect(d2.store.s.parked.season).toBeUndefined()
    tick()
    await d2.engine.sync()
    expect(d2.last().conflicts).toEqual([])
  })

  it('keeps a game played on after it was abandoned elsewhere, and says so (row 5)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const d2 = device(b, 'b')
    await d2.engine.sync()
    tick()
    a.store.set({ game: null })
    await a.engine.sync()
    d2.store.set({ parked: { season: advance(d2.store.s.parked.season!, 1) } })
    tick()
    await d2.engine.sync({ force: true })
    expect(row(b, 'season')).toMatchObject({ deletedAt: null, gameId: season.id })
    expect(d2.store.toasts.join(' ')).toMatch(/removed on another device/)
  })

  it('treats absence at startup as nothing: the cloud copy is parked again, never deleted (row 4)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    // the browser's storage was cleared: a store with nothing in it, the sync record still there
    const again = device(b, 'a2', 'user-a', a.rec())
    await again.engine.sync()
    expect(row(b, 'season')!.deletedAt).toBeNull()
    expect(again.store.s.parked.season?.id).toBe(season.id)
  })

  it('never uploads or swaps a game paused in a live match', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    const live = { ...structuredClone(season), phase: 'match' as const, live: { stop: 45 } as unknown as Game['live'] }
    a.store.set({ game: live })
    await a.engine.sync({ force: true })
    expect(row(b, 'season')).toBeUndefined()
    expect(claims(b)).toBe(0)
  })

  it('uploads a Season at most once every two minutes unless forced', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    tick(30000)
    a.store.set({ game: advance(season, 1) })
    await a.engine.sync()
    expect(claims(b)).toBe(1)
    await a.engine.sync({ force: true })
    expect(claims(b)).toBe(2)
    tick(30000)
    a.store.set({ game: advance(season, 2) })
    await a.engine.sync()
    expect(claims(b)).toBe(2)
    tick(120000)
    await a.engine.sync()
    expect(claims(b)).toBe(3)
  })

  it('never retries a lost compare-and-set blindly: the upload is removed and the slot planned again', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    tick()
    a.store.set({ game: advance(season, 3) })
    const t = a.transport
    const claim = t.claim.bind(t)
    let raced = false
    t.claim = async (args) => {
      if (!raced) {
        raced = true
        // another device's write lands between the pull and the claim
        row(b, 'season')!.revision++
      }
      return claim(args)
    }
    await a.engine.sync({ force: true })
    expect(raced).toBe(true)
    const used = new Set([row(b, 'season')!.objectPath, row(b, 'season')!.prevObjectPath])
    expect([...b.objects.keys()].filter((k) => !used.has(k))).toEqual([])
  })

  it('reports offline on a network failure and a rate limit as such, and recovers on the next pass', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    b.failNext.push(new OnlineError('network', 'Failed to fetch'))
    const out = await a.engine.sync()
    expect(out.ok).toBe(false)
    expect(out.error?.kind).toBe('network')
    expect(a.last().syncStatus).toBe('offline')
    b.failNext.push(new OnlineError('rate', 'too many', 'PT429', 429))
    expect((await a.engine.sync()).error?.kind).toBe('rate')
    expect((await a.engine.sync()).ok).toBe(true)
    expect(row(b, 'season')).toBeDefined()
  })

  it('keeps an unreadable cloud copy out of the game and keeps the local one', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    b.objects.set(row(b, 'season')!.objectPath!, new TextEncoder().encode('not gzip'))
    const d2 = device(b, 'b')
    await d2.engine.sync()
    expect(d2.store.s.parked.season).toBeUndefined()
    expect(d2.store.toasts.join(' ')).toMatch(/unreadable/)
  })

  it('syncs the hot-seat head-to-head and a Dynasty in their own slots', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    const dyn = managed('dynasty', 'SYNC-DYN')
    a.store.set({ game: dyn, h2h: hotSeat(), parked: { season } })
    await a.engine.sync()
    expect([...b.rows.keys()].sort()).toEqual(['user-a|dynasty', 'user-a|h2h', 'user-a|season'])
    const d2 = device(b, 'b')
    await d2.engine.sync()
    expect(d2.store.s.h2h?.seed).toBe('sync-h2h')
    expect(d2.store.s.parked.dynasty?.id).toBe(dyn.id)
    expect(d2.store.s.parked.season?.id).toBe(season.id)
  })

  it('merges the profile across devices: records grow on both, a lone device never changes its own', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ profile: { ...baseProfile(), achievements: { 'first-win': '2026-10-20' }, gamesPlayed: 4, dailyResults: { 'daily-2026-10-23': { points: 60, tier: 'MID_TABLE' }, 'daily-2026-10-24': { points: 70, tier: 'EUROPEAN' } }, lastDailyDate: 'daily-2026-10-24', dailyStreak: 2 } })
    await a.engine.sync()
    const lone = structuredClone(a.store.s.profile)
    await a.engine.sync()
    expect(a.store.s.profile).toEqual(lone)
    const d2 = device(b, 'b')
    d2.store.set({ profile: { ...baseProfile(), achievements: { invincible: '2026-10-22' }, gamesPlayed: 9, dailyResults: { 'daily-2026-10-25': { points: 80, tier: 'CHAMPIONS' } }, lastDailyDate: 'daily-2026-10-25', dailyStreak: 1 }, shortlist: ['p1'] })
    await d2.engine.sync()
    tick()
    await a.engine.sync()
    for (const p of [a.store.s.profile, d2.store.s.profile]) {
      expect(Object.keys(p.achievements).sort()).toEqual(['first-win', 'invincible'])
      expect(p.gamesPlayed).toBe(9)
      expect(p.dailyStreak).toBe(3)
    }
    expect(a.store.s.shortlist).toEqual(['p1'])
  })

  it('signing in on a second device brings the seasons and records down (the account\'s promise)', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    const dyn = managed('dynasty', 'SYNC-DYN-2')
    const best = { id: 'run-1', date: '2026-10-24', mode: 'quick' as const, teamName: 'Sync Town', points: 98, won: 32, drawn: 2, lost: 4, position: 1, tier: 'CHAMPIONS' as const, seed: 'SEED-38', leagueSeason: 2018, hostClubId: 'southampton', xi: [] }
    a.store.set({ game: season, parked: { dynasty: dyn }, profile: { ...baseProfile(), leaderboard: [best], achievements: { champions: '2026-10-24' }, dailyResults: { 'daily-2026-10-24': { points: 70, tier: 'EUROPEAN' } }, lastDailyDate: 'daily-2026-10-24', dailyStreak: 1, seasonsSimulated: 3, favouriteClub: 'arsenal' } })
    await a.engine.sync()
    // A fresh browser, nothing played on it: the first sign-in there parks every game and takes every record
    const d2 = device(b, 'b')
    await d2.engine.sync()
    expect(d2.store.s.game).toBeNull()
    expect(d2.store.s.parked.season?.id).toBe(season.id)
    expect(d2.store.s.parked.dynasty?.id).toBe(dyn.id)
    const p = d2.store.s.profile
    expect(p.leaderboard.map((e) => e.id)).toEqual(['run-1'])
    expect(p.achievements).toEqual({ champions: '2026-10-24' })
    expect(p.dailyResults['daily-2026-10-24']).toEqual({ points: 70, tier: 'EUROPEAN' })
    expect(p.seasonsSimulated).toBe(3)
    expect(p.favouriteClub).toBe('arsenal')
    expect(d2.last()).toMatchObject({ syncStatus: 'idle' })
    expect(typeof d2.last().lastSyncAt).toBe('string')
  })

  it('asks before mixing two accounts on one device, and "keep" leaves this device\'s games out of the new one', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    const other = device(b, 'a', 'user-b', a.rec())
    other.store.set({ game: season })
    const out = await other.engine.sync()
    expect(out).toEqual({ ok: false, error: null })
    expect(other.last().accountSwitch).toEqual({ previousUserId: 'user-a' })
    expect(row(b, 'season', 'user-b')).toBeUndefined()
    await other.engine.chooseAccount('keep')
    expect(row(b, 'season', 'user-b')).toBeUndefined()
    expect(other.rec().userId).toBe('user-b')
    expect(other.rec().localOnly).toContain(season.id)
    // a new game after the switch syncs to the new account as usual
    other.store.set({ game: otherSeason })
    tick()
    await other.engine.sync()
    expect(row(b, 'season', 'user-b')?.gameId).toBe(otherSeason.id)
  })

  it('"Delete my cloud data" removes every row and object of the account, and nothing local', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season, h2h: hotSeat() })
    await a.engine.sync()
    b.objects.set('user-a/season/1-0123456789abcdef.json.gz', await gzipText('{}'))
    const n = await a.engine.deleteCloudData()
    expect(n).toBe(3)
    expect(b.rows.size).toBe(0)
    expect(b.objects.size).toBe(0)
    expect(b.profiles.size).toBe(0)
    expect(a.store.s.game?.id).toBe(season.id)
    expect(a.rec().slots).toEqual({})
    // this device does not put it all straight back: sync stays off, forced or not, until the player's Sync now
    tick()
    await a.engine.sync()
    await a.engine.sync({ force: true })
    expect(b.rows.size).toBe(0)
    expect(b.profiles.size).toBe(0)
    expect(a.last()).toMatchObject({ syncStatus: 'paused' })
    await a.engine.sync({ force: true, resume: true })
    expect(row(b, 'season')?.gameId).toBe(season.id)
    expect(a.rec().paused).toBe(false)
  })
})

describe('cloud sync when the connection or the session fails mid-pass', () => {
  const season = managed('season', 'SYNC-EDGE')

  it('a drop between the upload and the claim leaves only an orphan, which the sweep removes; the next pass uploads', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    const t = a.transport
    const claim = t.claim.bind(t)
    let dropped = false
    t.claim = async (args) => {
      if (!dropped) {
        dropped = true
        throw new OnlineError('network', 'Load failed')
      }
      return claim(args)
    }
    const out = await a.engine.sync()
    expect(out).toMatchObject({ ok: false, error: { kind: 'network' } })
    expect(a.last().syncStatus).toBe('offline')
    expect(row(b, 'season')).toBeUndefined()
    expect(b.objects.size).toBe(1)
    tick()
    expect((await a.engine.sync()).ok).toBe(true)
    expect(row(b, 'season')).toMatchObject({ revision: 1, gameId: season.id })
    await a.engine.sweepOrphans()
    expect([...b.objects.keys()]).toEqual([row(b, 'season')!.objectPath])
  })

  it('a claim the server applied but whose answer was lost is in sync on the next pass: no second claim, no question', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    tick()
    a.store.set({ game: advance(season, 2) })
    const t = a.transport
    const claim = t.claim.bind(t)
    let lost = false
    t.claim = async (args) => {
      const res = await claim(args)
      if (!lost) {
        lost = true
        throw new OnlineError('network', 'Failed to fetch')
      }
      return res
    }
    expect((await a.engine.sync({ force: true })).ok).toBe(false)
    expect(row(b, 'season')!.revision).toBe(2)
    const before = claims(b)
    tick()
    expect((await a.engine.sync({ force: true })).ok).toBe(true)
    expect(claims(b)).toBe(before)
    expect(a.last().conflicts).toEqual([])
    expect(a.rec().slots.season).toMatchObject({ revision: 2 })
  })

  it('an expired session mid-pass pauses sync with "Sign in again" and loses nothing; the next session carries on', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    a.store.set({ game: season })
    await a.engine.sync()
    tick()
    const next = advance(season, 4)
    a.store.set({ game: next })
    // the pull works, then the JWT runs out before the upload
    const t = a.transport
    const upload = t.upload.bind(t)
    let expired = true
    t.upload = async (path, bytes) => {
      if (expired) throw new OnlineError('auth', 'JWT expired', 'PGRST303', 401)
      return upload(path, bytes)
    }
    const out = await a.engine.sync({ force: true })
    expect(out.error?.kind).toBe('auth')
    expect(a.last()).toMatchObject({ syncStatus: 'paused', syncMessage: 'Sign in again to keep syncing.' })
    expect(row(b, 'season')!.revision).toBe(1)
    expect(a.store.s.game).toBe(next)
    expired = false
    expect((await a.engine.sync({ force: true })).ok).toBe(true)
    expect(row(b, 'season')!.revision).toBe(2)
    expect(a.last().syncStatus).toBe('idle')
  })

  it('two devices playing the same Season offline: the one further on wins, the other copy stays in the cloud history', async () => {
    const b = new FakeBackend()
    const a = device(b, 'a')
    const c = device(b, 'c')
    a.store.set({ game: season })
    await a.engine.sync()
    tick()
    await c.engine.sync()
    // c parked the cloud copy; it takes it up and both play on with no connection
    c.store.set({ game: c.store.s.parked.season!, parked: {} })
    a.store.set({ game: advance(season, 2) })
    c.store.set({ game: advance(season, 5) })
    tick()
    await a.engine.sync({ force: true })
    tick()
    await c.engine.sync({ force: true })
    expect(row(b, 'season')!.meta.matchweek).toBe(advance(season, 5).season!.matchweek)
    tick()
    // a is told, not overwritten while it is off the game screen: it loads the further copy and files its own
    await a.engine.sync({ force: true })
    expect(a.store.s.game!.season!.matchweek).toBe(advance(season, 5).season!.matchweek)
    expect(row(b, 'season')!.prevObjectPath).toBeTruthy()
    expect(a.last().conflicts).toEqual([])
  })
})
