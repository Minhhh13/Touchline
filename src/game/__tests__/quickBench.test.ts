import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, benchPlaces, benchRoom, canCloseBench, closeBench, eligibleSlots, fillingXI, isComplete, pick, QUICK_RULES, spin, type DraftRules } from '@engine/draft'
import { decodeChallenge, encodeChallenge, isRulesDiff, replayDraft } from '@engine/challenge'
import { closeJanuary, closeQuickSeason, kickOff, makeQuickChange, playbackResults, quickChangeProblem, quickSquadAt, runQuickSeason, toKickoff } from '../logic/quick'
import { applyChange, canPlayFor, changesLine, fieldXI, injuredThrough, QUICK_CHANGES } from '../logic/quickBench'
import type { QuickGameResult } from '../types'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { createGame, describeRules, setupRules } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import { playerLookup } from '../logic/players'
import { getFormation } from '@engine/formations'
import type { Game, GameSettings } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse(['england'])

function settings(partial: Partial<GameSettings> = {}, rules: Partial<DraftRules> = {}): GameSettings {
  return { mode: 'quick', seed: 'bench-1', formationId: '4-3-3', teamName: 'Bench XI', shortName: 'BEN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A quick game drafted by the assistant (the bench filled when it has places) and standing at the tactics step. */
function drafted(partial: Partial<GameSettings> = {}, rules: Partial<DraftRules> = {}): Game {
  const g = createGame(settings(partial, rules))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  expect(isComplete(g.draft!)).toBe(true)
  toKickoff(g, u)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game

/** Draft the XI by hand, the first player who fits an open slot on each spin, and stop at eleven. */
function handXI(partial: Partial<GameSettings>, rules: Partial<DraftRules> = {}): Game {
  const g = createGame(settings(partial, rules))
  const d = g.draft!
  const rng = Rng.fromState(g.rngState)
  while (fillingXI(d)) {
    const cs = spin(u, d, rng)
    const p = cs.squad.find((x) => eligibleSlots(d, x).length)!
    pick(u, d, p.id, eligibleSlots(d, p)[0].id)
  }
  g.rngState = rng.getState()
  return g
}
const SEEDS = ['bench-1', 'bench-2', 'bench-3', 'bench-4']
/** A change the rules allow before game `at + 1`: a fit bench player and a slot he can play (`slot` when given and possible). */
function legal(g: Game, results: QuickGameResult[], at: number, slot?: string): { slotId: string; inId: string } {
  const v = quickSquadAt(g, u, results, at)
  const get = playerLookup(g, u)
  const can = canPlayFor(g)
  const slots = getFormation(g.tactics.formationId).slots.filter((s) => v.lineup[s.id] && (!slot || s.id === slot))
  for (const s of slots) for (const id of v.bench) if (!v.out.includes(id) && can(get(id)!, s.position)) return { slotId: s.id, inId: id }
  throw new Error(`no legal change before game ${at + 1}`)
}

/** A game's results with the bench notes stripped, to compare with a season played without a bench. */
const bare = (g: Game) => (g.quickResult?.results ?? []).map(({ injuries: _i, covers: _c, ...r }) => r)

describe('drafting a Quick Draft bench', { timeout: 120_000 }, () => {
  it('leaves the XI and the game’s stream as without a bench: bench spins draw from their own stream', () => {
    for (const seed of SEEDS) {
      const plain = drafted({ seed })
      const benched = drafted({ seed }, { benchPicks: 5 })
      expect(benched.draft!.bench).toHaveLength(5)
      expect(benched.draft!.lineup).toEqual(plain.draft!.lineup)
      expect(benched.draft!.history.slice(0, plain.draft!.history.length)).toEqual(plain.draft!.history)
      // The season starts from the very state the XI left: the five bench spins drew nothing from it
      expect(benched.rngState).toEqual(plain.rngState)
      expect(benched.draft!.benchRng).toBeDefined()
    }
  })

  it('sends any pick to the bench while it has room, and only then', () => {
    const g = createGame(settings({ seed: 'bench-pick' }, { benchPicks: 2 }))
    const d = g.draft!
    const rng = Rng.fromState(g.rngState)
    for (let n = 0; n < 3; n++) {
      const cs = spin(u, d, rng)
      const p = cs.squad.find((x) => !d.takenPlayers.includes(x.playerId))!
      if (n < 2) {
        expect(benchRoom(d)).toBe(true)
        pick(u, d, p.id, 'bench')
      } else {
        // The bench is full, so the pick goes into the XI
        expect(benchRoom(d)).toBe(false)
        expect(() => pick(u, d, p.id, 'bench')).toThrow(/bench is full/)
      }
    }
    expect(d.bench).toHaveLength(2)
    expect(fillingXI(d)).toBe(true)
    // Without bench places a pick still waits for the XI
    const plain = createGame(settings({ seed: 'bench-pick' })).draft!
    const cs = spin(u, plain, Rng.fromState(createGame(settings({ seed: 'bench-pick' })).rngState))
    expect(() => pick(u, plain, cs.squad[0].id, 'bench')).toThrow(/starting XI first/)
    // Position First fills the slot it chose while the XI is open
    const pf = createGame(settings({ seed: 'bench-pf' }, { benchPicks: 3, draftMode: 'position' })).draft!
    expect(benchRoom(pf)).toBe(false)
  })

  it('may stop once the XI is full, a spin still showing logged as skipped, and a link replays the short draft', () => {
    const g2 = handXI({ seed: 'bench-close' }, { benchPicks: 4 })
    const d2 = g2.draft!
    const rng2 = Rng.fromState(g2.rngState)
    expect(canCloseBench(d2)).toBe(true)
    expect(isComplete(d2)).toBe(false)
    const cs = spin(u, d2, rng2)
    pick(u, d2, cs.squad.find((x) => !d2.takenPlayers.includes(x.playerId))!.id, 'bench')
    spin(u, d2, rng2)
    closeBench(d2)
    expect(isComplete(d2)).toBe(true)
    expect(d2.bench).toHaveLength(1)
    expect(d2.history.at(-1)!.skipped).toBe(true)
    g2.rngState = rng2.getState()
    toKickoff(g2, u)
    runQuickSeason(g2, u)
    const c = challengeFromGame(g2, u, 'Bencher')!
    expect(c.s.r.benchPicks).toBe(4)
    expect(isRulesDiff({ benchPicks: 6 })).toBe(false)
    const fresh = createGame(settings({ seed: 'bench-close' }, { benchPicks: 4 }))
    replayDraft(u, fresh.draft!, Rng.fromState(fresh.rngState), decodeChallenge(encodeChallenge(c)))
    expect(fresh.draft!.bench).toEqual(d2.bench)
    expect(replayChallenge(u, decodeChallenge(encodeChallenge(c))).verified).toBe('yes')
  })

  it('reads the bench places from the setup and names them on a fixed wheel', () => {
    const base = { difficulty: 'normal' as const, showRatings: true, draftMode: 'squad' as const, ratings: 'season' as const, eraFrom: 2008, eraTo: 2026, first: 2008, last: 2026, twists: true, leagues: ['england'] }
    expect(setupRules(QUICK_RULES, base).benchPicks).toBeUndefined()
    const r = setupRules(QUICK_RULES, { ...base, benchPicks: 3 })
    expect(benchPlaces(r)).toBe(3)
    expect(describeRules(u, r)).toContain('Bench of 3')
    expect(benchPlaces({ ...QUICK_RULES, benchPicks: 9 })).toBe(5)
  })
})

describe('the bench in the quick season', { timeout: 300_000 }, () => {
  it('with nobody on the bench, plays the very season a draft without bench places plays', () => {
    const plain = handXI({ seed: 'bench-1' })
    const g = handXI({ seed: 'bench-1' }, { benchPicks: 5 })
    expect(g.draft!.history).toEqual(plain.draft!.history)
    closeBench(g.draft!)
    for (const x of [g, plain]) {
      toKickoff(x, u)
      kickOff(x, u)
    }
    expect(g.quickOpen).toBeUndefined()
    expect(g.quickResult).toEqual(plain.quickResult)
  })

  it('draws the same as a season without a bench up to the first game an injured starter is covered', () => {
    let covered = 0
    for (const seed of SEEDS) {
      const plain = drafted({ seed })
      const benched = drafted({ seed }, { benchPicks: 5 })
      kickOff(plain, u)
      kickOff(benched, u)
      const games = benched.quickResult!.results!
      const first = games.findIndex((r) => r.covers?.length)
      const upTo = first < 0 ? games.length : first
      expect(bare(benched).slice(0, upTo)).toEqual(bare(plain).slice(0, upTo))
      if (first < 0) expect(benched.quickResult!.points).toBe(plain.quickResult!.points)
      covered += games.filter((r) => r.covers?.length).length
    }
    expect(covered).toBeGreaterThan(0)
  })

  it('covers an injured starter from the bench for the games he misses, without using a change', () => {
    for (const seed of SEEDS) {
      const g = drafted({ seed }, { benchPicks: 5 })
      kickOff(g, u)
      const games = g.quickResult!.results!
      const bench = g.draft!.bench
      for (let i = 0; i < games.length; i++) {
        const through = injuredThrough(games, i)
        for (const c of games[i].covers ?? []) {
          expect(bench).toContain(c.inId)
          expect(g.draft!.lineup[c.slotId]).toBe(c.outId)
          expect(through[c.outId]).toBeGreaterThanOrEqual(games[i].matchweek)
          expect((through[c.inId] ?? 0) < games[i].matchweek).toBe(true)
          const slot = getFormation(g.tactics.formationId).slots.find((s) => s.id === c.slotId)!
          expect(canPlayFor(g)(playerLookup(g, u)(c.inId)!, slot.position)).toBe(true)
        }
      }
      // The season covers exactly the games the playback panel says it will: injured in k for w weeks misses k+1 to k+w
      for (let i = 0; i < games.length; i++) expect(games[i].covers ?? []).toEqual(quickSquadAt(g, u, games, i).covers)
      expect(quickSquadAt(g, u, games, 0).changesLeft).toBe(QUICK_CHANGES)
      expect(g.quickResult!.changes).toBeUndefined()
    }
  })

  it('a change replays every game before it and sticks; three is the limit and the order is kept', () => {
    const g = drafted({ seed: 'bench-2' }, { benchPicks: 5 })
    kickOff(g, u)
    expect(g.phase).toBe('summary')
    expect(g.quickOpen).toBe(true)
    const before = clone(g)
    const games = playbackResults(g)
    const view = quickSquadAt(g, u, games, 10)
    expect(view.changesLeft).toBe(QUICK_CHANGES)
    const { slotId, inId } = legal(g, games, 10)
    makeQuickChange(g, u, games, 10, slotId, inId)
    const after = g.quickResult!.results!
    expect(after.slice(0, 10)).toEqual(before.quickResult!.results!.slice(0, 10))
    expect(g.quickChanges).toEqual([{ from: games[10].matchweek, slotId, inId }])
    expect(g.quickResult!.changes).toEqual([{ from: games[10].matchweek, slotId, inId, outId: before.draft!.lineup[slotId] }])
    // He stays in the XI and the man he replaced waits on the bench
    const later = quickSquadAt(g, u, after, 30)
    expect(later.lineup[slotId]).toBe(inId)
    expect(later.bench).toContain(before.draft!.lineup[slotId])
    expect(later.changesLeft).toBe(QUICK_CHANGES - 1)
    // Same changes, same season on any device
    const again = clone(before)
    again.quickChanges = clone(g).quickChanges
    runQuickSeason(again, u)
    expect(again.quickResult).toEqual(g.quickResult)
    // No change before the last one, and three at most
    expect(quickChangeProblem(g, u, after, 5)).toMatch(/before your last change/)
    for (const at of [15, 20]) {
      const c = legal(g, playbackResults(g), at)
      makeQuickChange(g, u, playbackResults(g), at, c.slotId, c.inId)
    }
    expect(g.quickChanges).toHaveLength(3)
    expect(quickChangeProblem(g, u, playbackResults(g), 25)).toMatch(/All 3 changes/)
    expect(() => makeQuickChange(g, u, playbackResults(g), 25, slotId, quickSquadAt(g, u, playbackResults(g), 25).bench[0])).toThrow()
    // Closed, the result stands
    closeQuickSeason(g)
    expect(quickChangeProblem(clone(before), u, games, 30)).toBeNull()
    expect(quickChangeProblem(g, u, playbackResults(g), 30)).toMatch(/closed|All 3/)
    expect(changesLine(g.quickResult!.changes, (id) => playerLookup(g, u)(id)?.name ?? id)).toMatch(/^🔁 Bench: .+ \(MW \d+\)/)
  })

  it('refuses a change that brings on an injured man or leaves the bench', () => {
    const g = drafted({ seed: 'bench-3' }, { benchPicks: 5 })
    kickOff(g, u)
    const games = playbackResults(g)
    const slotId = getFormation(g.tactics.formationId).slots[1].id
    expect(quickChangeProblem(g, u, games, 3, { slotId, inId: g.draft!.lineup[slotId] })).toMatch(/not on the bench/)
    // Nobody comes on out of position: the draft's fit rule holds for a change as for a pick
    const get = playerLookup(g, u)
    const f = getFormation(g.tactics.formationId)
    const misfit = f.slots.flatMap((s) => g.draft!.bench.filter((id) => !canPlayFor(g)(get(id)!, s.position)).map((id) => ({ slotId: s.id, inId: id })))[0]
    if (misfit) expect(quickChangeProblem(g, u, games, 3, misfit)).toMatch(/cannot play/)
    for (let i = 1; i < games.length; i++) {
      const v = quickSquadAt(g, u, games, i)
      const hurt = v.bench.find((id) => v.out.includes(id))
      if (hurt) {
        expect(quickChangeProblem(g, u, games, i, { slotId, inId: hurt })).toMatch(/injured/)
        return
      }
    }
  })

  it('in January’s first half, a change draws the window again; after it, the deal comes before the change', () => {
    const g = drafted({ seed: 'bench-4', january: true }, { benchPicks: 5 })
    kickOff(g, u)
    expect(g.phase).toBe('january')
    const first = clone(g).quickJanuary!.firstHalf
    const c1 = legal(g, first, 6)
    makeQuickChange(g, u, first, 6, c1.slotId, c1.inId)
    expect(g.phase).toBe('january')
    expect(g.quickJanuary!.firstHalf.slice(0, 6)).toEqual(first.slice(0, 6))
    expect(g.quickJanuary!.move).toBeUndefined()
    // The window itself takes no change
    expect(quickChangeProblem(g, u, g.quickJanuary!.firstHalf, g.quickJanuary!.firstHalf.length)).toMatch(/January call/)
    closeJanuary(g, u, 0)
    expect(g.phase).toBe('summary')
    const games = playbackResults(g)
    const half = g.quickJanuary!.firstHalf.length
    expect(games.slice(0, half)).toEqual(g.quickJanuary!.firstHalf)
    expect(quickChangeProblem(g, u, games, 3)).toMatch(/first half is done|before your last/)
    const deal = g.quickJanuary!.move!
    const after = quickSquadAt(g, u, games, half)
    expect(after.lineup[deal.slotId]).toBe(deal.playerSeasonId)
    const c2 = legal(g, games, half + 2)
    const outId = quickSquadAt(g, u, games, half + 2).lineup[c2.slotId]
    makeQuickChange(g, u, games, half + 2, c2.slotId, c2.inId)
    expect(g.quickResult!.changes!.at(-1)!.outId).toBe(outId)
    expect(quickSquadAt(g, u, playbackResults(g), half + 3).lineup[c2.slotId]).toBe(c2.inId)
    expect(g.quickResult!.january!.inId).toBe(deal.playerSeasonId)
  })

  it('carries the changes in a challenge link, which replays to the same claim; a forged change is caught', () => {
    const g = drafted({ seed: 'bench-1', january: true }, { benchPicks: 3 })
    kickOff(g, u)
    const c1 = legal(g, playbackResults(g), 4)
    makeQuickChange(g, u, playbackResults(g), 4, c1.slotId, c1.inId)
    closeJanuary(g, u, null)
    const games = playbackResults(g)
    const c2 = legal(g, games, 25)
    makeQuickChange(g, u, games, 25, c2.slotId, c2.inId)
    const c = decodeChallenge(encodeChallenge(challengeFromGame(g, u, 'Gaffer')!))
    expect(c.x!.s).toHaveLength(2)
    const out = replayChallenge(u, c)
    expect(out.verified).toBe('yes')
    expect(out.result!.pts).toBe(g.quickResult!.points)
    const forged = { ...c, x: { ...c.x!, s: [[30, 'gk', g.draft!.lineup.gk]] as Array<[number, string, string]> } }
    expect(replayChallenge(u, forged).verified).toBe('no')
  })

  it('keeps the result open while the playback runs and records it once when it closes', () => {
    const g = drafted({ seed: 'bench-store' }, { benchPicks: 2 })
    useStore.setState({ universe: u, game: g, loadedLeagues: ['england'], playback: null, toast: null })
    const s = useStore.getState()
    const played = s.profile.seasonsSimulated
    const boards = s.profile.leaderboard.length
    s.kickOff()
    expect(useStore.getState().game!.quickOpen).toBe(true)
    expect(useStore.getState().profile.seasonsSimulated).toBe(played)
    const games = playbackResults(useStore.getState().game!)
    const c = legal(useStore.getState().game!, games, 8)
    s.benchChange(8, c.slotId, c.inId)
    expect(useStore.getState().game!.quickChanges).toHaveLength(1)
    // A bad change is turned down with a reason, the season untouched
    s.benchChange(2, c.slotId, c.inId)
    expect(useStore.getState().toast).toMatch(/before your last change|not on the bench/)
    s.endPlayback()
    const after = useStore.getState()
    expect(after.game!.quickOpen).toBeUndefined()
    expect(after.profile.seasonsSimulated).toBe(played + 1)
    expect(after.profile.leaderboard.length).toBe(Math.min(50, boards + 1))
    useStore.setState({ game: null, universe: null, loadedLeagues: [], playback: null })
  })

  it('records an open season when the manager leaves it for a new game or abandons it', () => {
    for (const leave of ['start', 'abandon'] as const) {
      const g = drafted({ seed: `bench-leave-${leave}` }, { benchPicks: 2 })
      useStore.setState({ universe: u, game: g, loadedLeagues: ['england'], playback: null, toast: null })
      const s = useStore.getState()
      const played = s.profile.seasonsSimulated
      s.kickOff()
      expect(useStore.getState().game!.quickOpen).toBe(true)
      if (leave === 'start') useStore.getState().startGame(settings({ seed: 'bench-next' }, { benchPicks: 2 }))
      else useStore.getState().abandonGame()
      expect(useStore.getState().profile.seasonsSimulated).toBe(played + 1)
      expect(useStore.getState().profile.leaderboard.some((e) => e.id.startsWith(g.id))).toBe(true)
    }
    useStore.setState({ game: null, universe: null, loadedLeagues: [], playback: null })
  })

  it('never lists a man on the bench and in the XI when the draft closed short of a full XI', () => {
    const g = drafted({ seed: 'bench-short' }, { benchPicks: 3 })
    const d = g.draft!
    // A one-nation wheel run dry: three slots never filled, the fill takes bench players into them
    for (const slot of getFormation(g.tactics.formationId).slots.slice(8)) delete d.lineup[slot.id]
    toKickoff(g, u)
    const xi = Object.values(g.lineup)
    expect(new Set(xi).size).toBe(11)
    expect(g.bench.filter((id) => xi.includes(id))).toEqual([])
  })

  it('opens a quick save written before benches with nothing to fill in', () => {
    const g = drafted({ seed: 'bench-1' })
    kickOff(g, u)
    const n = normaliseGame(clone(g))!
    expect(n.quickChanges).toBeUndefined()
    expect(n.quickOpen).toBeUndefined()
    expect(n.draft!.benchClosed).toBeUndefined()
    expect(n.quickResult).toEqual(g.quickResult)
  })
})

describe('the bench helpers', () => {
  it('fields the best fit for an injured starter and swaps a change into the bench in his place', () => {
    const g = drafted({ seed: 'bench-1' }, { benchPicks: 3 })
    const get = playerLookup(g, u)
    const f = getFormation(g.tactics.formationId)
    const gk = g.draft!.lineup.gk
    const { lineup, covers } = fieldXI(f, g.draft!.lineup, g.draft!.bench, (id) => id === gk, get)
    expect(covers).toHaveLength(1)
    expect(lineup.gk).toBe(covers[0].inId)
    expect(g.draft!.bench).toContain(covers[0].inId)
    expect(fieldXI(f, g.draft!.lineup, [], () => true, get).lineup).toEqual(g.draft!.lineup)
    const sw = applyChange(g.draft!.lineup, g.draft!.bench, { from: 3, slotId: 'gk', inId: g.draft!.bench[1] })
    expect(sw.lineup.gk).toBe(g.draft!.bench[1])
    expect(sw.bench[1]).toBe(gk)
    expect(sw.outId).toBe(gk)
    expect(() => applyChange(g.draft!.lineup, g.draft!.bench, { from: 3, slotId: 'gk', inId: 'nobody' })).toThrow()
    expect(injuredThrough([{ matchweek: 4, opponentId: 'x', home: true, gf: 0, ga: 0, scorers: [], position: 1, injuries: [{ id: 'a', out: 3 }] }])).toEqual({ a: 7 })
  })
})
