import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { beginMatch, pairingExpectation } from '@engine/match'
import { USER_TEAM } from '@engine/season'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { quickUserInput, quickXI, runQuickSeason, toKickoff } from '../logic/quick'
import { barFill, chanceLabel, emptyTally, ODDS_STEP, oddsFrom, oddsKey, oddsLeague, oddsRng, preSeasonOdds, sampleSeasons, squadBreakdown } from '../logic/odds'
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

  it('give the same odds worked out a step at a time as in one go', () => {
    const g = drafted('odds-2')
    const league = oddsLeague(g, u)
    const whole = oddsFrom(sampleSeasons(league, oddsRng(g), ODDS_STEP * 3, emptyTally(league.ids.length)))
    const rng = oddsRng(g)
    const t = emptyTally(league.ids.length)
    for (let i = 0; i < 3; i++) sampleSeasons(league, rng, ODDS_STEP, t)
    expect(oddsFrom(t)).toEqual(whole)
  })

  it('add up: every season lands in one place, the chances nest and the projection sits inside the table', () => {
    for (const seed of ['odds-3', 'odds-4', 'odds-5']) {
      const o = preSeasonOdds(drafted(seed), u, 400)
      expect(o.teams).toBe(20)
      expect(o.finishes.reduce((x, y) => x + y, 0)).toBe(400)
      expect(o.title).toBeLessThanOrEqual(o.top4)
      expect(o.top4).toBeLessThanOrEqual(o.top6)
      expect(o.top6).toBeLessThanOrEqual(o.top10)
      expect(o.top10 + o.relegation).toBeLessThanOrEqual(1)
      expect(o.projectedFinish).toBeGreaterThanOrEqual(1)
      expect(o.projectedFinish).toBeLessThanOrEqual(20)
      expect(o.expectedPoints).toBeGreaterThan(0)
      expect(o.expectedPoints).toBeLessThanOrEqual(114)
    }
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
