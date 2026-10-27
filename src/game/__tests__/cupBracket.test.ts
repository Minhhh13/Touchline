import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { cupRounds, roundsFor, USER_TEAM } from '@engine/season'
import { kickOff, toKickoff } from '../logic/quick'
import { creditCupRun, playQuickCup, quickCupProblem, wonCup, type QuickCupComp } from '../logic/quickCups'
import { arenaBracketView, bracketScore, buildBracket, inTie, quickCupBracket, revealCount, revealSteps, seasonCupBracket, tieAtStep, treeOrder, userRoute, type BracketTie, type BracketView } from '../logic/bracket'
import { creditGame, emptyCabinet, fileHonour, HONOURS_CAP, honourDetail, honourEntry, honourLabel, honourLine, honourOf, normaliseCabinet } from '../logic/cabinet'
import { createGame } from '../logic/setup'
import { playMatchweek } from '../logic/week'
import { seasonGame } from './seasonGame'
import { compactGame } from '../logic/compact'
import type { Cabinet, Game, GameSettings, HonourEntry, QuickCupRun, QuickResult } from '../types'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const LEAGUES = ['england', 'spain', 'italy', 'germany', 'france']
const u = loadTestUniverse(LEAGUES)

function settings(seed: string, partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Cup XI', shortName: 'CUP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A Quick Draft auto-drafted and its league season played, the cups still on offer. */
function played(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(seed, partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  return g
}

function playCups(g: Game): void {
  for (const c of ['cup', 'continental'] as const) if (!quickCupProblem(g, u, c)) playQuickCup(g, u, c)
}

const strip = (r: QuickCupRun | null | undefined) => (r ? { ties: r.ties, reached: r.reached } : r)

/**
 * The runs, the achievements and the RNG state of sixteen seeded seasons' cups as they were on main at 238b040,
 * before the bracket was kept: recording every tie and playing the field on after the user goes out moves none of it.
 * Re-baselined on ENGINE_VERSION '5' (the seasons before the cups moved with the playtest fixes) and '6' (the
 * calibration and the user's men out of the field's squads) and '7' (the Continental Cup's groups and two legs: every
 * continental run moved; the domestic cup's, and the seeds with no Continental Cup, bracket-4 and bracket-16, held).
 */
const BEFORE_THE_BRACKET: Record<string, string> = {
  'bracket-1': 'f4cdecf2734290a5',
  'bracket-2': '2e9bcff4e84569bc',
  'bracket-3': '2956d5a6f9988ea2',
  'bracket-4': 'b4ceebf526703ac8',
  'bracket-5': '3553bdd005995272',
  'bracket-6': 'b60f0e895d01af13',
  'bracket-7': 'cb7c9fcabe0ade92',
  'bracket-8': '9be71d8e43315ca6',
  'bracket-9': '9a84e72dcda33d88',
  'bracket-10': 'e3a559a41b1fec16',
  'bracket-11': 'e9ac48c19eaa8ee3',
  'bracket-12': 'd64dc6ad7aa4aea9',
  'bracket-13': '3828733066297096',
  'bracket-14': 'c0de68511ab11ceb',
  'bracket-15': '6d43ed2d6665c980',
  'bracket-16': '6f5055001f7e0d73',
}

/** Every structural rule a full sixteen-club bracket keeps. */
function checkTree(view: BracketView, run: QuickCupRun) {
  expect(view.pathOnly).toBeUndefined()
  // Engine 7's Continental Cup starts its bracket at the quarter-finals, after the groups
  const sizes = run.groups ? [4, 2, 1] : [8, 4, 2, 1]
  expect(view.rounds.map((r) => r.ties.length)).toEqual(sizes)
  expect(view.rounds.map((r) => r.slots)).toEqual(sizes)
  // Every entrant of the first round different, the user among them unless out in the groups
  const first = view.rounds[0].ties.flatMap((t) => [t.home, t.away])
  expect(new Set(first).size).toBe(sizes[0] * 2)
  expect(first.includes(USER_TEAM)).toBe(run.reached !== 'G')
  for (let r = 0; r < view.rounds.length; r++) {
    for (const t of view.rounds[r].ties) {
      expect([t.home, t.away]).toContain(t.winner)
      if (t.pens) {
        expect(t.et).toBe(true)
        expect(t.hg).toBe(t.ag)
        expect(t.winner).toBe(t.pens.home > t.pens.away ? t.home : t.away)
      } else expect(t.winner).toBe(t.hg! > t.ag! ? t.home : t.away)
    }
    // Tree order: ties 2k and 2k+1 feed tie k of the next round, the earlier one's winner at home in the drawing
    if (r < view.rounds.length - 1)
      view.rounds[r + 1].ties.forEach((next, k) => {
        expect([next.home, next.away].sort()).toEqual([view.rounds[r].ties[2 * k].winner, view.rounds[r].ties[2 * k + 1].winner].sort())
      })
  }
  expect(view.champion).toBe(view.rounds.at(-1)!.ties[0].winner)
  expect(view.champion === USER_TEAM).toBe(run.reached === 'W')
  // The user's route is his run: the same opponents and scores, round by round, and nothing after he went out
  const route = userRoute(view)
  run.ties.forEach((mine, r) => {
    const t = view.rounds[r].ties[route[r]!]
    expect(inTie(t, mine.opponentId)).toBe(true)
    expect(t.home === USER_TEAM ? [t.hg, t.ag] : [t.ag, t.hg]).toEqual([mine.gf, mine.ga])
    expect(t.winner === USER_TEAM).toBe(mine.won)
    expect(!!t.et).toBe(!!mine.et)
  })
  expect(route.slice(run.ties.length).every((i) => i === null)).toBe(true)
}

describe('the post-season cups kept as a bracket', { timeout: 300_000 }, () => {
  it('move no run, achievement or RNG state: the same results as before the bracket', () => {
    const got: Record<string, string> = {}
    for (const seed of Object.keys(BEFORE_THE_BRACKET)) {
      const g = played(seed)
      playCups(g)
      const q = g.quickResult!
      got[seed] = createHash('sha256').update(JSON.stringify([strip(q.cup), strip(q.continentalCup), g.unlocked, g.rngState])).digest('hex').slice(0, 16)
    }
    expect(got).toEqual(BEFORE_THE_BRACKET)
  })

  it('keep every tie of every round to the final, in tree order, the user’s route matching his run', () => {
    let out = 0
    let won = 0
    // Engine 7: bracket-2 wins the cup and bracket-13 the Continental Cup; 1 and 3 go out
    for (const seed of ['bracket-1', 'bracket-2', 'bracket-3', 'bracket-13']) {
      const g = played(seed)
      playCups(g)
      for (const comp of ['cup', 'continental'] as QuickCupComp[]) {
        const run = comp === 'cup' ? g.quickResult!.cup : g.quickResult!.continentalCup
        if (!run) continue
        expect(run.bracket!.map((r) => r.length)).toEqual(comp === 'continental' ? [4, 2, 1] : [8, 4, 2, 1])
        checkTree(quickCupBracket(run, comp), run)
        if (run.reached === 'W') won++
        else out++
        // JSON-safe and replayed alike
        expect(JSON.parse(JSON.stringify(run))).toEqual(run)
      }
    }
    // Both a run that went out (the field played on to a champion) and a winning one
    expect(out).toBeGreaterThan(0)
    expect(won).toBeGreaterThan(0)
  })

  it('show a run from before the bracket as the user’s path alone', () => {
    const g = played('bracket-3')
    playCups(g)
    const run = { ...g.quickResult!.cup! }
    delete run.bracket
    const view = quickCupBracket(run, 'cup')
    expect(view.pathOnly).toBe(true)
    expect(view.rounds.map((r) => r.ties.length)).toEqual(['R16', 'QF', 'SF', 'F'].map((r) => (run.ties.some((t) => t.round === r) ? 1 : 0)))
    expect(view.champion).toBe(run.reached === 'W' ? USER_TEAM : undefined)
    expect(view.rounds[0].name).toBe('Fourth round')
    run.ties.forEach((t, r) => {
      const b = view.rounds[r].ties[0]
      expect(b.winner === USER_TEAM).toBe(t.won)
      expect(b.home === USER_TEAM).toBe(t.home)
    })
  })
})

describe('the bracket view', () => {
  const tie = (home: string, away: string, hg?: number, ag?: number, winner?: string): BracketTie => ({ home, away, ...(hg !== undefined ? { hg, ag } : {}), ...(winner ? { winner } : {}) })

  it('puts each round in tree order back from the last round drawn, keeping a round whose next is not drawn', () => {
    const r0 = [tie('a', 'b', 1, 0, 'a'), tie('c', 'd', 0, 2, 'd'), tie('e', 'f', 3, 1, 'e'), tie('g', 'h', 0, 1, 'h')]
    const r1 = [tie('h', 'a', 2, 1, 'h'), tie('d', 'e')]
    const ordered = treeOrder([r0, r1, []])
    expect(ordered[0].map((t) => t.winner)).toEqual(['h', 'a', 'd', 'e'])
    expect(ordered[1]).toEqual(r1)
    // Ties are reordered, never copied
    expect(ordered[0][0]).toBe(r0[3])
    // Only the first round drawn: as drawn
    expect(treeOrder([r0, [], []])[0]).toEqual(r0)
    const view = buildBracket(['QF', 'SF', 'Final'], [r0, r1], (r) => `after ${r}`)
    expect(view.rounds.map((r) => r.slots)).toEqual([4, 2, 1])
    expect(view.rounds[2].pending).toBe('after 2')
    expect(view.rounds[1].pending).toBeUndefined()
    expect(view.champion).toBeUndefined()
  })

  it('reveals round by round, the user’s tie first in its round, each tie once', () => {
    const g = played('bracket-8')
    playCups(g)
    const view = quickCupBracket(g.quickResult!.cup!, 'cup')
    const steps = revealSteps(view)
    const total = revealCount(view)
    expect(total).toBe(15)
    expect(steps.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i))
    const route = userRoute(view)
    let start = 0
    view.rounds.forEach((r, ri) => {
      const mine = route[ri]
      if (mine !== null) expect(steps[ri][mine]).toBe(start)
      expect(Math.min(...steps[ri])).toBe(start)
      start += r.ties.length
    })
    expect(tieAtStep(steps, 0)).toEqual({ round: 0, tie: route[0] })
    expect(tieAtStep(steps, 15)).toBeNull()
  })

  it('prints scores with extra time and penalties', () => {
    expect(bracketScore({ home: 'a', away: 'b' })).toBe('v')
    expect(bracketScore({ home: 'a', away: 'b', hg: 2, ag: 1 })).toBe('2-1')
    expect(bracketScore({ home: 'a', away: 'b', hg: 3, ag: 2, et: true })).toBe('3-2 aet')
    expect(bracketScore({ home: 'a', away: 'b', hg: 1, ag: 1, et: true, pens: { home: 4, away: 3 } })).toBe('1-1 (4-3 pens)')
  })

  it('draws an arena Cup with its rounds still to come', () => {
    const view = arenaBracketView(8, [[tie('user', 'x@2010', 2, 0, 'user'), tie('y@2011', 'z@2012', 1, 1, 'z@2012'), tie('p@2013', 'q@2014', 0, 1, 'q@2014'), tie('r@2015', 's@2016', 3, 0, 'r@2015')]])
    expect(view.rounds.map((r) => r.name)).toEqual(['Quarter-final', 'Semi-final', 'Cup final'])
    expect(view.rounds.map((r) => r.slots)).toEqual([4, 2, 1])
    expect(view.rounds[1].pending).toBe('Drawn after the quarter-final')
  })

  it('draws a Season’s Cup from its ties, compacted or not, to its winner', { timeout: 300_000 }, () => {
    const eng = loadTestUniverse(['england'])
    const g = seasonGame(eng, 'season-bracket')
    // The first rounds drawn, the rest to come
    const early = seasonCupBracket(g.season!.cup, cupRounds(g.season!.matchweeks))
    expect(early.rounds[0].ties.length).toBe(8)
    expect(early.rounds[1].pending).toMatch(/^Drawn after matchweek \d+$/)
    while (g.phase !== 'summary' && g.season!.matchweek < g.season!.matchweeks) {
      playMatchweek(g, eng, true)
      if (g.phase === 'match') g.phase = 'week'
    }
    const view = seasonCupBracket(g.season!.cup, roundsFor('cup', g.season!.matchweeks))
    expect(view.rounds.map((r) => r.ties.length)).toEqual([8, 4, 2, 1])
    expect(view.champion).toBe(g.season!.cup.find((t) => t.round === 'F')!.winnerId)
    expect(view.champion === USER_TEAM).toBe(g.season!.cupWon)
    for (let r = 0; r < 3; r++)
      view.rounds[r + 1].ties.forEach((next, k) => expect([next.home, next.away].sort()).toEqual([view.rounds[r].ties[2 * k].winner, view.rounds[r].ties[2 * k + 1].winner].sort()))
    // A saved (compacted) season keeps every score, shoot-out and winner the bracket reads
    expect(seasonCupBracket(compactGame(g).season!.cup, roundsFor('cup', g.season!.matchweeks))).toEqual(view)
  })
})

describe('the Treble and the Double', { timeout: 300_000 }, () => {
  const entry = (id: string, kind: 'treble' | 'double', cups: HonourEntry['cups'] = kind === 'treble' ? ['cup', 'continental'] : ['cup']): HonourEntry => ({ id, kind, cups, teamName: 'XI', mode: 'quick', leagueId: 'england', leagueSeason: 2025 })

  it('are the league with both cups, or with one', () => {
    expect(honourOf(true, true, true)).toBe('treble')
    expect(honourOf(true, true, false)).toBe('double')
    expect(honourOf(true, false, true)).toBe('double')
    expect(honourOf(false, true, true)).toBeNull()
    expect(honourOf(true, false, false)).toBeNull()
    expect(honourLabel('treble', ['cup', 'continental'])).toBe('The Treble')
    expect(honourLabel('double', ['cup'])).toBe('The Double')
    expect(honourLabel('double', ['continental'])).toBe('League and Continental double')
    expect(honourDetail(['cup', 'continental'])).toBe('League, Cup and Continental Cup')
    expect(honourDetail(['continental'])).toBe('League and Continental Cup')
    expect(honourLine('treble', ['cup', 'continental'])).toBe('👑 The Treble: League, Cup and Continental Cup')
    expect(honourLine('double', ['cup'])).toBe('🏆 The Double: League and Cup')
  })

  it('go on the honours board once per season, a Double turned Treble in its own place, newest first and capped', () => {
    let c: Cabinet = emptyCabinet()
    c = fileHonour(c, { ...entry('s1', 'double'), date: '2026-10-01' })
    c = fileHonour(c, entry('s2', 'double', ['continental']))
    expect(c.honours!.map((h) => h.id)).toEqual(['s2', 's1'])
    c = fileHonour(c, entry('s1', 'treble'))
    expect(c.honours!.map((h) => [h.id, h.kind])).toEqual([['s2', 'double'], ['s1', 'treble']])
    // The day the season was first filed stays
    expect(c.honours![1].date).toBe('2026-10-01')
    // Never downgraded, never filed twice
    expect(fileHonour(c, entry('s1', 'double'))).toBe(c)
    expect(fileHonour(c, entry('s1', 'treble'))).toBe(c)
    for (let i = 0; i < HONOURS_CAP + 5; i++) c = fileHonour(c, entry(`x${i}`, 'double'))
    expect(c.honours).toHaveLength(HONOURS_CAP)
    expect(c.honours![0].id).toBe(`x${HONOURS_CAP + 4}`)
  })

  it('credit a Season’s Treble with its count and its honours board entry', () => {
    const g = played('cab-shell')
    const season: Game = { ...g, quickResult: null, settings: { ...g.settings, mode: 'season' }, history: [{ year: 1, leagueId: 'england', leagueSeason: 2025, teamName: 'Treble XI', hostClubId: 'everton', position: 1, points: 90, won: 28, drawn: 6, lost: 4, goalsFor: 80, goalsAgainst: 30, tier: 'CHAMPIONS', cupWon: true, continentalWon: true }] }
    const c = creditGame(emptyCabinet(), season, { date: '2026-10-26' })
    expect(c.trebles).toBe(1)
    expect(c.doubles).toBe(1)
    expect(c.honours).toEqual([{ id: `${g.id}-${g.year}`, kind: 'treble', cups: ['cup', 'continental'], teamName: g.settings.teamName, mode: 'season', leagueId: 'england', leagueSeason: 2025, date: '2026-10-26' }])
    // A title alone, or a sacked first place, files nothing
    expect(creditGame(emptyCabinet(), { ...season, history: [{ ...season.history[0], cupWon: false, continentalWon: false }] }).honours).toEqual([])
    expect(creditGame(emptyCabinet(), { ...season, history: [{ ...season.history[0], tier: 'RELEGATED' }] }).honours).toEqual([])
  })

  it('credit a Quick Draft’s cups: the Double when the first cup is won, the Treble with the second', () => {
    const g = played('cab-shell')
    const won: QuickCupRun = { ties: [], reached: 'W' }
    const base = { ...g.quickResult!, position: 1, cup: undefined, continentalCup: undefined } as QuickResult
    const withCup: Game = { ...g, quickResult: { ...base, cup: won } }
    let c = creditCupRun(emptyCabinet(), base, withCup, 'cup', '2026-10-26')
    expect([c.cup, c.doubles, c.trebles]).toEqual([1, 1, 0])
    expect(c.honours!.map((h) => [h.kind, h.cups])).toEqual([['double', ['cup']]])
    const both: Game = { ...g, quickResult: { ...base, cup: won, continentalCup: won } }
    c = creditCupRun(c, withCup.quickResult!, both, 'continental', '2026-10-27')
    expect([c.cup, c.continental, c.doubles, c.trebles]).toEqual([1, 1, 1, 1])
    expect(c.honours!.map((h) => [h.kind, h.cups, h.date])).toEqual([['treble', ['cup', 'continental'], '2026-10-27']])
    // A cup lost, or a cup won outside first place, files no honour
    expect(creditCupRun(emptyCabinet(), base, { ...g, quickResult: { ...base, cup: { ties: [], reached: 'SF' } } }, 'cup').honours).toEqual([])
    const third = { ...base, position: 3 }
    const thirdCup = creditCupRun(emptyCabinet(), third, { ...g, quickResult: { ...third, cup: won } }, 'cup')
    expect([thirdCup.cup, thirdCup.honours]).toEqual([1, []])
  })

  it('read empty on a cabinet from before the honours board, and drop what is malformed', () => {
    const old = { ...emptyCabinet() } as Partial<Cabinet>
    delete old.honours
    expect(normaliseCabinet(old).honours).toEqual([])
    expect(normaliseCabinet({ ...old, honours: [entry('ok', 'treble'), { id: 3 } as unknown as HonourEntry, null as unknown as HonourEntry] }).honours!.map((h) => h.id)).toEqual(['ok'])
    expect(honourEntry(played('cab-shell'), { league: true, cup: false, continental: false })).toBeNull()
  })

  // treble-3 wins all three on ENGINE_VERSION '5' (found by sweeping; treble-11 did on '4')
  it('file a real Treble through the store: the cabinet, the honours board and the achievement', async () => {
    const all = loadTestUniverse(['england', 'spain', 'italy', 'germany', 'france', 'netherlands', 'portugal'])
    // A seed whose side wins the league and both cups (engine 7: treble-1; engine 6's treble-115 and engine 5's treble-3 no longer do)
    const g = createGame(settings('treble-1', { teamName: 'Treble XI', shortName: 'TRB', rules: { ...QUICK_RULES, leagues: ['england'], difficulty: 'easy' } }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(all, g.draft!, rng)
    g.rngState = rng.getState()
    toKickoff(g, all)
    kickOff(g, all)
    expect(g.quickResult!.position).toBe(1)
    useStore.setState({ universe: all, game: g, loadedLeagues: all.leagues.map((l) => l.id), playback: null, profile: { ...useStore.getState().profile, cabinet: emptyCabinet(), trophies: { league: 1, cup: 0, continental: 0, doubles: 0, trebles: 0 }, achievements: {} } })
    expect(await useStore.getState().playCup('cup')).toBe(true)
    expect(useStore.getState().profile.cabinet!.honours!.map((h) => h.kind)).toEqual(['double'])
    expect(await useStore.getState().playCup('continental')).toBe(true)
    const after = useStore.getState()
    const q = after.game!.quickResult!
    expect(wonCup(q, 'cup') && wonCup(q, 'continental')).toBe(true)
    expect(after.profile.cabinet!.trebles).toBe(1)
    expect(after.profile.trophies!.trebles).toBe(1)
    expect(after.profile.cabinet!.honours!.map((h) => [h.kind, h.teamName])).toEqual([['treble', 'Treble XI']])
    expect(after.profile.achievements.treble).toBeDefined()
    // Both brackets crown the user
    expect(quickCupBracket(q.cup!, 'cup').champion).toBe(USER_TEAM)
    expect(quickCupBracket(q.continentalCup!, 'continental').champion).toBe(USER_TEAM)
  })
})
