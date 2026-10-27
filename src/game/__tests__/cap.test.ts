import { describe, expect, it, vi } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, canSpin, canUse, capFits, capForSquad, capPrice, eligibleSlots, fillingXI, isComplete, newDraft, pick, QUICK_RULES, SEASON_RULES, spin } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { ACHIEVEMENTS } from '@engine/awards'
import { beginSeason, createGame, summariseSetup } from '../logic/setup'
import { runQuickSeason } from '../logic/quick'
import { startSeasonProper, playMatchweek } from '../logic/week'
import { advanceToNextSeason } from '../logic/dynasty'
import { capBudget, capTotal, capFooter, capLine, capOfGame, capXI, DEFAULT_CAP_CHOICE, earnsMoneyball, withCap, CAP_PRESETS, type CapChoice } from '../logic/cap'
import { shareCardFooter } from '../logic/modes'
import { filterBoard } from '../logic/cabinet'
import { normaliseGame } from '../logic/save'
import { arenaShareInput, beginArena, cupGameSettings, gauntletGameSettings, GAUNTLET_SQUAD, simArenaToEnd, summariseArena, type ArenaChoices } from '../logic/arena'
import type { Game, GameSettings, LeaderboardEntry } from '../types'
// The store persists through localStorage; an in-memory stand-in keeps the persist middleware quiet in Node
vi.hoisted(() => {
  const mem = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
    configurable: true,
  })
})
import { useStore } from '../store'

const u = loadTestUniverse()

function settings(partial: Partial<GameSettings> = {}): GameSettings {
  return {
    mode: 'quick',
    seed: 'CAP-1',
    formationId: '4-3-3',
    teamName: 'Money XI',
    shortName: 'MXI',
    leagueId: 'england',
    wheelLeagues: ['england'],
    hostClubId: 'burnley',
    leagueSeason: 2025,
    rules: { ...QUICK_RULES, leagues: ['england'], budget: 180 },
    jobSecurity: false,
    difficulty: 'calibrated',
    ...partial,
  }
}

function drafted(partial: Partial<GameSettings> = {}): Game {
  const g = createGame(settings(partial))
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

const arenaChoices = (seed: string, partial: Partial<ArenaChoices> = {}): ArenaChoices => ({ teamName: 'Cap XI', formationId: '4-3-3', field: 'wheel', wheelLeagues: ['england'], difficulty: 'calibrated', seed, hardMode: false, twists: true, ...partial })

describe('the salary cap: presets and lines', () => {
  it('scales the presets by squad size and reads Off as no cap', () => {
    expect(CAP_PRESETS.map((p) => p.xi)).toEqual([undefined, 120, 180, 250, undefined])
    expect(capBudget({ preset: 'off', custom: 180 }, 11)).toBeUndefined()
    expect(capBudget({ preset: 'moneyball', custom: 0 }, 11)).toBe(180)
    expect(capBudget({ preset: 'moneyball', custom: 0 }, 16)).toBe(252)
    expect(capBudget({ preset: 'moneyball', custom: 0 }, 18)).toBe(281)
    expect(capBudget({ preset: 'shoestring', custom: 0 }, 11)).toBe(120)
    expect(capBudget({ preset: 'big-spender', custom: 0 }, 14)).toBe(310)
    // Custom: £50M to £600M in £10M steps
    expect(capXI({ preset: 'custom', custom: 20 })).toBe(50)
    expect(capXI({ preset: 'custom', custom: 9999 })).toBe(600)
    expect(capXI({ preset: 'custom', custom: 144 })).toBe(140)
    expect([capTotal(0), capTotal(50), capTotal(52.5), capTotal(178.4), capTotal(281)]).toEqual(['£0M', '£50M', '£52.5M', '£178M', '£281M'])
  })

  it('never pairs the cap with one club or one nation, whose thin pools strand a frugal-last draft short of an XI', () => {
    const base = { ...QUICK_RULES, leagues: ['england'] }
    const moneyball: CapChoice = { preset: 'moneyball', custom: 180 }
    expect(withCap(base, moneyball).budget).toBe(180)
    expect(withCap({ ...base, squadSize: 18 }, moneyball).budget).toBe(281)
    expect(withCap(base, DEFAULT_CAP_CHOICE).budget).toBeUndefined()
    expect(withCap({ ...base, onlyNation: 'BRA' }, moneyball).budget).toBeUndefined()
    expect(withCap({ ...base, onlyClub: 'burnley' }, moneyball).budget).toBeUndefined()
    expect([capFits({ budget: 180 }), capFits({ onlyNation: 'BRA' }), capFits({ budget: 180, onlyNation: 'BRA' }), capFits({ budget: 180, onlyClub: 'burnley' })]).toEqual([true, true, false, false])
    // Why: Brazilians in England on £120M, the dearest affordable man on every spin. The £0.5M floor keeps money
    // back for every pick, but the nation has nobody that cheap in some positions, so the wheel runs dry mid-XI
    let stranded = 0
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-3-3'), { ...base, onlyNation: 'BRA', budget: 120 })
      const rng = new Rng(`cap-nation-${i}`)
      while (!isComplete(d) && canSpin(u, d)) {
        const usable = spin(u, d, rng).squad.filter((p) => canUse(d, p)).sort((a, b) => capPrice(b) - capPrice(a))
        if (!usable.length) d.current = null
        else pick(u, d, usable[0].id, eligibleSlots(d, usable[0])[0]?.id ?? 'bench')
      }
      if (!isComplete(d) && fillingXI(d)) stranded++
    }
    expect(stranded).toBeGreaterThan(0)
  }, 30000)

  it('a capped quick season says what it spent, per point, on the summary, the card and the setup line', () => {
    const g = drafted()
    runQuickSeason(g, u)
    const cap = capOfGame(g)!
    expect(cap.budget).toBe(180)
    expect(cap.spent).toBe(g.draft!.spent)
    expect(cap.spent).toBeLessThanOrEqual(180)
    const pts = g.quickResult!.points
    expect(capLine(g, pts)).toBe(`💰 £${Math.round(cap.spent)}M of a £180M cap · ${(pts / cap.spent).toFixed(2)} pts per £M`)
    expect(shareCardFooter(g)).toBe('Seed CAP-1 · £180M cap')
    expect(summariseSetup(u, g.settings)).toContain('cap £180M')
    // Without a cap, nothing changes
    const plain = drafted({ rules: { ...QUICK_RULES, leagues: ['england'] } })
    expect(capOfGame(plain)).toBeNull()
    expect(capLine(plain, 50)).toBeNull()
    expect(capFooter(plain)).toBe('')
    expect(shareCardFooter(plain)).toBe('Seed CAP-1')
    expect(summariseSetup(u, plain.settings)).not.toContain('cap')
  })

  it('Bargain Hunters: a title on a cap of £150M or less for an XI, a bigger squad read back to its XI', () => {
    expect(ACHIEVEMENTS.some((a) => a.id === 'moneyball')).toBe(true)
    const game = (budget: number | undefined, squadSize = 11, mode: GameSettings['mode'] = 'quick', year = 1) => ({ year, settings: { mode, rules: { budget, squadSize } } })
    expect(earnsMoneyball(game(150))).toBe(true)
    expect(earnsMoneyball(game(120))).toBe(true)
    expect(earnsMoneyball(game(180))).toBe(false)
    expect(earnsMoneyball(game(undefined))).toBe(false)
    expect(earnsMoneyball(game(capForSquad(150, 18), 18, 'season'))).toBe(true)
    expect(earnsMoneyball(game(capForSquad(160, 18), 18, 'season'))).toBe(false)
    // A Dynasty's later years are not drafted under the cap
    expect(earnsMoneyball(game(120, 18, 'dynasty', 2))).toBe(false)
  })

  it('the quick season unlocks it on a cheap title and only then', () => {
    // Seeds found by sweeping 100 (re-swept on main's Quick Draft defaults when main merged in, and again on ENGINE_VERSION
    // '5': titles on £120M at 35 and 60, on £150M at 8, nine on £180M; and on '6': on £120M at 47, on £150M at 6, on £180M
    // at 13, 35 and 99): a title on £120M and on £150M, one on £180M (too dear), and a £150M season that missed it
    const run = (seed: string, budget: number) => {
      const g = drafted({ seed, rules: { ...QUICK_RULES, leagues: ['england'], budget } })
      runQuickSeason(g, u)
      return g
    }
    for (const [seed, budget, unlocks] of [['cap-measure-47', 120, true], ['cap-measure-6', 150, true], ['cap-measure-13', 180, false], ['cap-measure-0', 150, false]] as const) {
      const g = run(seed, budget)
      expect(g.quickResult!.position === 1, seed).toBe(seed !== 'cap-measure-0')
      expect(g.unlocked.includes('moneyball'), seed).toBe(unlocks)
      expect(g.unlocked.includes('champions'), seed).toBe(g.quickResult!.position === 1)
    }
  }, 60000)
})

describe('the salary cap in a managed season', () => {
  it('binds the first draft only: the spend outlives it, and the Dynasty summer draft has no cap', () => {
    const budget = capForSquad(180, 18)
    const g = drafted({ mode: 'dynasty', seed: 'cap-dynasty', leagueSeason: 2015, hostClubId: 'leicester-city', rules: { ...SEASON_RULES, leagues: ['england'], budget } })
    expect(isComplete(g.draft!)).toBe(true)
    const spent = g.draft!.spent!
    expect(spent).toBeLessThanOrEqual(budget)
    beginSeason(g, u)
    expect(g.draft).toBeNull()
    expect(g.capSpent).toBe(spent)
    expect(capOfGame(g)).toEqual({ budget, spent })
    startSeasonProper(g)
    while (g.phase !== 'summary') playMatchweek(g, u, true)
    expect(capLine(g, g.history.at(-1)!.points)).toContain(`of a £${budget}M cap`)
    advanceToNextSeason(g, u)
    expect(g.phase).toBe('draft')
    expect(g.draft!.rules.budget).toBeUndefined()
    expect(g.settings.rules.budget).toBe(budget)
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    expect(g.draft!.spent).toBeUndefined()
    beginSeason(g, u)
    // Year two is the market's: the cap no longer reads on the summary or the card
    expect(capOfGame(g)).toBeNull()
    expect(shareCardFooter(g)).toBe('Seed cap-dynasty')
  }, 120000)

  it('files the cap and the spend on the Record page, and Best on a budget sorts by points, then the smaller spend', () => {
    useStore.setState({ universe: u, loadedLeagues: ['england'], game: null, parked: {} })
    const g = drafted({ seed: 'cap-record' })
    runQuickSeason(g, u)
    useStore.setState({ game: g })
    useStore.getState().recordResult()
    const e = useStore.getState().profile.leaderboard.find((x) => x.seed === 'cap-record')!
    expect(e.budget).toBe(180)
    expect(e.spent).toBe(g.draft!.spent)
    const entry = (id: string, points: number, budget?: number, spent?: number): LeaderboardEntry => ({ id, date: '2026-10-25', mode: 'quick', teamName: id, points, won: 0, drawn: 0, lost: 0, position: 1, tier: 'MID_TABLE', seed: id, leagueSeason: 2025, hostClubId: 'burnley', xi: [], ...(budget !== undefined ? { budget, spent } : {}) })
    const board = [entry('a', 80), entry('b', 70, 180, 175), entry('c', 70, 180, 150), entry('d', 75, 120, 119)]
    expect(filterBoard(board, 'budget').map((x) => x.id)).toEqual(['d', 'c', 'b'])
    useStore.setState({ universe: null, loadedLeagues: [], game: null })
  })

  it('an older save, from before the cap, reads as uncapped', () => {
    const g = drafted({ rules: { ...QUICK_RULES, leagues: ['england'] } })
    runQuickSeason(g, u)
    const old = JSON.parse(JSON.stringify(g)) as Game
    delete (old.draft as unknown as Record<string, unknown>).spent
    delete (old as unknown as Record<string, unknown>).capSpent
    const n = normaliseGame(old)!
    expect(n.settings.rules.budget).toBeUndefined()
    expect(capOfGame(n)).toBeNull()
    expect(capLine(n, 60)).toBeNull()
  })
})

describe('the salary cap in the arena', () => {
  it('scales the cap to the arena squads and names it on the setup line', () => {
    const cup = cupGameSettings(u, arenaChoices('cap-cup', { capXI: 180 }), 'CXI')
    expect(cup.rules.squadSize).toBe(16)
    expect(cup.rules.budget).toBe(252)
    expect(summariseArena(u, cup)).toContain('cap £252M')
    const gauntlet = gauntletGameSettings(u, arenaChoices('cap-g', { capXI: 180 }), 'CXI')
    expect(gauntlet.rules.squadSize).toBe(GAUNTLET_SQUAD)
    expect(gauntlet.rules.budget).toBe(capForSquad(180, GAUNTLET_SQUAD))
    expect(gauntletGameSettings(u, arenaChoices('cap-g'), 'CXI').rules.budget).toBeUndefined()
    expect(cupGameSettings(u, arenaChoices('cap-cup'), 'CXI').rules.budget).toBeUndefined()
  })

  it('a Gauntlet bonus spin brings its share of the cap, and the run never spends more than the cap', () => {
    let bonus = 0
    for (let i = 0; i < 12 && bonus < 2; i++) {
      const g = createGame(gauntletGameSettings(u, arenaChoices(`cap-climb-${i}`, { capXI: 120 }), 'CXI'))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      g.rngState = rng.getState()
      beginArena(g, u)
      simArenaToEnd(g, u)
      const d = g.draft!
      expect(d.spent!).toBeLessThanOrEqual(d.rules.budget!)
      if (d.rules.squadSize > GAUNTLET_SQUAD) {
        bonus++
        expect(d.rules.budget).toBe(capForSquad(120, d.rules.squadSize))
        expect(isComplete(d)).toBe(true)
      } else expect(d.rules.budget).toBe(capForSquad(120, GAUNTLET_SQUAD))
      // The share text closes on the money line, no points rate in the arena
      const input = arenaShareInput(g, u)!
      expect(input.lines?.at(-1)).toBe(`💰 ${capTotal(d.spent!)} of a £${d.rules.budget}M cap`)
    }
    expect(bonus).toBeGreaterThan(0)
  }, 240000)
})
