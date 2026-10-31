import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, eligibleSlots, newDraft, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { beginSeason, createGame } from '../logic/setup'
import { playMatchweek, startSeasonProper } from '../logic/week'
import { advanceToNextSeason, coverSquad, letContractGo, MIN_SEASON_KEEPERS, MIN_SEASON_SQUAD, postRenewals, renewalList, settleRenewals } from '../logic/dynasty'
import { contractDemand, proposeContract } from '../logic/contracts'
import { releasePlayer } from '../logic/marketOps'
import { ageFloors } from '../logic/departures'
import { buildYouthIntake } from '../logic/youth'
import { fileReports } from '../logic/scouting'
import { playerLookup, squadPlayers } from '../logic/players'
import { normaliseGame } from '../logic/save'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse()

function settings(seed: string, mode: GameSettings['mode'] = 'dynasty'): GameSettings {
  return { mode, seed, formationId: '4-3-3', teamName: 'Depth XI', shortName: 'DEP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'everton', leagueSeason: 2021, rules: { ...SEASON_RULES, leagues: ['england'], squadSize: 20 }, jobSecurity: false, difficulty: 'calibrated' }
}

function draftAndBegin(g: Game): void {
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  beginSeason(g, u)
  postRenewals(g, u)
}

function playOut(g: Game): void {
  startSeasonProper(g, u)
  while (g.phase !== 'summary') playMatchweek(g, u, true)
}

function firstSeason(seed: string, mode: GameSettings['mode'] = 'dynasty'): Game {
  const g = createGame(settings(seed, mode))
  draftAndBegin(g)
  playOut(g)
  return g
}

const keepers = (g: Game) => squadPlayers(g, u).filter((x) => x.p.positions[0] === 'GK').length
const humans = (g: Game) => new Set(squadPlayers(g, u).map((x) => x.p.playerId))

describe('Dynasty contracts', () => {
  it('a contract that runs out goes on the renewal list instead of renewing itself', () => {
    let listed = 0
    for (const seed of ['renew-list-1', 'renew-list-2', 'renew-list-3']) {
      const g = firstSeason(seed)
      // Two more men in their last season, so every seed has a list
      for (const id of Object.keys(g.squad).slice(0, 2)) g.contracts[id] = { ...g.contracts[id], years: 1 }
      const get = playerLookup(g, u)
      const last = Object.keys(g.squad).filter((id) => g.contracts[id].years <= 1 && !g.contracts[id].renewed && !g.contracts[id].declined && !g.contracts[id].loan).map((id) => get(id)!.playerId)
      const report = advanceToNextSeason(g, u)
      const after = playerLookup(g, u)
      for (const id of Object.keys(g.squad)) {
        const c = g.contracts[id]
        if (last.includes(after(id)!.playerId)) {
          expect(c.expired, seed).toBe(true)
          expect(c.years, seed).toBe(0)
        } else expect(c.expired, seed).toBeUndefined()
      }
      expect(report.renewals.length, seed).toBe(renewalList(g).length)
      listed += report.renewals.length
      // Pre-season's Inbox names them
      draftAndBegin(g)
      if (renewalList(g).length) expect(g.season!.news.some((n) => n.title.startsWith('Contracts up')), seed).toBe(true)
    }
    expect(listed).toBeGreaterThan(5)
  }, 120_000)

  it('terms agreed in pre-season keep him; let go, he leaves now; the opener settles the rest', () => {
    const g = firstSeason('renew-talks')
    for (const id of Object.keys(g.squad).slice(0, 4)) g.contracts[id] = { ...g.contracts[id], years: 1 }
    advanceToNextSeason(g, u)
    draftAndBegin(g)
    const list = renewalList(g)
    expect(list.length).toBeGreaterThanOrEqual(3)
    const [talk, go] = list
    const status = g.contracts[talk].status ?? 'rotation'
    g.finances.wageCap = 1e6
    const demand = contractDemand(g, u, talk, status)!
    expect(proposeContract(g, u, talk, { wage: demand.wage, years: 2, status, signingFee: 0, appearance: 0, goal: 0 }).accepted).toBe(true)
    expect(g.contracts[talk].expired).toBeUndefined()
    expect(g.contracts[talk].years).toBe(2)
    const goneId = playerLookup(g, u)(go)!.playerId
    expect(letContractGo(g, u, go).ok).toBe(true)
    expect(g.squad[go]).toBeUndefined()
    expect(g.departedPlayers?.[goneId]).toBeDefined()
    // Nobody else is out of contract after the opener, and the ones kept have a contract running
    startSeasonProper(g, u)
    expect(renewalList(g)).toEqual([])
    for (const c of Object.values(g.contracts)) expect(c.years).toBeGreaterThanOrEqual(1)
    expect(g.season!.news.some((n) => n.title === 'Contracts settled')).toBe(true)
  }, 60_000)

  it('the assistant keeps the willing men worth keeping and lets an unhappy or fringe man go', () => {
    const g = firstSeason('renew-assistant')
    const ids = Object.keys(g.squad)
    for (const id of ids) g.contracts[id] = { ...g.contracts[id], years: 1 }
    advanceToNextSeason(g, u)
    draftAndBegin(g)
    g.finances.wageCap = 1e6
    const get = playerLookup(g, u)
    const list = renewalList(g)
    const best = [...list].sort((a, b) => get(b)!.overall - get(a)!.overall)
    const unhappy = best[0]
    g.squad[unhappy].morale = 30
    const out = settleRenewals(g, u)
    expect(out.left).toContain(get(unhappy)?.name ?? '')
    // Everyone in the best 18 who was willing stays
    expect(out.renewed.length).toBeGreaterThanOrEqual(12)
    expect(renewalList(g)).toEqual([])
  }, 60_000)

  it('an unattended Dynasty keeps a squad: two keepers and sixteen men at every opener, nobody on both sides', () => {
    for (const seed of ['unattended-1', 'unattended-2']) {
      const g = firstSeason(seed)
      for (let year = 2; year <= 4; year++) {
        advanceToNextSeason(g, u)
        draftAndBegin(g)
        startSeasonProper(g, u)
        expect(Object.keys(g.squad).length, `${seed} year ${year}`).toBeGreaterThanOrEqual(MIN_SEASON_SQUAD)
        expect(keepers(g), `${seed} year ${year}`).toBeGreaterThanOrEqual(MIN_SEASON_KEEPERS)
        expect(renewalList(g)).toEqual([])
        const ours = humans(g)
        for (const club of Object.values(g.season!.ai)) for (const id of club.squad) expect(ours.has(u.index[id]?.playerId ?? ''), `${seed} ${club.clubId}`).toBe(false)
        while (g.phase !== 'summary') playMatchweek(g, u, true)
      }
    }
  }, 300_000)
})

describe('A thin Dynasty squad', () => {
  it('the opener signs cover up to two keepers and sixteen men, draw-free', () => {
    for (const seed of ['thin-1', 'thin-2', 'thin-3']) {
      const g = firstSeason(seed)
      advanceToNextSeason(g, u)
      draftAndBegin(g)
      // Strip the squad to ten outfielders and no keeper
      const get = playerLookup(g, u)
      const gk = Object.keys(g.squad).filter((id) => get(id)!.positions[0] === 'GK')
      for (const id of gk) releasePlayer(g, u, id)
      for (const id of Object.keys(g.squad).slice(10)) releasePlayer(g, u, id)
      for (const id of Object.keys(g.contracts)) delete g.contracts[id].expired
      const rng = g.rngState
      const signed = coverSquad(g, u)
      expect(g.rngState, seed).toEqual(rng)
      expect(signed.length, seed).toBe(MIN_SEASON_SQUAD - 10)
      expect(keepers(g), seed).toBe(MIN_SEASON_KEEPERS)
      expect(Object.keys(g.squad).length, seed).toBe(MIN_SEASON_SQUAD)
      const ours = humans(g)
      expect(ours.size, seed).toBe(MIN_SEASON_SQUAD)
      for (const club of Object.values(g.season!.ai)) for (const id of club.squad) expect(ours.has(u.index[id]?.playerId ?? ''), seed).toBe(false)
      // Nobody signed as cover is a younger season of a man who left
      const floors = ageFloors(g)!
      for (const x of squadPlayers(g, u)) if (floors[x.p.playerId] !== undefined) expect(x.p.age, seed).toBeGreaterThanOrEqual(floors[x.p.playerId])
      // Cover is a backup on one season
      startSeasonProper(g, u)
      while (g.phase !== 'summary') playMatchweek(g, u, true)
    }
  }, 300_000)

  it('a full squad signs nobody', () => {
    const g = firstSeason('thin-full')
    advanceToNextSeason(g, u)
    draftAndBegin(g)
    expect(coverSquad(g, u)).toEqual([])
  }, 60_000)
})

describe('A man who left never comes back younger', () => {
  it('the summer wheel, the market, the academy and the scouts skip his younger seasons', () => {
    for (const seed of ['departed-1', 'departed-2', 'departed-3']) {
      const g = firstSeason(seed)
      // Sell off half the squad at the summary: their younger selves must never come back
      const get = playerLookup(g, u)
      const gone = Object.keys(g.squad).slice(0, 10).map((id) => get(id)!)
      for (const p of gone) releasePlayer(g, u, p.id)
      for (const p of gone) expect(g.departedPlayers![p.playerId], seed).toEqual({ age: p.age, year: g.year })
      advanceToNextSeason(g, u)
      const floors = ageFloors(g)!
      for (const p of gone) expect(floors[p.playerId], seed).toBe(p.age + 1)
      expect(g.draft!.ageFloor, seed).toEqual(floors)
      const younger = (id: string) => {
        const p = u.index[id]
        return !!p && floors[p.playerId] !== undefined && p.age < floors[p.playerId]
      }
      for (const l of g.window!.listings) expect(younger(l.playerSeasonId), seed).toBe(false)
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      for (const id of [...Object.values(g.draft!.lineup), ...g.draft!.bench]) expect(younger(id), seed).toBe(false)
      beginSeason(g, u)
      for (const id of buildYouthIntake(g, u, new Rng('academy-check'))) expect(younger(id), seed).toBe(false)
      g.recruitFocus = { age: 'u24' }
      for (const r of fileReports(g, u, 'scout-check', 6)) expect(younger(r.playerSeasonId), seed).toBe(false)
    }
  }, 300_000)

  it('the draft bars only the younger seasons: his own age and older stay usable', () => {
    const d = newDraft(getFormation('4-3-3'), { ...SEASON_RULES, leagues: ['england'] })
    const p = u.clubSeasons.find((cs) => cs.leagueId === 'england' && cs.season === 2021)!.squad.find((x) => x.positions[0] === 'ST')!
    expect(eligibleSlots(d, p).length).toBeGreaterThan(0)
    d.ageFloor = { [p.playerId]: p.age + 1 }
    expect(eligibleSlots(d, p)).toEqual([])
    d.ageFloor = { [p.playerId]: p.age }
    expect(eligibleSlots(d, p).length).toBeGreaterThan(0)
  })

  it('records nothing outside a Dynasty', () => {
    const g = firstSeason('season-release', 'season')
    releasePlayer(g, u, Object.keys(g.squad)[0])
    expect(g.departedPlayers).toBeUndefined()
    expect(ageFloors(g)).toBeUndefined()
  }, 60_000)
})

describe('An engine 6 Dynasty save', () => {
  it('loads and carries on: no new field needed, contracts settle at the next opener', () => {
    const g = firstSeason('old-save')
    // An engine 6 summary: none of the new fields
    delete g.departedPlayers
    for (const c of Object.values(g.contracts)) delete c.expired
    const loaded = normaliseGame(JSON.parse(JSON.stringify(g)))!
    expect(loaded).not.toBeNull()
    advanceToNextSeason(loaded, u)
    draftAndBegin(loaded)
    startSeasonProper(loaded, u)
    expect(renewalList(loaded)).toEqual([])
    expect(Object.keys(loaded.squad).length).toBeGreaterThanOrEqual(MIN_SEASON_SQUAD)
    playMatchweek(loaded, u, true)
    expect(loaded.season!.matchweek).toBe(1)
  }, 60_000)

  it('an engine 6 pre-season save (renewed the old way) starts its season unchanged', () => {
    const g = createGame(settings('old-preseason'))
    draftAndBegin(g)
    const before = Object.keys(g.squad).sort()
    const loaded = normaliseGame(JSON.parse(JSON.stringify(g)))!
    startSeasonProper(loaded, u)
    expect(Object.keys(loaded.squad).sort()).toEqual(before)
  }, 60_000)
})
