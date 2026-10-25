import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { createGame, beginSeason } from '../logic/setup'
import { applyEventChoice, playMatchweek, recentShare, startSeasonProper, statusOf } from '../logic/week'
import { autoDraft, SEASON_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { acceptsStatus, defaultStatuses, EXPECTED_SHARE, minutesShare, naturalStatus, RECENT_WEEKS, STATUS_RANK, statusMoraleDrift, WAGE_MULT, type SquadStatus } from '@engine/status'
import { newSquadPlayer } from '@engine/season'
import { placeBid, type Listing, type Window } from '@engine/market'
import { bidFor, suggestedStatus } from '../logic/marketOps'
import { setSquadStatus, squadWages } from '../logic/squad'
import { advanceToNextSeason } from '../logic/dynasty'
import { playerLookup, squadPlayers } from '../logic/players'
import { rollEvent, resolveEvent, type EventContext } from '@engine/events'
import type { Game, GameSettings } from '../types'

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'dynasty',
    seed: 'status-flow',
    formationId: '4-3-3',
    teamName: 'Test XI',
    shortName: 'TST',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...SEASON_RULES, leagues: ['england'] },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function newGame(u: ReturnType<typeof loadTestUniverse>, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  startSeasonProper(g)
  return g
}

/** Mean squad morale after 20 auto-managed weeks in season mode before statuses existed (bench drift only), pinned on seed `status-flow`. */
const MORALE_BEFORE_STATUSES = 92.2
/** One seed's twenty weeks swing the mean by several points with the results, so the comparison averages a few. */
const MORALE_SEEDS = ['status-flow', 'status-flow-2', 'status-flow-3', 'status-flow-4', 'status-flow-5', 'status-flow-6']

describe('squad status and playing time', () => {
  const u = loadTestUniverse()

  it('gives every drafted contract a status by rank (four key, seven first team, six rotation, the rest backup), one step lower outside the opening eleven', () => {
    const g = newGame(u)
    const squad = squadPlayers(g, u).sort((a, b) => b.p.overall - a.p.overall || a.p.id.localeCompare(b.p.id))
    expect(squad.length).toBe(18)
    const overalls = squad.map((x) => x.p.overall).sort((a, b) => a - b)
    const median = (overalls[8] + overalls[9]) / 2
    const xi = new Set(Object.values(g.lineup))
    const stepDown: Record<SquadStatus, SquadStatus> = { key: 'first-team', 'first-team': 'rotation', rotation: 'backup', backup: 'backup', prospect: 'prospect' }
    squad.forEach((x, i) => {
      const status = g.contracts[x.p.id].status
      const byRank: SquadStatus = i < 4 ? 'key' : i < 11 ? 'first-team' : i < 17 ? 'rotation' : 'backup'
      expect(status).toBe(x.p.age <= 21 && x.p.overall < median ? 'prospect' : xi.has(x.p.id) ? byRank : stepDown[byRank])
    })
    const keys = Object.values(g.contracts).filter((c) => c.status === 'key').length
    expect(keys).toBeGreaterThan(0)
    expect(keys).toBeLessThanOrEqual(4)
    // The pure helper agrees, and a 20-year-old below the median is a prospect wherever he ranks
    const d = defaultStatuses([
      { id: 'a', overall: 90, age: 30 },
      { id: 'b', overall: 70, age: 20 },
      { id: 'c', overall: 80, age: 25 },
      { id: 'd', overall: 85, age: 21 },
    ])
    expect(d).toEqual({ a: 'key', c: 'key', d: 'key', b: 'prospect' })
    // Outside the eleven, each status steps down one place
    const e = defaultStatuses(
      Array.from({ length: 18 }, (_, i) => ({ id: `p${i}`, overall: 90 - i, age: 28 })),
      new Set(Array.from({ length: 11 }, (_, i) => `p${i + 1}`)),
    )
    expect(e.p0).toBe('first-team')
    expect(e.p1).toBe('key')
    expect(e.p4).toBe('first-team')
    expect(e.p12).toBe('backup')
    expect(e.p17).toBe('backup')
    // An existing status is kept when the season begins again
    const id = squad[0].p.id
    g.contracts[id].status = 'backup'
    g.draft = null
    g.phase = 'summary'
    beginSeason(g, u)
    expect(g.contracts[id].status).toBe('backup')
  })

  it('moves morale against the status: a key player benched four weeks loses, a backup given minutes gains, rotation on 35% sits still', () => {
    const p = Object.values(u.index).find((x) => x.traits.professionalism >= 0.45 && x.traits.professionalism <= 0.55)!
    const key = newSquadPlayer(p.id, { morale: 70 })
    const minutes: number[] = []
    for (let w = 0; w < 4; w++) {
      minutes.push(0)
      const delta = statusMoraleDrift(key, p, 'key', minutesShare(minutes)!)
      expect(delta).toBe(-5)
    }
    expect(key.morale).toBe(50)
    const backup = newSquadPlayer(p.id, { morale: 60 })
    const delta = statusMoraleDrift(backup, p, 'backup', minutesShare([90, 90, 90, 90])!)
    expect(delta).toBeCloseTo(2.8, 5)
    expect(backup.morale).toBeCloseTo(62.8, 5)
    const rotation = newSquadPlayer(p.id, { morale: 60 })
    expect(statusMoraleDrift(rotation, p, 'rotation', 0.35)).toBe(0)
    expect(statusMoraleDrift(rotation, p, 'rotation', 0.22)).toBe(0)
    expect(statusMoraleDrift(rotation, p, 'rotation', 0.19)).toBeLessThan(0)
    expect(rotation.morale).toBeLessThan(60)
    // Two matches in a week count, but a week is never more than its full share
    expect(minutesShare([180, 0])).toBe(1)
    expect(minutesShare([])).toBeNull()
    // The less professional sulk faster
    const pro = { ...p, traits: { ...p.traits, professionalism: 1 } }
    const slacker = { ...p, traits: { ...p.traits, professionalism: 0 } }
    const a = newSquadPlayer(p.id, { morale: 70 })
    const b = newSquadPlayer(p.id, { morale: 70 })
    statusMoraleDrift(a, pro, 'first-team', 0.3)
    statusMoraleDrift(b, slacker, 'first-team', 0.3)
    expect(a.morale).toBeGreaterThan(b.morale)
  })

  it('refuses a status beneath the player: no rotation for an 88 when our fourth best is 84, no backup for anyone above the median', () => {
    const overalls = [90, 89, 86, 84, 80, 78, 77, 76, 75, 74, 72, 70, 70, 69, 68, 66, 65, 60]
    const star = Object.values(u.index).find((x) => x.overall === 88 && x.age > 21)!
    expect(acceptsStatus(star, overalls, 'rotation')).toMatchObject({ ok: false, counter: 'first-team' })
    expect(acceptsStatus(star, overalls, 'backup').ok).toBe(false)
    expect(acceptsStatus(star, overalls, 'first-team').ok).toBe(true)
    expect(acceptsStatus(star, overalls, 'key').ok).toBe(true)
    expect(acceptsStatus(star, overalls, 'prospect')).toMatchObject({ ok: false })
    const mid = { name: 'Mid', overall: 76, age: 27 }
    expect(acceptsStatus(mid, overalls, 'rotation').ok).toBe(true)
    expect(acceptsStatus(mid, overalls, 'backup')).toMatchObject({ ok: false, counter: 'rotation' })
    const fringe = { name: 'Fringe', overall: 62, age: 27 }
    expect(acceptsStatus(fringe, overalls, 'backup').ok).toBe(true)
    expect(naturalStatus(star, overalls)).toBe('key')
    expect(naturalStatus(mid, overalls)).toBe('first-team')
    expect(naturalStatus(fringe, overalls)).toBe('backup')
    expect(naturalStatus({ overall: 66, age: 20 }, overalls)).toBe('prospect')

    // Through the market: the refusal comes back with the counter status, and the wage follows the status he does sign on
    const rng = new Rng('status-bid')
    const listing: Listing = { playerSeasonId: star.id, asking: 50, opening: 50, suitors: 0, listedDay: 0, tags: [], status: 'available' }
    const w: Window = { kind: 'january', day: 0, days: 7, listings: [listing], offers: [], log: [] }
    const ctx = { u, rng, ownedPlayerIds: new Set<string>(), leagueSeason: 2025, priceLevel: 1 }
    const finances = { budget: 100, wageCap: 99999, income: 0, spent: 0, wagesPaid: 0 }
    const refused = placeBid(ctx, w, listing, 50, finances, 0, undefined, { status: 'rotation', squadOveralls: overalls })
    expect(refused.accepted).toBe(false)
    expect(refused.counterStatus).toBe('first-team')
    expect(refused.message).toContain('first team')
    expect(listing.status).toBe('available')
    // The wage-cap check uses the multiplied wage
    const tight = { ...finances, wageCap: Math.round(star.wage * 1.2) }
    const overCap = placeBid(ctx, w, listing, 50, tight, 0, undefined, { status: 'key', squadOveralls: overalls })
    expect(overCap.accepted).toBe(false)
    expect(overCap.message).toContain(`£${Math.round(star.wage * WAGE_MULT.key)}k/wk as key player`)
    const signed = placeBid(ctx, w, listing, 50, finances, 0, undefined, { status: 'key', squadOveralls: overalls })
    expect(signed.accepted).toBe(true)
    expect(signed.wage).toBe(Math.round(star.wage * WAGE_MULT.key))
  })

  it('signs a listing on a status, with the wage multiplier written into the game', () => {
    const g = newGame(u, { seed: 'status-market' })
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    g.finances.budget = 999
    g.finances.wageCap = 99999
    const listing = g.window!.listings.find((l) => l.status === 'available')!
    const p = u.index[listing.playerSeasonId]
    const out = bidFor(g, u, listing.playerSeasonId, listing.asking, { years: 2, status: 'key' })
    expect(out.accepted).toBe(true)
    expect(g.contracts[p.id]).toEqual({ years: Math.min(2, p.age >= 33 ? 2 : 4), status: 'key' })
    expect(playerLookup(g, u)(p.id)!.wage).toBe(Math.round(p.wage * WAGE_MULT.key))
    expect(squadWages(g, u)).toBeGreaterThan(0)
    // A second listing on rotation, if he accepts it, costs his listed wage
    const other = g.window!.listings.find((l) => l.status === 'available' && u.index[l.playerSeasonId].overall < 70)
    if (other) {
      const q = u.index[other.playerSeasonId]
      const out2 = bidFor(g, u, other.playerSeasonId, other.asking, { status: 'rotation' })
      expect(out2.accepted).toBe(true)
      expect(g.contracts[q.id].status).toBe('rotation')
      expect(g.customPlayers[q.id]).toBeUndefined()
    }
  })

  it('suggests the status against the squad without the part-exchange player, and the bid carries exactly that status', () => {
    const g = newGame(u, { seed: 'status-exchange' })
    while (g.season!.matchweek < 19) playMatchweek(g, u, true)
    expect(g.window?.kind).toBe('january')
    g.finances.budget = 999
    g.finances.wageCap = 99999
    const squad = squadPlayers(g, u).sort((a, b) => b.p.overall - a.p.overall)
    // Our fourth best goes the other way: a target rated between our fourth and fifth best is fifth with him in the squad, fourth without him
    const fourth = squad[3]
    // The selling club will not take an injured man; his fitness is not what this test is about
    fourth.s.injury = null
    const listing = g.window!.listings.find((l) => {
      const p = u.index[l.playerSeasonId]
      return l.status === 'available' && p.age > 21 && p.overall <= fourth.p.overall && p.overall > squad[4].p.overall
    })
    expect(listing).toBeDefined()
    if (!listing) return
    const target = u.index[listing.playerSeasonId]
    expect(suggestedStatus(g, u, target)).toBe('first-team')
    expect(suggestedStatus(g, u, target, fourth.p.id)).toBe('key')
    const out = bidFor(g, u, listing.playerSeasonId, listing.asking, { exchangeId: fourth.p.id })
    expect(out.accepted).toBe(true)
    expect(g.contracts[target.id].status).toBe('key')
    expect(playerLookup(g, u)(target.id)!.wage).toBe(Math.round(target.wage * WAGE_MULT.key))
  })

  it('records minutes per matchweek, cup minutes in the same week, and keeps six weeks', () => {
    const g = newGame(u, { seed: 'status-minutes' })
    for (let w = 1; w <= 8; w++) {
      playMatchweek(g, u, true)
      for (const s of Object.values(g.squad)) expect(s.recentMinutes!.length).toBe(Math.min(w, RECENT_WEEKS))
    }
    // Matchweek 6 was followed by a cup tie: someone who played both has more than 90 in that week's entry
    const weekSix = Object.values(g.squad).map((s) => s.recentMinutes![5 - 2])
    expect(weekSix.some((m) => m > 90)).toBe(true)
    expect(Math.max(...Object.values(g.squad).map((s) => recentShare(s)!))).toBeLessThanOrEqual(1)
    // Starters who played every week carry the full share; anyone who never featured carries none
    const starters = Object.values(g.lineup)
    expect(starters.some((id) => recentShare(g.squad[id])! >= 0.9)).toBe(true)
    const never = Object.values(g.squad).filter((s) => s.recentMinutes!.every((m) => m === 0))
    for (const s of never) expect(recentShare(s)).toBe(0)
  })

  it('promotes and demotes from the Club tab: +6 morale and the wage ratio up, −6 morale and the wage kept down', () => {
    const g = newGame(u, { seed: 'status-select' })
    const x = squadPlayers(g, u).find((y) => g.contracts[y.p.id].status === 'rotation')!
    x.s.morale = 60
    const wage = x.p.wage
    setSquadStatus(g, u, x.p.id, 'key')
    expect(g.contracts[x.p.id].status).toBe('key')
    expect(g.squad[x.p.id].morale).toBe(66)
    expect(playerLookup(g, u)(x.p.id)!.wage).toBe(Math.round(wage * 1.25))
    setSquadStatus(g, u, x.p.id, 'backup')
    expect(g.squad[x.p.id].morale).toBe(60)
    expect(playerLookup(g, u)(x.p.id)!.wage).toBe(Math.round(wage * 1.25))
    expect(STATUS_RANK.key).toBeGreaterThan(STATUS_RANK.backup)
  })

  it('weighs the wants-minutes event at 6 for a short-changed key player and lets him go on the list', () => {
    const p = Object.values(u.index).find((x) => x.overall === 72)!
    const q = Object.values(u.index).find((x) => x.overall === 65 && x.playerId !== p.playerId)!
    const ctx: EventContext = {
      rng: new Rng('status-event'),
      matchweek: 5,
      expiring: [],
      recentForm: ['W', 'D'],
      beatRival: false,
      squad: [
        { p, s: newSquadPlayer(p.id), consecutiveMissed: 0, status: 'key', share: 0.3, shortOfMinutes: true },
        { p: q, s: newSquadPlayer(q.id), consecutiveMissed: 3, status: 'backup', share: 0, shortOfMinutes: false },
      ],
      unbeaten: false,
      wins: 1,
      losses: 0,
      position: 8,
      boardTarget: 10,
      confidence: 60,
      nextOpponentIsRival: false,
      budget: 10,
    }
    const ev = rollEvent(ctx)!
    expect(ev.id).toBe('wants-minutes')
    expect(ev.playerSeasonId).toBe(p.id)
    expect(ev.body).toContain(`expected ${Math.round(EXPECTED_SHARE.key * 100)}%`)
    expect(ev.choices.map((c) => c.id)).toContain('list')
    const out = resolveEvent(ev, 'list', ctx)
    expect(out.transferList).toBe(p.id)
    // Without the status shortfall a 72 who has not missed three matches is nobody's candidate
    const quiet = rollEvent({ ...ctx, rng: new Rng('status-event'), squad: [{ ...ctx.squad[0], shortOfMinutes: false }] })
    expect(quiet).toBeNull()
  })

  it('renews a contract as first team on +10% wages or as rotation on the same money', () => {
    const g = newGame(u, { seed: 'status-renew' })
    const get = playerLookup(g, u)
    const [first] = squadPlayers(g, u).filter((x) => g.contracts[x.p.id].status === 'first-team')
    const wage = first.p.wage
    g.pendingEvent = { id: 'contract', title: 't', body: 'b', playerSeasonId: first.p.id, choices: [] }
    applyEventChoice(g, u, 'renew')
    expect(g.contracts[first.p.id]).toMatchObject({ renewed: true, status: 'first-team' })
    expect(get(first.p.id)!.wage).toBe(Math.round(wage * 1.1))
    const [backup] = squadPlayers(g, u).filter((x) => g.contracts[x.p.id].status === 'backup' || g.contracts[x.p.id].status === 'rotation')
    const bw = backup.p.wage
    backup.s.morale = 60
    g.pendingEvent = { id: 'contract', title: 't', body: 'b', playerSeasonId: backup.p.id, choices: [] }
    applyEventChoice(g, u, 'renew-rotation')
    expect(g.contracts[backup.p.id]).toMatchObject({ renewed: true, status: 'rotation' })
    expect(get(backup.p.id)!.wage).toBe(bw)
    expect(g.squad[backup.p.id].morale).toBe(68)
    // A key player offered rotation either walks or signs on grudgingly, never on a rise
    const key = squadPlayers(g, u).find((x) => g.contracts[x.p.id].status === 'key')!
    const kw = key.p.wage
    g.pendingEvent = { id: 'contract', title: 't', body: 'b', playerSeasonId: key.p.id, choices: [] }
    applyEventChoice(g, u, 'renew-rotation')
    const c = g.contracts[key.p.id]
    expect(c.declined ? c.status : c.status === 'rotation' && c.renewed).toBeTruthy()
    expect(get(key.p.id)!.wage).toBe(kw)
  })

  it('carries the status through the dynasty summer and keeps the wage premium after ageing', async () => {
    const g = newGame(u, { seed: 'status-dynasty' })
    const ids = Object.keys(g.squad)
    // Statuses nobody could lose to an expiring contract
    for (const id of ids) g.contracts[id].years = 3
    const keyId = ids.find((id) => g.contracts[id].status === 'key')!
    const rotationId = ids.find((id) => g.contracts[id].status === 'rotation')!
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    advanceToNextSeason(g, u)
    const agedKey = Object.values(g.customPlayers).find((p) => p.playerId === u.index[keyId].playerId && p.id.includes('@dyn'))
    const agedRot = Object.values(g.customPlayers).find((p) => p.playerId === u.index[rotationId].playerId && p.id.includes('@dyn'))
    const baseWage = (value: number) => Math.round(5 * Math.pow(Math.max(0.1, value), 0.85))
    if (agedKey) {
      expect(g.contracts[agedKey.id].status).toBe('key')
      expect(agedKey.wage).toBe(Math.round(baseWage(agedKey.value) * WAGE_MULT.key))
    }
    if (agedRot) {
      expect(g.contracts[agedRot.id].status).toBe('rotation')
      expect(agedRot.wage).toBe(baseWage(agedRot.value))
    }
    expect(agedKey || agedRot).toBeTruthy()
    for (const c of Object.values(g.contracts)) expect(c.status).toBeDefined()
    // Last season's minutes do not follow him into the new one, like his ratings and his stats
    for (const s of Object.values(g.squad)) expect(s.recentMinutes).toEqual([])
    // The academy signs prospects
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    beginSeason(g, u)
    const intake = g.youthIntake
    if (intake?.candidates.length) {
      const { signYouth } = await import('../logic/youth')
      expect(signYouth(g, u, intake.candidates[0]).ok).toBe(true)
      expect(g.contracts[intake.candidates[0]].status).toBe('prospect')
    }
  })

  it('keeps an older save working: no statuses and no minutes read as rotation with nothing recorded', () => {
    const g = newGame(u, { seed: 'status-old' })
    for (const c of Object.values(g.contracts)) delete c.status
    for (const s of Object.values(g.squad)) delete s.recentMinutes
    const id = Object.keys(g.squad)[0]
    expect(statusOf(g, id)).toBe('rotation')
    expect(recentShare(g.squad[id])).toBeNull()
    playMatchweek(g, u, true)
    expect(g.season!.matchweek).toBe(1)
    for (const s of Object.values(g.squad)) expect(s.recentMinutes!.length).toBe(1)
  })

  it('flow: twenty auto-managed weeks keep the squad about as happy as the bench-drift rule did', () => {
    const means: number[] = []
    for (const seed of MORALE_SEEDS) {
      const g = newGame(u, { mode: 'season', seed })
      for (let i = 0; i < 20; i++) playMatchweek(g, u, true)
      const morale = Object.values(g.squad).map((s) => s.morale)
      means.push(morale.reduce((a, b) => a + b, 0) / morale.length)
      for (const id of Object.keys(g.squad)) {
        expect(g.contracts[id].status).toBeDefined()
        expect(g.squad[id].recentMinutes!.length).toBe(RECENT_WEEKS)
      }
    }
    const mean = means.reduce((a, b) => a + b, 0) / means.length
    console.log(`mean morale after 20 weeks: ${means.map((m) => m.toFixed(1)).join(', ')} (average ${mean.toFixed(2)}, before statuses ${MORALE_BEFORE_STATUSES})`)
    expect(Math.abs(mean - MORALE_BEFORE_STATUSES)).toBeLessThanOrEqual(5)
  })
})
