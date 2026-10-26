import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { chemistryOf } from '@engine/ratings'
import { describeFit } from '@engine/positions'
import { toKickoff } from '../logic/quick'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { discRating } from '../logic/slotSheet'
import { squadReport, VETERAN_AGE } from '../logic/squadReport'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function atKickoff(seed: string, formationId = '4-3-3'): Game {
  const s: GameSettings = { mode: 'quick', seed, formationId, teamName: 'Report XI', shortName: 'REP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  toKickoff(g, u)
  return g
}

describe("Squad complete's scouting report", () => {
  it('names the key man and the weak link by the number on the disc, and counts age, links and the out of position', () => {
    let weakSeen = 0
    for (const seed of ['report-1', 'report-2', 'report-3', 'report-4', 'report-5', 'report-6']) {
      const g = atKickoff(seed, seed.endsWith('2') ? '4-4-2' : '4-3-3')
      const get = playerLookup(g, u)
      const f = getFormation(g.tactics.formationId)
      const before = JSON.stringify(g)
      const r = squadReport(f, g.lineup, get, false)!
      expect(JSON.stringify(g)).toBe(before)
      const men = f.slots.map((sl) => ({ sl, p: get(g.lineup[sl.id])! }))
      const disc = men.map(({ sl, p }) => discRating(p, sl.position))
      expect(r.starters).toBe(11)
      expect(r.key!.rating).toBe(Math.max(...disc))
      // The first of the best in the formation's order
      expect(r.key!.id).toBe(men[disc.indexOf(Math.max(...disc))].p.id)
      const mean = disc.reduce((s, x) => s + x, 0) / disc.length
      if (r.weak) {
        weakSeen++
        expect(r.weak.rating).toBe(Math.min(...disc))
        expect(mean - r.weak.rating!).toBeGreaterThanOrEqual(3)
      } else expect(mean - Math.min(...disc)).toBeLessThan(3)
      expect(r.outOfPosition.map((m) => m.id).sort()).toEqual(men.filter(({ sl, p }) => describeFit(p, sl.position) !== 'natural').map(({ p }) => p.id).sort())
      const ages = men.map(({ p }) => p.age)
      expect(r.meanAge).toBeCloseTo(ages.reduce((s, a) => s + a, 0) / 11, 1)
      expect(r.young).toBe(ages.filter((a) => a <= 23).length)
      expect(r.veterans).toBe(ages.filter((a) => a >= VETERAN_AGE).length)
      // The links are chemistry's same-club-season pairs
      const chem = chemistryOf(men.map(({ p }) => p), [])
      expect(r.links).toBeLessThanOrEqual(chem.links)
      expect(r.clubs).toBe(new Set(men.map(({ p }) => p.clubId)).size)
      expect(r.nations).toBeGreaterThan(0)
    }
    expect(weakSeen).toBeGreaterThan(0)
  }, 60_000)

  it('names no key man or weak link and shows no number with ratings hidden', () => {
    const g = atKickoff('report-hidden')
    const r = squadReport(getFormation(g.tactics.formationId), g.lineup, playerLookup(g, u), true)!
    expect(r.key).toBeNull()
    expect(r.weak).toBeNull()
    for (const m of r.outOfPosition) expect(m.rating).toBeNull()
    expect(r.starters).toBe(11)
  })

  it('has nothing to say about an empty lineup', () => {
    expect(squadReport(getFormation('4-3-3'), {}, () => undefined, false)).toBeNull()
  })
})
