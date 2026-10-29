import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { beginMatch, pairingExpectation, softCeiling, XG_CEILING, XG_KNEE } from '@engine/match'
import { USER_TEAM } from '@engine/season'
import { createGame } from '../logic/setup'
import { aiTeamInput, humansOf } from '@engine/season'
import { quickLeague } from '../logic/superLeague'
import { playerLookup } from '../logic/players'
import { quickUserInput, quickXI, runQuickSeason, toKickoff } from '../logic/quick'
import { barFill, chanceLabel, emptyTally, matchDayXg, ODDS_STEP, oddsFrom, oddsKey, oddsLeague, oddsLeagueSteps, oddsRng, preSeasonOdds, ODDS_PAIRING_STEP, sampleSeasons, squadBreakdown } from '../logic/odds'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function drafted(seed: string, partial: Partial<GameSettings> = {}): Game {
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Odds XI', shortName: 'ODD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated', ...partial })
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return g
}

const clone = (g: Game): Game => JSON.parse(JSON.stringify(g)) as Game

describe('pre-season odds', { timeout: 120_000 }, () => {
  it('are the same every time for the same squad and never move the game', () => {
    const g = drafted('odds-1')
    const before = clone(g)
    const a = preSeasonOdds(g, u, 300)
    const b = preSeasonOdds(clone(g), u, 300)
    expect(a).toEqual(b)
    expect(g).toEqual(before)
  })

  it('build the league a step at a time exactly as in one go, the pairings as the engine sums them (r13)', () => {
    for (const seed of ['odds-steps-1', 'odds-steps-2', 'odds-steps-3']) {
      const g = drafted(seed)
      const before = clone(g)
      const steps = oddsLeagueSteps(g, u)
      let pauses = 0
      let r = steps.next()
      while (!r.done) {
        pauses++
        r = steps.next()
      }
      // The league as the old one-call build made it, written out here
      const get = playerLookup(g, u)
      const { lineup, bench } = quickXI(g, u)
      const { ai, offset } = quickLeague(u, g.settings, humansOf([...Object.values(lineup), ...bench], get))
      const ids = [USER_TEAM, ...Object.keys(ai)]
      const inputs = ids.map((id) => (id === USER_TEAM ? quickUserInput(g, lineup, bench, g.tactics, g.captainId, get) : aiTeamInput(u, ai[id], offset)))
      const pairings = []
      for (let h = 0; h < ids.length; h++) for (let a = 0; a < ids.length; a++) if (h !== a) pairings.push({ home: h, away: a, ...pairingExpectation(inputs[h], inputs[a]) })
      expect(r.value).toEqual({ ids, pairings })
      expect(oddsLeague(g, u)).toEqual(r.value)
      expect(pauses).toBeGreaterThanOrEqual(Math.floor(pairings.length / ODDS_PAIRING_STEP))
      expect(g).toEqual(before)
    }
  })

  it('give the same odds worked out a step at a time as in one go', () => {
    const g = drafted('odds-2')
    const league = oddsLeague(g, u)
    const whole = oddsFrom(sampleSeasons(league, oddsRng(g), ODDS_STEP * 3, emptyTally(league.ids.length)))
    const rng = oddsRng(g)
    const t = emptyTally(league.ids.length)
    for (let i = 0; i < 3; i++) sampleSeasons(league, rng, ODDS_STEP, t)
    expect(oddsFrom(t)).toEqual(whole)
  })

  it('give the same odds over any split of the seasons (the screen samples time-budgeted slices of a few seasons)', () => {
    const g = drafted('odds-2b')
    const league = oddsLeague(g, u)
    const n = ODDS_STEP + 37
    const whole = oddsFrom(sampleSeasons(league, oddsRng(g), n, emptyTally(league.ids.length)))
    const rng = oddsRng(g)
    const t = emptyTally(league.ids.length)
    const sizes = [1, 5, 7, 2, 13, 5, 5, 1, 30]
    for (let i = 0; t.seasons < n; i++) sampleSeasons(league, rng, Math.min(sizes[i % sizes.length], n - t.seasons), t)
    expect(t.seasons).toBe(n)
    expect(oddsFrom(t)).toEqual(whole)
  })

  it('add up: every season lands in one place, the chances nest and the projection sits inside the table', () => {
    for (const seed of ['odds-3', 'odds-4', 'odds-5']) {
      const o = preSeasonOdds(drafted(seed), u, 400)
      expect(o.teams).toBe(20)
      expect(o.finishes.reduce((x, y) => x + y, 0)).toBe(400)
      expect(o.title).toBeLessThanOrEqual(o.top4)
      // The 38-0 chase: a perfect season is an unbeaten one, and an unbeaten one is not always a title
      expect(o.perfect).toBeLessThanOrEqual(o.unbeaten)
      expect(o.perfect).toBeLessThanOrEqual(o.title)
      expect(o.top4).toBeLessThanOrEqual(o.top6)
      expect(o.top6).toBeLessThanOrEqual(o.top10)
      expect(o.top10 + o.relegation).toBeLessThanOrEqual(1)
      expect(o.projectedFinish).toBeGreaterThanOrEqual(1)
      expect(o.projectedFinish).toBeLessThanOrEqual(20)
      expect(o.expectedPoints).toBeGreaterThan(0)
      expect(o.expectedPoints).toBeLessThanOrEqual(114)
    }
  })

  it('put a side that wins every game top and a side that loses every game down, in the right place of the tally', () => {
    const ids = [USER_TEAM, 'a', 'b', 'c', 'd', 'e']
    const league = (lamUser: number, lamOther: number) => {
      const pairings = []
      for (let h = 0; h < ids.length; h++)
        for (let a = 0; a < ids.length; a++) {
          if (h === a) continue
          const lam = (i: number) => (i === 0 ? lamUser : lamOther)
          pairings.push({ home: h, away: a, lamH: lam(h), lamA: lam(a), sigmaH: 0.06, sigmaA: 0.06 })
        }
      return { ids, pairings }
    }
    const strong = oddsFrom(sampleSeasons(league(5.8, 0.12), new Rng('odds-strong'), 200, emptyTally(ids.length)))
    expect(strong.title).toBeGreaterThan(0.99)
    // Under the engine's soft ceiling (about 4.6 goals expected at most) a 0-goal day still happens: ten wins in ten
    // are about 85%, as the engine plays them (the old clamp at 5.8 said over 90%)
    expect(strong.perfect).toBeGreaterThan(0.8)
    expect(strong.unbeaten).toBeGreaterThanOrEqual(strong.perfect)
    expect(strong.projectedFinish).toBe(1)
    expect(strong.relegation).toBe(0)
    expect(strong.expectedPoints).toBeGreaterThan(28)
    const weak = oddsFrom(sampleSeasons(league(0.12, 5.8), new Rng('odds-weak'), 200, emptyTally(ids.length)))
    expect(weak.finishes[ids.length - 1]).toBeGreaterThan(190)
    expect(weak.projectedFinish).toBe(ids.length)
    expect(weak.relegation).toBeGreaterThan(0.99)
    expect(weak.top4).toBeLessThan(0.01)
    expect(weak.expectedPoints).toBeLessThan(2)
  })

  it('match the engine: a pairing is the expected goals beginMatch works out before its match-day variance', () => {
    const g = drafted('odds-6')
    const league = oddsLeague(g, u)
    const p = league.pairings[0]
    expect(league.ids[p.home]).toBe(USER_TEAM)
    expect(p.lamH).toBeGreaterThan(0.12)
    expect(p.sigmaH).toBeGreaterThanOrEqual(0.06)
    expect(p.sigmaH).toBeLessThanOrEqual(0.18)
    // The XI against itself: only home advantage (1.12 against 0.9) separates the two sides
    const { lineup, bench } = quickXI(g, u)
    const side = quickUserInput(g, lineup, bench, g.tactics, g.captainId, playerLookup(g, u))
    const self = pairingExpectation(side, side)
    expect(self.lamH / self.lamA).toBeCloseTo(1.12 / 0.9, 5)
    // The engine multiplies the same figures by each side's variance, centred on 1
    let sum = 0
    for (let i = 0; i < 60; i++) {
      const mp = beginMatch({ rng: new Rng(`odds-mp-${i}`), home: side, away: side, detail: 'summary' })
      sum += mp.lamH / self.lamH
    }
    expect(sum / 60).toBeGreaterThan(0.95)
    expect(sum / 60).toBeLessThan(1.06)
  })

  it("bend a big day's expected goals under the engine's soft ceiling, never the old 5.8 clamp (r8 audit)", () => {
    const rng = new Rng('odds-ceiling')
    for (const lam of [0.5, 1.4, 2.9, 3.4, 4.0, 4.5]) {
      for (let i = 0; i < 400; i++) {
        const g = rng.gaussian(0, 0.18)
        const x = matchDayXg(lam, g)
        expect(x).toBeLessThan(XG_CEILING)
        expect(x).toBeGreaterThanOrEqual(0.12)
        // Below the knee the engine's figure exactly: the pairing's times the variance
        if (lam * Math.exp(g) <= XG_KNEE) expect(x).toBeCloseTo(lam * Math.exp(g), 12)
        else expect(x).toBe(softCeiling(lam * Math.exp(g)))
      }
    }
    // A dominant pairing still wins almost every time under the ceiling
    const league = { ids: ['a', 'b'], pairings: [{ home: 0, away: 1, lamH: 4.5, lamA: 0.12, sigmaH: 0.18, sigmaA: 0.06 }] }
    const t = sampleSeasons(league, new Rng('odds-ceiling-season'), 20000, emptyTally(2))
    expect(t.seasons).toBe(20000)
    expect(t.perfect / t.seasons).toBeGreaterThan(0.9)
  })

  it('track the real season: over many seeds the expected points sit close to the points the engine plays out', () => {
    let real = 0
    let expected = 0
    const seeds = ['cal-1', 'cal-2', 'cal-3', 'cal-4', 'cal-5', 'cal-6']
    for (const seed of seeds) {
      const g = drafted(seed)
      expected += preSeasonOdds(g, u, 600).expectedPoints
      const c = clone(g)
      runQuickSeason(c, u)
      real += c.quickResult!.points
    }
    expect(Math.abs(real - expected) / seeds.length).toBeLessThan(8)
  })

  it('make a stronger league side a worse bet: the same XI is rated lower under realistic AI', () => {
    const calibrated = preSeasonOdds(drafted('odds-7'), u, 400)
    const realistic = preSeasonOdds(drafted('odds-7', { difficulty: 'realistic' }), u, 400)
    expect(realistic.expectedPoints).toBeLessThanOrEqual(calibrated.expectedPoints)
  })

  it('key on what they depend on: the tactics change the key, the same game keeps it', () => {
    const g = drafted('odds-8')
    expect(oddsKey(clone(g))).toBe(oddsKey(g))
    const h = clone(g)
    h.tactics.mentality = h.tactics.mentality === 'attacking' ? 'defensive' : 'attacking'
    expect(oddsKey(h)).not.toBe(oddsKey(g))
    // Another game, or other draft rules, never shares a cached answer
    expect(oddsKey({ ...clone(g), id: `${g.id}-other` })).not.toBe(oddsKey(g))
    const r = clone(g)
    r.settings.rules = { ...r.settings.rules, leagues: ['england', 'spain'] }
    expect(oddsKey(r)).not.toBe(oddsKey(g))
  })

  it('break the squad down into units with bars and print chances plainly', () => {
    const b = squadBreakdown(drafted('odds-9'), u)
    for (const v of [b.overall, b.attack, b.midfield, b.defence, b.goalkeeping]) {
      expect(v).toBeGreaterThan(40)
      expect(v).toBeLessThan(100)
    }
    expect(barFill(50)).toBe(0)
    expect(barFill(95)).toBe(1)
    expect(barFill(72.5)).toBeCloseTo(0.5)
    expect(chanceLabel(0)).toBe('0%')
    expect(chanceLabel(1)).toBe('100%')
    expect(chanceLabel(0.0004)).toBe('<0.1%')
    expect(chanceLabel(0.526)).toBe('52.6%')
    expect(chanceLabel(0.039)).toBe('3.9%')
  })
})
