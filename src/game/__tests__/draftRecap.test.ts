import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { pickGrades, type GradedPick, type PickGrade } from '../logic/pickGrades'
import { draftGrade, draftGradeLine, draftRecap, recapVerdict } from '../logic/draftRecap'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function quick(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Recap XI', shortName: 'RCP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

const pick = (grade: PickGrade, gap = 0): GradedPick => ({ spin: 0, pickedId: 'x', slotId: 'gk', rating: 80, best: 80 + gap, bestName: 'Y', grade })

describe('the draft recap', () => {
  it("grades the whole draft from the mean of its pick grades", () => {
    expect(draftGrade([])).toBeNull()
    expect(draftGrade([pick('A'), pick('B'), pick('B')])).toBe('B')
    expect(draftGrade([pick('A'), pick('A'), pick('A'), pick('B')])).toBe('A')
    expect(draftGrade([pick('C'), pick('B')])).toBe('C')
    expect(draftGrade([pick('D'), pick('C')])).toBe('D')
  })

  it('words the verdict from the grade, and says a perfect draft only when every pick is an A', () => {
    expect(recapVerdict(null, { A: 0, B: 0, C: 0, D: 0 }, 0)).toBe('Squad ready')
    expect(recapVerdict('A', { A: 11, B: 0, C: 0, D: 0 }, 11)).toMatch(/^A perfect draft/)
    expect(recapVerdict('A', { A: 10, B: 1, C: 0, D: 0 }, 11)).toMatch(/^A sharp draft/)
    for (const g of ['B', 'C', 'D'] as const) expect(recapVerdict(g, { A: 0, B: 0, C: 0, D: 0 }, 11)).not.toMatch(/perfect/)
  })

  it('sums to the picks, names the biggest miss and the wheel travelled, and leaves the draft untouched', () => {
    for (const seed of ['recap-1', 'recap-2', 'recap-3', 'recap-4', 'recap-5', 'recap-6']) {
      const g = createGame(quick(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      const before = JSON.stringify(g)
      const get = playerLookup(g, u)
      const r = draftRecap(u, g.draft!, get, true)
      expect(JSON.stringify(g)).toBe(before)
      const grades = pickGrades(u, g.draft!, get)
      expect(r.tally.A + r.tally.B + r.tally.C + r.tally.D).toBe(grades.length)
      expect(r.grade).toBe(draftGrade(grades))
      expect(r.picks).toBe(g.draft!.history.filter((h) => h.pickedId).length)
      expect(r.clubs).toBeGreaterThan(0)
      expect(r.clubs).toBeLessThanOrEqual(r.picks)
      expect(r.nations).toBeGreaterThan(0)
      expect(r.seasons![0]).toBeLessThanOrEqual(r.seasons![1])
      expect(r.xiRating).toBeGreaterThan(50)
      if (r.miss) {
        const gap = r.miss.best - r.miss.rating
        expect(gap).toBeGreaterThanOrEqual(3)
        for (const gr of grades) expect(gr.best - gr.rating).toBeLessThanOrEqual(gap)
      } else for (const gr of grades) expect(gr.best - gr.rating).toBeLessThan(3)
    }
  }, 60_000)

  it('shows no grades, verdict or ratings when grades are hidden', () => {
    const g = createGame(quick('recap-hidden'))
    autoDraft(u, g.draft!, Rng.fromState(g.rngState))
    const r = draftRecap(u, g.draft!, playerLookup(g, u), false)
    expect(r.grade).toBeNull()
    expect(r.verdict).toBe('Squad ready')
    expect(r.best).toBeNull()
    expect(r.miss).toBeNull()
    expect(r.xiRating).toBeNull()
    expect(r.picks).toBeGreaterThanOrEqual(11)
  })

  it("prints the recap's own grade in the share line, for the quick modes only, without touching the game", () => {
    for (const seed of ['recap-share-1', 'recap-share-2', 'recap-share-3']) {
      const g = createGame(quick(seed))
      autoDraft(u, g.draft!, Rng.fromState(g.rngState))
      const get = playerLookup(g, u)
      const before = JSON.stringify(g)
      const line = draftGradeLine(g, u, get)
      expect(JSON.stringify(g)).toBe(before)
      expect(line).toBe(`Draft grade ${draftRecap(u, g.draft!, get, true).grade}`)
      expect(line).toMatch(/^Draft grade [ABCD]$/)
      for (const mode of ['daily', 'weekly'] as const) expect(draftGradeLine({ ...g, settings: { ...g.settings, mode } }, u, get)).toBe(line)
      for (const mode of ['season', 'dynasty', 'arena', 'runin'] as const) expect(draftGradeLine({ ...g, settings: { ...g.settings, mode } }, u, get)).toBeNull()
      expect(draftGradeLine({ ...g, draft: null }, u, get)).toBeNull()
    }
    // An empty draft has nothing graded
    const fresh = createGame(quick('recap-share-empty'))
    expect(draftGradeLine(fresh, u, playerLookup(fresh, u))).toBeNull()
  })
})
