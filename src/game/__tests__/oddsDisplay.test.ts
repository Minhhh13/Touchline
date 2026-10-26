import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantTurn, newDraft, QUICK_RULES, type DraftRules } from '@engine/draft'
import { caseRarityOdds, CASE_RARITIES } from '@engine/endCase'
import { getFormation } from '@engine/formations'
import { apportionTenths, oddsExact, shownOdds, tenthsLabel } from '../logic/oddsDisplay'
import { tierOdds } from '../logic/tierOdds'
import { managerSpinOdds } from '../logic/managers'
import { createGame, setupRules } from '../logic/setup'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])
const LEAGUES = ['england']
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

describe('shownOdds', () => {
  it("adds up to exactly 100.0% where per-tier rounding did not (the report's 99.8% panel)", () => {
    // Shares that printed as 7.8 + 15 + 23 + 29 + 25 = 99.8 with whole numbers above 10%
    const ps = [0.0784, 0.1544, 0.2341, 0.2876, 0.2455]
    const shown = shownOdds(ps)
    expect(sum(shown.tenths)).toBe(1000)
    expect(shown.labels).toEqual(['7.8%', '15.4%', '23.4%', '28.8%', '24.6%'])
    expect(shown.exact).toBe(false)
    expect(shown.note).toBe('odds (rounded)')
  })

  it('always sums to 1000 tenths over many seeded distributions, each label within a tenth of its share (more beside tiny shares)', () => {
    for (let i = 0; i < 400; i++) {
      const rng = new Rng(`odds-${i}`)
      const n = rng.int(2, 7)
      const raw = Array.from({ length: n }, () => (rng.next() < 0.15 ? 0 : rng.next() ** 3))
      if (sum(raw) === 0) raw[0] = 1
      const total = sum(raw)
      const shown = shownOdds(raw)
      expect(sum(shown.tenths)).toBe(1000)
      // Each share under a tenth takes its unit from the largest, which may then sit that many tenths further off
      const tiny = raw.filter((p) => p > 0 && (p / total) * 1000 < 1).length
      raw.forEach((p, k) => {
        if (p === 0) expect(shown.tenths[k]).toBe(0)
        else {
          // Never 0 for a share that can come up; otherwise the largest remainder moves a share by under one tenth
          expect(shown.tenths[k]).toBeGreaterThan(0)
          if ((p / total) * 1000 >= 1) expect(Math.abs(shown.tenths[k] - (p / total) * 1000)).toBeLessThan(1 + tiny + 1e-9)
        }
      })
    }
  })

  it('gives a tiny possible share the smallest unit, taken from the largest', () => {
    const t = apportionTenths([0.0002, 0.4998, 0.5])
    expect(t).toEqual([1, 499, 500])
    expect(oddsExact([0.0002, 0.4998, 0.5])).toBe(false)
  })

  it('says exact only when the printed figures are the exact chances', () => {
    expect(shownOdds([0.25, 0.25, 0.5]).note).toBe('exact odds')
    expect(shownOdds([0.078, 0.922]).exact).toBe(true)
    expect(shownOdds([1 / 3, 1 / 3, 1 / 3]).exact).toBe(false)
    expect(sum(shownOdds([1 / 3, 1 / 3, 1 / 3]).tenths)).toBe(1000)
    expect(tenthsLabel(0)).toBe('0%')
    expect(tenthsLabel(150)).toBe('15.0%')
    expect(apportionTenths([0, 0])).toEqual([0, 0])
  })

  it("the end case's whole per cent odds are exact and print unchanged", () => {
    const odds = caseRarityOdds()
    const ps = CASE_RARITIES.map((r) => odds[r] / 100)
    const shown = shownOdds(ps)
    expect(shown.exact).toBe(true)
    expect(shown.tenths).toEqual(CASE_RARITIES.map((r) => odds[r] * 10))
  })

  it("the reel's tier odds print to exactly 100.0% on every spin of seeded drafts", () => {
    const rules: DraftRules = { ...QUICK_RULES, leagues: LEAGUES }
    for (const seed of ['tier-a', 'tier-b', 'tier-c', 'tier-d']) {
      const d = newDraft(getFormation('4-3-3'), rules, seed)
      const rng = new Rng(seed)
      for (let k = 0; k < 11; k++) {
        const odds = tierOdds(u, d, LEAGUES)
        expect(sum(shownOdds(odds.map((o) => o.p)).tenths)).toBe(1000)
        assistantTurn(u, d, rng)
      }
    }
  })

  it("the manager spin's odds print to exactly 100.0%", () => {
    const SETUP = setupRules(QUICK_RULES, { difficulty: 'normal', showRatings: true, draftMode: 'squad', ratings: 'season', eraFrom: 0, eraTo: 9999, first: 0, last: 9999, twists: true, leagues: LEAGUES, benchPicks: 5, managers: true, managerSpin: true, endCase: true })
    for (const seed of ['mgr-odds-1', 'mgr-odds-2']) {
      const s: GameSettings = { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Odds XI', shortName: 'ODD', leagueId: 'england', wheelLeagues: LEAGUES, hostClubId: 'burnley', leagueSeason: 2025, rules: SETUP, jobSecurity: false, difficulty: 'calibrated', january: false }
      const g = createGame(s)
      const odds = managerSpinOdds(u, g)
      expect(sum(shownOdds(odds.map((o) => o.p)).tenths)).toBe(1000)
    }
  })
})
