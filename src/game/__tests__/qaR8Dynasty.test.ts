/**
 * QA round 3 (r8, engine 7): the Dynasty's renewal list, no younger returns and the thin-squad cover, over long
 * Dynasties through the store. Four managers each summer: one lets every out-of-contract man go in pre-season, one
 * offers every one of them his ask, one leaves the list to the opener, and one never touches anything (every week
 * simmed by the assistant). After every step: no retired man in the squad, nobody back younger than he left, the
 * market and the summer wheel offering no such season either; at each opener's end at least two keepers and sixteen
 * men; and the save grows by a bounded amount each summer.
 */
import { describe, expect, it, vi } from 'vitest'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { SEASON_RULES } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { defaultHostClub, setupRules, shortNameFor } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { contractDemand } from '../logic/contracts'
import { ageFloors } from '../logic/departures'
import { MIN_SEASON_KEEPERS, MIN_SEASON_SQUAD, renewalList } from '../logic/dynasty'
import { encodeSave } from '../saveStorage'
import { persistedState, useStore } from '../store'
import type { Game, GameSettings } from '../types'
import { breathe, Chooser, crashToast, driveDraft, loadStore, seeds, stepHook } from './qaHarness'
import { driveSeason } from './qaSeasonHarness'

const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal']
const u = loadTestUniverse(LEAGUES)
const st = () => useStore.getState()
type Manager = 'leave' | 'renew' | 'skip' | 'auto'

function settings(seed: string, ch: Chooser, leagueId: string): GameSettings {
  const stops = wheelSeasons(u, [leagueId], false)
  const rules = setupRules({ ...SEASON_RULES, squadSize: ch.pick([16, 18]) }, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: false, leagues: [leagueId], benchPicks: 0, modes: [], powerUps: false, classic: false })
  const seasons = [...new Set(u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.complete && !cs.classic).map((cs) => cs.season))].sort()
  const leagueSeason = ch.pick(seasons.slice(0, -2))
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === leagueId && cs.season === leagueSeason).map((cs) => cs.clubId)
  return { mode: 'dynasty', seed, formationId: ch.pick(['4-3-3', '4-4-2', '3-5-2']), teamName: 'R8 Dynasty', shortName: shortNameFor('R8 Dynasty'), leagueId, wheelLeagues: [leagueId], hostClubId: defaultHostClub(u, leagueId, leagueSeason, clubs), leagueSeason, rules, jobSecurity: false, difficulty: 'calibrated', continental: ch.chance(0.5) }
}

const saveSize = () => encodeSave(JSON.stringify({ state: persistedState(st()), version: 1 })).length

/** Nobody retired, nobody back younger than he left: the squad, the window's listings and the youth intake (the summer wheel takes both through `takenPlayers` and `ageFloor`). */
function dynastyProblems(g: Game): string[] {
  const out: string[] = []
  const get = playerLookup(g, u)
  const retired = new Set(g.retiredPlayers ?? [])
  const floors = ageFloors(g) ?? {}
  const check = (id: string, where: string) => {
    const p = get(id)
    if (!p) return
    if (retired.has(p.playerId) && where !== 'squad-retiring') out.push(`${where}: ${p.name} retired but offered (${id})`)
    const floor = floors[p.playerId]
    if (floor !== undefined && p.age < floor) out.push(`${where}: ${p.name} aged ${p.age}, left at an age now ${floor} (${id})`)
  }
  for (const id of Object.keys(g.squad)) check(id, 'squad')
  for (const l of g.window?.listings ?? []) if (l.status === 'available' || l.status === 'bidding') check(l.playerSeasonId, `window ${g.window!.kind}`)
  for (const c of g.youthIntake?.candidates ?? []) check(c, 'youth')
  return out
}

function run(seed: string, manager: Manager, leagueId: string, years: number): string[] {
  const ch = new Chooser(seed)
  loadStore(u, LEAGUES)
  st().startGame(settings(seed, ch, leagueId))
  const problems: string[] = []
  const sizes: number[] = []
  const europe: boolean[] = []
  let year = 0
  let renewalsSeen = 0
  let actedOn = 0
  let openerChecked = -1
  stepHook.run = () => {
    const g = st().game
    if (!g || problems.length > 6) return
    problems.push(...dynastyProblems(g).map((x) => `y${g.year} ${g.phase} mw ${g.season?.matchweek}: ${x}`))
    if (g.year !== year && g.phase === 'preseason') {
      year = g.year
      sizes.push(saveSize())
      if (process.env.R8_SIZES) {
        const pg = (persistedState(st()) as unknown as { game: Record<string, unknown> }).game
        const parts = Object.fromEntries(Object.entries(pg).map(([k, v]) => [k, JSON.stringify(v ?? null).length]).filter(([, n]) => (n as number) > 500))
        parts.profile = JSON.stringify(persistedState(st()).profile).length
        console.log(`y${g.year} ${saveSize()} ${JSON.stringify(parts)}`)
      }
      europe.push(!!g.season?.continental)
    }
    // Pre-season with men out of contract: the manager's choice
    const list = g.phase === 'preseason' ? renewalList(g) : []
    if (list.length) renewalsSeen = Math.max(renewalsSeen, g.year)
    if (list.length && manager === 'leave') {
      for (const id of list) if (st().letContractGo(id).ok) actedOn++
    } else if (list.length && manager === 'renew') {
      for (const id of list) {
        const demand = contractDemand(g, u, id, g.contracts[id]?.status ?? 'rotation')
        if (demand && st().proposeContract(id, { wage: Math.ceil(demand.wage * 1.2), years: 2, status: g.contracts[id]?.status ?? 'rotation', signingFee: 0, appearance: 0, goal: 0 }).accepted) actedOn++
      }
    }
    // Once the opener has run (the first week after pre-season): the floor holds, nobody is still out of contract
    if (g.season && g.season.matchweek >= 1 && openerChecked !== g.year && !g.season.sacked) {
      openerChecked = g.year
      const get = playerLookup(g, u)
      const keepers = Object.keys(g.squad).filter((id) => get(id)?.positions[0] === 'GK').length
      if (keepers < MIN_SEASON_KEEPERS) problems.push(`y${g.year}: the season started with ${keepers} keepers`)
      if (Object.keys(g.squad).length < MIN_SEASON_SQUAD) problems.push(`y${g.year}: the season started with ${Object.keys(g.squad).length} men`)
      if (renewalList(g).length) problems.push(`y${g.year}: ${renewalList(g).length} still out of contract after the opener`)
    }
    if (st().toast && !crashToast()) useStore.setState({ toast: null })
  }
  const draft = (label: string) => driveDraft(u, ch, { autoAt: manager === 'auto' || ch.chance(0.6) ? 0 : undefined }).problems.map((p) => `${label}: ${p}`)
  try {
    problems.push(...draft('draft'))
    if (manager === 'auto') st().setMatchPlay('sim')
    const out = driveSeason(u, ch, { years: years - 1, draft, simBias: manager === 'auto' ? 10 : 7 })
    problems.push(...out.problems)
    if (!out.problems.length && out.seasons < years && !st().game?.season?.sacked) problems.push(`only ${out.seasons} seasons`)
  } catch (e) {
    problems.push(`threw: ${e instanceof Error ? e.stack?.split('\n').slice(0, 5).join(' | ') : String(e)}`)
  } finally {
    stepHook.run = undefined
  }
  // From the second summer on (the first adds a whole season's history to a fresh save), between summers with the
  // same Europe (fifteen foreign clubs' states come and go with qualification): about 2K a summer is R7-O3's aged
  // custom players, the rest is the season's own size, which goes with the league
  for (let k = 2; k < sizes.length; k++) if (europe[k] === europe[k - 1] && sizes[k] - sizes[k - 1] > 6000) problems.push(`the save grew by ${sizes[k] - sizes[k - 1]} characters in one summer (${sizes.map((x, i) => `${x}${europe[i] ? 'E' : ''}`).join(', ')})`)
  if (sizes.length && Math.max(...sizes) > 60_000) problems.push(`a ${years}-season Dynasty's save reached ${Math.max(...sizes)} characters`)
  if ((manager === 'leave' || manager === 'renew') && renewalsSeen > 0 && actedOn === 0) problems.push(`the ${manager} manager never acted on a renewal list`)
  return problems
}

describe('QA r8: the Dynasty renewal list, no younger returns and the thin-squad cover', () => {
  const runs: Array<[Manager, string]> = [['leave', 'england'], ['renew', 'spain'], ['skip', 'italy'], ['auto', 'germany'], ['leave', 'portugal'], ['auto', 'england'], ['renew', 'netherlands'], ['skip', 'france']]
  for (const [i, [manager, leagueId]] of runs.entries()) {
    if (i >= seeds(runs.length) + 1) continue
    it(`${manager} in ${leagueId}, seven seasons`, async () => {
      await breathe()
      expect(run(`r8-dynasty-${manager}-${leagueId}`, manager, leagueId, 7)).toEqual([])
    }, 600_000)
  }
})
