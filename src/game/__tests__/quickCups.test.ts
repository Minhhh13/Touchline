import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { EXTRA_TIME_RATE, extraTime } from '@engine/season'
import { kickOff, toKickoff } from '../logic/quick'
import { addCupTrophies, cupLine, cupReachLabel, cupRoundLabel, cupScoreLabel, cupUnlocks, playQuickCup, QUICK_CONTINENTAL_PLACES, quickCupProblem, quickCupXI, quickCupStatus, skipQuickCup, type QuickCupComp } from '../logic/quickCups'
import { challengeFromGame, claimCupsLine, claimOf, replayChallenge } from '../logic/challenge'
import { createGame } from '../logic/setup'
import { normaliseGame } from '../logic/save'
import type { Game, GameSettings, QuickCupRun, QuickResult } from '../types'
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'
import { getFormation } from '@engine/formations'
import { canPlayFor } from '../logic/quickBench'
import { playerLookup } from '../logic/players'

const u = loadTestUniverse(['england', 'spain', 'italy', 'germany'])

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return { mode: 'quick', seed: 'cup-1', formationId: '4-3-3', teamName: 'Cup XI', shortName: 'CUP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', january: false, ...partial }
}

/** A quick game auto-drafted and its league season played. */
function played(partial: Partial<GameSettings> = {}, rules: Partial<GameSettings['rules']> = {}): Game {
  const g = createGame(settings({ ...partial, ...(Object.keys(rules).length ? { rules: { ...QUICK_RULES, leagues: ['england'], ...rules } } : {}) }))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  kickOff(g, u)
  expect(g.phase).toBe('summary')
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game
const SEEDS = ['cup-1', 'cup-2', 'cup-3', 'cup-4', 'cup-5', 'cup-6']

/** Every tie of a run follows the knockout's rules. */
function checkRun(run: QuickCupRun, comp: QuickCupComp) {
  const rounds = run.ties.map((t) => t.round)
  expect(['R16', 'QF', 'SF', 'F'].slice(0, rounds.length)).toEqual(rounds)
  expect(run.ties.slice(0, -1).every((t) => t.won)).toBe(true)
  const last = run.ties.at(-1)!
  expect(run.reached).toBe(last.won && last.round === 'F' ? 'W' : last.round)
  for (const t of run.ties) {
    const league = u.clubById[t.opponentId]?.leagueId
    if (comp === 'cup') expect(league).toBe('england')
    else expect(league).not.toBe('england')
    expect(!!t.neutral).toBe(t.round === 'F')
    // Every goal has a scorer (an opponent's own goal as OG), extra time's in minutes 91 to 120
    expect(t.scorers.length).toBe(t.gf)
    if (t.et) {
      expect(t.gf - t.et.for).toBe(t.ga - t.et.against)
      expect(t.scorers.filter((s) => s.minute > 90).length).toBeGreaterThanOrEqual(t.et.for)
    } else expect(t.gf).not.toBe(t.ga)
    if (t.pens) {
      expect(t.et).toBeDefined()
      expect(t.gf).toBe(t.ga)
      expect(t.won).toBe(t.pens.for > t.pens.against)
    } else expect(t.won).toBe(t.gf > t.ga)
  }
}

describe('the post-season cups of a Quick Draft', { timeout: 120_000 }, () => {
  it('play tie by tie to a final from a fork, never touching the league season or each other', () => {
    let topSeven = 0
    let extra = 0
    for (const seed of SEEDS) {
      const g = played({ seed })
      const league = clone(g)
      expect(quickCupStatus(g, u, 'cup').state).toBe('open')
      playQuickCup(g, u, 'cup')
      checkRun(g.quickResult!.cup!, 'cup')
      extra += g.quickResult!.cup!.ties.filter((t) => t.et).length
      // The league result and the RNG state are as they were
      const { cup, ...rest } = g.quickResult!
      expect(rest).toEqual(league.quickResult)
      expect(g.rngState).toEqual(league.rngState)
      // The same seed, the same run
      const again = clone(league)
      playQuickCup(again, u, 'cup')
      expect(again.quickResult!.cup).toEqual(cup)
      if (g.quickResult!.position > QUICK_CONTINENTAL_PLACES) {
        expect(quickCupProblem(g, u, 'continental')).toMatch(/top-7/)
        expect(() => playQuickCup(g, u, 'continental')).toThrow()
        continue
      }
      topSeven++
      playQuickCup(g, u, 'continental')
      checkRun(g.quickResult!.continentalCup!, 'continental')
      // Played first or second, either cup comes out the same
      const other = clone(league)
      playQuickCup(other, u, 'continental')
      playQuickCup(other, u, 'cup')
      expect(other.quickResult).toEqual(g.quickResult)
    }
    expect(topSeven).toBeGreaterThan(0)
    // Level ties go to extra time
    expect(extra).toBeGreaterThan(0)
  })

  it('are offered once: a cup played or skipped is not offered again, and only after a closed Quick Draft season', () => {
    const g = played({ seed: 'cup-2' })
    skipQuickCup(g, u, 'cup')
    expect(g.quickResult!.cup).toBeNull()
    expect(quickCupStatus(g, u, 'cup').state).toBe('skipped')
    expect(() => playQuickCup(g, u, 'cup')).toThrow('Skipped')
    const h = played({ seed: 'cup-2' })
    playQuickCup(h, u, 'cup')
    expect(() => playQuickCup(h, u, 'cup')).toThrow('Already played')
    expect(quickCupStatus(h, u, 'cup').state).toBe('played')
    // A season still open to bench changes, the Daily and a managed season have no post-season cups
    expect(quickCupProblem({ ...clone(played({ seed: 'cup-2' })), quickOpen: true }, u, 'cup')).toBe('Close the season first')
    const daily = clone(played({ seed: 'cup-2' }))
    daily.settings.mode = 'daily'
    expect(quickCupProblem(daily, u, 'cup')).toMatch(/Quick Draft/)
    // A season that ran the old in-league Continental Cup keeps it and is not offered a second one
    const old = clone(played({ seed: 'cup-2' }))
    old.quickResult!.europe = { ties: [], reached: 'QF' }
    expect(quickCupProblem(old, u, 'continental')).toMatch(/already had/)
  })

  it('offers the Continental Cup before the other leagues are loaded, so playing it can load them', () => {
    const one = loadTestUniverse(['england'])
    const g = createGame(settings({ seed: 'cup-1' }))
    const rng = Rng.fromState(g.rngState)
    autoDraft(one, g.draft!, rng)
    g.rngState = rng.getState()
    toKickoff(g, one)
    kickOff(g, one)
    if (g.quickResult!.position <= QUICK_CONTINENTAL_PLACES && one.available.length > one.leagues.length) {
      expect(quickCupProblem(g, one, 'continental')).toMatch(/Too few/)
      expect(quickCupStatus(g, one, 'continental').state).toBe('open')
    }
  })

  it('field a starter still injured after the league from the bench, and keep the XI without a bench', () => {
    let covered = 0
    for (const seed of SEEDS) {
      const plain = played({ seed })
      expect(quickCupXI(plain, u)).toEqual(plain.lineup)
      const g = played({ seed }, { benchPicks: 5 })
      expect(g.draft!.bench.length).toBeGreaterThan(0)
      delete g.quickOpen
      // Nobody hurt at the end: the XI as the league left it
      const results = g.quickResult!.results!
      const last = results.at(-1)!
      const fresh = clone(g)
      fresh.quickResult!.results = results.map((r) => ({ ...r, injuries: [] }))
      expect(quickCupXI(fresh, u)).toEqual(fresh.lineup)
      // A starter hurt in the last game for three more: covered by a fit bench player, who then plays the cup
      const formation = getFormation(g.tactics.formationId)
      const get = playerLookup(g, u)
      const can = canPlayFor(g)
      const slot = formation.slots.find((sl) => g.bench.some((id) => can(get(id)!, sl.position)))
      if (!slot) continue
      const hurt = g.lineup[slot.id]
      const g2 = clone(fresh)
      g2.quickResult!.results = fresh.quickResult!.results!.map((r) => (r.matchweek === last.matchweek ? { ...r, injuries: [{ id: hurt, out: 3 }] } : r))
      const xi = quickCupXI(g2, u)
      expect(Object.values(xi)).not.toContain(hurt)
      expect(g2.bench).toContain(xi[slot.id])
      expect(g2.lineup[slot.id]).toBe(hurt)
      playQuickCup(g2, u, 'cup')
      expect(g2.quickResult!.cup!.ties.flatMap((t) => t.scorers).some((sc) => sc.playerSeasonId === hurt)).toBe(false)
      covered++
    }
    expect(covered).toBeGreaterThan(0)
  })

  it('keep extra time to a third of the match rate at 85%, with two draws', () => {
    const rng = new Rng('extra-time')
    let home = 0
    let away = 0
    const n = 4000
    for (let i = 0; i < n; i++) {
      const before = Rng.fromState(rng.getState())
      const et = extraTime(rng, { home: 1.8, away: 0.9 })
      before.poisson(1.8 * EXTRA_TIME_RATE)
      before.poisson(0.9 * EXTRA_TIME_RATE)
      expect(before.getState()).toEqual(rng.getState())
      home += et.home
      away += et.away
    }
    expect(home / n).toBeGreaterThan(1.8 * EXTRA_TIME_RATE * 0.9)
    expect(home / n).toBeLessThan(1.8 * EXTRA_TIME_RATE * 1.1)
    expect(away / n).toBeLessThan(home / n)
  })

  it('word the cups for the share text and the tie scores', () => {
    expect(cupLine({ ties: [], reached: 'W' }, 'cup')).toBe('🏆 Cup winners')
    expect(cupLine({ ties: [], reached: 'SF' }, 'continental')).toBe('🌍 Continental Cup: semi-finals')
    expect(cupLine(null, 'cup')).toBeNull()
    // A run out at the first hurdle says the same round its tie heading names: the Cup's fourth round, the Continental round of 16
    expect(cupLine({ ties: [], reached: 'R16' }, 'cup')).toBe('🏆 Cup: fourth round')
    expect(cupLine({ ties: [], reached: 'R16' }, 'continental')).toBe('🌍 Continental Cup: round of 16')
    for (const comp of ['cup', 'continental'] as QuickCupComp[]) expect(cupReachLabel('R16', comp)).toBe(cupRoundLabel(comp, 'R16').toLowerCase())
    expect(cupLine(undefined, 'continental')).toBeNull()
    expect(cupScoreLabel({ gf: 2, ga: 0 })).toBe('2-0')
    expect(cupScoreLabel({ gf: 3, ga: 2, et: { for: 1, against: 0 } })).toBe('3-2 aet')
    expect(cupScoreLabel({ gf: 1, ga: 1, et: { for: 0, against: 0 }, pens: { for: 4, against: 3 } })).toBe('1-1 aet, 4-3 pens')
  })

  it('count the trophies once, with the double and the treble they complete', () => {
    const base = { position: 1 } as QuickResult
    const won: QuickCupRun = { ties: [], reached: 'W' }
    const out: QuickCupRun = { ties: [], reached: 'QF' }
    const zero = { league: 1, cup: 0, continental: 0, doubles: 0, trebles: 0 }
    const cupWon = { ...base, cup: won }
    expect(addCupTrophies(zero, base, cupWon, 'cup')).toEqual({ league: 1, cup: 1, continental: 0, doubles: 1, trebles: 0 })
    expect(addCupTrophies(zero, cupWon, cupWon, 'cup')).toEqual(zero)
    expect(addCupTrophies(zero, base, { ...base, cup: out }, 'cup')).toEqual(zero)
    expect(addCupTrophies(zero, cupWon, { ...cupWon, continentalCup: won }, 'continental')).toEqual({ league: 1, cup: 0, continental: 1, doubles: 0, trebles: 1 })
    // Not champions: a cup, no double
    expect(addCupTrophies(zero, { position: 3 } as QuickResult, { position: 3, cup: won } as QuickResult, 'cup')).toEqual({ ...zero, cup: 1 })
    expect(cupUnlocks({ ...cupWon, continentalCup: won })).toEqual(['cup', 'continental', 'double', 'treble'])
    expect(cupUnlocks({ position: 2, cup: out } as QuickResult)).toEqual([])
  })

  it('go into the challenge link, and a friend replays them to verify', () => {
    const g = played({ seed: 'cup-3' })
    playQuickCup(g, u, 'cup')
    const claim = claimOf(g)!
    expect(claim.cu).toBe(g.quickResult!.cup!.reached)
    const c = challengeFromGame(g, u, 'Cupper')!
    const decoded = decodeChallenge(encodeChallenge(c))
    expect(decoded.c.cu).toBe(claim.cu)
    expect(replayChallenge(u, decoded).verified).toBe('yes')
    expect(claimCupsLine(decoded.c)).toMatch(/^Cup/)
    // A run claimed further than it replays is caught
    const tampered = { ...decoded, c: { ...decoded.c, cu: decoded.c.cu === 'W' ? ('R16' as const) : ('W' as const) } }
    expect(replayChallenge(u, tampered)).toMatchObject({ verified: 'no' })
    // A link without cups verifies on the league alone; a bad round is refused
    const { cu: _cu, ...leagueOnly } = decoded.c
    void _cu
    expect(replayChallenge(u, { ...decoded, c: leagueOnly }).verified).toBe('yes')
    expect(() => decodeChallenge(encodeChallenge({ ...decoded, c: { ...decoded.c, cu: 'X' as 'W' } }))).toThrow()
  })

  it('keep a saved season without them readable, and on offer', () => {
    const g = played({ seed: 'cup-4' })
    const saved = clone(g)
    delete saved.quickResult!.cup
    delete saved.quickResult!.continentalCup
    const n = normaliseGame(saved)!
    expect(n.quickResult!.cup).toBeUndefined()
    expect(quickCupStatus(n, u, 'cup').state).toBe('open')
  })

  it('count a won cup in the trophy cabinet and the achievements through the store', async () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const g = played({ seed })
      useStore.setState({ universe: u, game: g, loadedLeagues: ['england', 'spain', 'italy', 'germany'], playback: null, profile: { ...useStore.getState().profile, trophies: { league: 0, cup: 0, continental: 0, doubles: 0, trebles: 0 }, achievements: {} } })
      expect(await useStore.getState().playCup('cup')).toBe(true)
      const after = useStore.getState()
      const run = after.game!.quickResult!.cup!
      expect(after.profile.trophies!.cup).toBe(run.reached === 'W' ? 1 : 0)
      expect(!!after.profile.achievements.cup).toBe(run.reached === 'W')
      // A second go is refused with a toast and changes nothing
      expect(await useStore.getState().playCup('cup')).toBe(false)
      expect(useStore.getState().profile.trophies!.cup).toBe(run.reached === 'W' ? 1 : 0)
      useStore.getState().skipCup('continental')
    }
  })
})
