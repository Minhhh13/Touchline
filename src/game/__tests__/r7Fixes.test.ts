/**
 * Regression tests for the bugs the second QA hunt (r7, on the engine 6 release candidate) fixed (docs/QA.md, round 2).
 * Each names the bug it pins.
 */
import { describe, expect, it, vi } from 'vitest'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
vi.setConfig({ testTimeout: 60_000 })
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { BUDGET_FLOOR, QUICK_RULES, canBench, canSpin, capRoom, capSpent, eligibleSlots, isComplete, openSlots, spinClubSeason } from '@engine/draft'
import { wheelSeasons } from '@engine/era'
import { useStore } from '../store'
import { setupRules, shortNameFor } from '../logic/setup'
import { kickoffStep } from '../logic/endCase'
import { quickManagerOptions } from '../logic/managers'
import { playbackResults, quickChangeProblem, quickSquadAt } from '../logic/quick'
import { CHANGES_CLOSED_NOTE, JANUARY_REDRAWN_NOTE, januaryStale, quickSeasonStale } from '../logic/quickSeam'
import { wheelHasRoom } from '../logic/wheelCheck'
import type { GameSettings } from '../types'
import { Chooser, loadStore } from './qaHarness'
import { withCap } from '../logic/cap'

const u = loadTestUniverse(['england'])
const st = () => useStore.getState()

/** A Quick Draft as Setup sends it, with a bench of three and the January window as asked; the assistant drafts. */
function quickGame(seed: string, january: boolean): void {
  loadStore(u, ['england'])
  const stops = wheelSeasons(u, ['england'], false)
  const rules = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: true, leagues: ['england'], benchPicks: 3, modes: [], powerUps: false, classic: false, managers: false })
  const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2025).map((cs) => cs.clubId)
  const settings: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'R7 XI', shortName: shortNameFor('R7 XI'), leagueId: 'england', wheelLeagues: ['england'], hostClubId: clubs[0], leagueSeason: 2025, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january }
  st().startGame(settings)
  st().autoDraftRest()
  st().finishDraft()
  for (let i = 0; i < 10 && st().game!.phase === 'kickoff'; i++) {
    const g = st().game!
    const k = kickoffStep(g)
    if (k === 'managers') st().pickManager(quickManagerOptions(g)[0].id)
    else if (k === 'case') {
      if (!g.endCase?.opened) st().openCase()
      else st().finishCase()
    } else st().kickOff(false)
  }
}

/** The games on show as an earlier engine would have played them: one score moved (what an engine release does to a save). */
function playedByEarlierEngine(): void {
  useStore.setState((s) => {
    const g = JSON.parse(JSON.stringify(s.game))
    const games = g.phase === 'january' ? g.quickJanuary.firstHalf : g.quickResult.results
    games[0].gf += 1
    return { game: g }
  })
}

describe('R7-1: a quick season kicked off on an earlier engine', () => {
  it('a window this engine drew reads as its own, and closes as before', () => {
    quickGame('r7-seam-native', true)
    const g = st().game!
    expect(g.phase).toBe('january')
    expect(januaryStale(g, u)).toBe(false)
    st().closeJanuary(0)
    expect(st().toast).toBeNull()
    expect(st().game!.phase).toBe('summary')
    expect(quickSeasonStale(st().game!, u)).toBe(false)
  })

  it('a January window an earlier engine drew is drawn again with the reason, before a deal or a pass replays it', () => {
    for (const choice of [0, null] as const) {
      quickGame('r7-seam-jan', true)
      const fresh = st().game!.quickJanuary!.firstHalf
      playedByEarlierEngine()
      expect(januaryStale(st().game!, u)).toBe(true)
      // The deal of the old window was "not on offer" and blamed on the league data; a pass rewrote the first half silently
      st().closeJanuary(choice)
      expect(st().toast).toBe(JANUARY_REDRAWN_NOTE)
      expect(st().game!.phase).toBe('january')
      expect(st().game!.quickJanuary!.firstHalf).toEqual(fresh)
      // Drawn on this engine, it closes as any window does
      useStore.setState({ toast: null })
      st().closeJanuary(choice)
      expect(st().toast).toBeNull()
      expect(st().game!.phase).toBe('summary')
    }
  })

  it('a bench change in January redraws an old window first', () => {
    quickGame('r7-seam-jan-bench', true)
    playedByEarlierEngine()
    const g = st().game!
    const results = playbackResults(g)
    const revealed = results.length - 1
    const view = quickSquadAt(g, u, results, revealed)
    const slot = Object.keys(view.lineup).find((s) => view.bench.some((id) => !quickChangeProblem(g, u, results, revealed, { slotId: s, inId: id })))!
    const inId = view.bench.find((id) => !quickChangeProblem(g, u, results, revealed, { slotId: slot, inId: id }))!
    st().benchChange(revealed, slot, inId)
    expect(st().toast).toBe(JANUARY_REDRAWN_NOTE)
    expect(st().game!.quickChanges ?? []).toEqual([])
    expect(januaryStale(st().game!, u)).toBe(false)
  })

  it('a bench change on a season an earlier engine played is refused, the games on show kept', () => {
    quickGame('r7-seam-bench', false)
    const g0 = st().game!
    expect(g0.quickOpen).toBe(true)
    playedByEarlierEngine()
    const g = st().game!
    const shown = JSON.stringify(g.quickResult!.results)
    const results = playbackResults(g)
    const revealed = 5
    const view = quickSquadAt(g, u, results, revealed)
    const slot = Object.keys(view.lineup).find((s) => view.bench.some((id) => !quickChangeProblem(g, u, results, revealed, { slotId: s, inId: id })))!
    const inId = view.bench.find((id) => !quickChangeProblem(g, u, results, revealed, { slotId: slot, inId: id }))!
    st().benchChange(revealed, slot, inId)
    expect(st().toast).toBe(CHANGES_CLOSED_NOTE)
    expect(JSON.stringify(st().game!.quickResult!.results)).toBe(shown)
    expect(st().game!.quickChanges ?? []).toEqual([])
    // The same change on the season as this engine played it goes through
    quickGame('r7-seam-bench', false)
    st().benchChange(revealed, slot, inId)
    expect(st().toast).toBeNull()
    expect(st().game!.quickChanges).toHaveLength(1)
  })
})

describe('R7-3: Setup never opens a draft on an empty wheel', () => {
  const nl = loadTestUniverse(['england', 'netherlands'])
  const rulesFor = (leagues: string[], modes: Array<'legends' | 'underdog'>, from: number, to: number) => {
    const stops = wheelSeasons(nl, leagues, false)
    return setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: from, eraTo: to, first: stops[0], last: stops[stops.length - 1], twists: true, leagues, benchPicks: 0, modes, powerUps: false, classic: false })
  }

  it('Legends with the Eredivisie alone from 2020-21 admits no side: the draft it started could not spin once', () => {
    const rules = rulesFor(['netherlands'], ['legends'], 2020, 2026)
    expect(wheelHasRoom(nl, rules, '4-3-3')).toBe(false)
    useStore.setState({ universe: nl, loadedLeagues: ['england', 'netherlands'], game: null, toast: null })
    st().startGame({ mode: 'quick', seed: 'r7-empty', formationId: '4-3-3', teamName: 'R7', shortName: 'R7', leagueId: 'netherlands', wheelLeagues: ['netherlands'], hostClubId: nl.clubSeasons.find((cs) => cs.leagueId === 'netherlands' && cs.season === 2025)!.clubId, leagueSeason: 2025, rules, jobSecurity: false, difficulty: 'calibrated', continental: false })
    expect(canSpin(nl, st().game!.draft!)).toBe(false)
  })

  it('a wheel with sides on it is never refused: the default setup, Legends in England, Underdog in the Eredivisie', () => {
    const stops = wheelSeasons(nl, ['england'], false)
    expect(wheelHasRoom(nl, rulesFor(['england'], [], stops[0], stops[stops.length - 1]), '4-3-3')).toBe(true)
    expect(wheelHasRoom(nl, rulesFor(['england'], ['legends'], 2008, 2009), '4-4-2')).toBe(true)
    expect(wheelHasRoom(nl, rulesFor(['netherlands'], ['underdog'], 2020, 2020), '3-5-2')).toBe(true)
    // Legends in the Eredivisie holds sides only in 2010-11, 2018-19 and 2019-20 (2010, 2018 and 2019 in the packs)
    expect(wheelHasRoom(nl, rulesFor(['netherlands'], ['legends'], 2018, 2018), '4-3-3')).toBe(true)
  })
})

describe('R7-4: a capped Quick Draft with a bench never strands its XI', () => {
  /** A drafter who benches early: a random usable man into a random place, the bench taken whenever it is offered 40% of the time. */
  function draftBenchingEarly(seed: string, preset: 'shoestring' | 'moneyball', bench: number): { stranded: boolean; owedOk: boolean } {
    const ch = new Chooser(seed)
    loadStore(u, ['england'])
    const stops = wheelSeasons(u, ['england'], false)
    const rules = withCap(setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: stops[0], eraTo: stops[stops.length - 1], first: stops[0], last: stops[stops.length - 1], twists: true, leagues: ['england'], benchPicks: bench, modes: [], powerUps: false, classic: false, managers: false }), { preset, custom: 180 })
    const clubs = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2025).map((cs) => cs.clubId)
    st().startGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'R7 Cap', shortName: 'R7C', leagueId: 'england', wheelLeagues: ['england'], hostClubId: clubs[0], leagueSeason: 2025, rules, jobSecurity: false, difficulty: 'calibrated', continental: false, january: false })
    let owedOk = true
    for (let k = 0; k < 120; k++) {
      const d = st().game!.draft!
      // The money left always covers the floor for every open XI slot
      if (d.rules.budget! - capSpent(d) < BUDGET_FLOOR * openSlots(d).length - 1e-9) owedOk = false
      if (isComplete(d) || !openSlots(d).length) break
      if (!d.current) {
        if (!canSpin(u, d)) return { stranded: true, owedOk }
        st().spin()
        continue
      }
      const cs = spinClubSeason(u, d)!
      const opts: Array<[string, string]> = []
      for (const p of cs.squad) {
        for (const sl of eligibleSlots(d, p)) opts.push([p.id, sl.id])
        if (canBench(d, p)) opts.push([p.id, 'bench'])
      }
      if (!opts.length) {
        st().respin()
        if (st().game!.draft!.current === d.current) st().autoDraftRest()
        continue
      }
      const benched = opts.filter((o) => o[1] === 'bench')
      const o = benched.length && ch.chance(0.4) ? ch.pick(benched) : ch.pick(opts)
      st().pickPlayer(o[0], o[1])
      expect(st().toast ?? '').not.toMatch(/Something went wrong/)
      useStore.setState({ toast: null })
    }
    return { stranded: false, owedOk }
  }

  it('the drafts that ran dry with XI slots open (a keeper unaffordable) now fill their XI', () => {
    // Each of these ran dry on release-e6 with XI slots open and no money left for them (a keeper unaffordable)
    for (const [seed, preset, bench] of [['r7-strand-6', 'shoestring', 3], ['r7-strand-9', 'shoestring', 5], ['r7-strand-18', 'moneyball', 5], ['r7-strand-20', 'shoestring', 3], ['r7-strand-21', 'shoestring', 5]] as const) {
      const r = draftBenchingEarly(seed, preset, bench)
      expect(r, seed).toEqual({ stranded: false, owedOk: true })
    }
  })

  it('a bench pick while XI slots are open keeps the floor for every one of them; an XI pick for the others', () => {
    for (let i = 0; i < 12; i++) {
      const r = draftBenchingEarly(`r7-cap-floor-${i}`, i % 2 ? 'moneyball' : 'shoestring', i % 3 ? 5 : 3)
      expect(r.stranded).toBe(false)
      expect(r.owedOk).toBe(true)
    }
    const d = st().game!.draft!
    // What the cap chip shows: the money left after the floor for the open XI slots after this one
    if (openSlots(d).length) expect(capRoom(d)).toBeCloseTo(d.rules.budget! - capSpent(d) - BUDGET_FLOOR * (openSlots(d).length - 1), 5)
  })
})
