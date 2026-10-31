import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { pickGrades, type GradedPick, type PickGrade } from '../logic/pickGrades'
import { bestPlayMarks, draftGrade, draftGradeLine, draftRecap, recapVerdict } from '../logic/draftRecap'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function quick(seed: string): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Recap XI', shortName: 'RCP', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' }
}

const pick = (grade: PickGrade, gap = 0): GradedPick => ({ spin: 0, pickedId: 'x', slotId: 'gk', rating: 80, best: 80 + gap, bestName: 'Y', bestSlotId: 'gk', left: gap, grade })

describe('the draft recap', () => {
  it("grades the whole draft from the mean of its pick grades", () => {
    expect(draftGrade([])).toBeNull()
    expect(draftGrade([pick('A'), pick('B'), pick('B')])).toBe('B')
    // An A needs a mean of 3.7: eight A's and three B's, not seven and four
    expect(draftGrade([...Array(8).fill(pick('A')), pick('B'), pick('B'), pick('B')])).toBe('A')
    expect(draftGrade([...Array(7).fill(pick('A')), pick('B'), pick('B'), pick('B'), pick('B')])).toBe('B')
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
        expect(r.miss.left).toBeGreaterThanOrEqual(2)
        for (const gr of grades) expect(gr.left).toBeLessThanOrEqual(r.miss.left)
      } else for (const gr of grades) expect(gr.left).toBeLessThan(2)
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
    // With no grade the recap lists the picks instead, with no rating
    expect(r.ungraded.length).toBe(r.picks)
    expect(r.ungraded.every((x) => x.rating === null)).toBe(true)
  })

  it('lists as ungraded only the picks no grade covers, rated as the draft rated them', () => {
    for (const seed of ['recap-ungraded-1', 'recap-ungraded-2']) {
      const g = createGame(quick(seed))
      autoDraft(u, g.draft!, Rng.fromState(g.rngState))
      const get = playerLookup(g, u)
      const r = draftRecap(u, g.draft!, get, true)
      const graded = new Set(pickGrades(u, g.draft!, get).map((x) => x.spin))
      expect(r.ungraded.map((x) => x.spin)).toEqual(g.draft!.history.flatMap((h, i) => (h.pickedId && !graded.has(i) ? [i] : [])))
      for (const x of r.ungraded) expect(x.rating).toBe(get(x.id)!.overall)
    }
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

describe("the Hindsight XI's best-play marks", () => {
  it('marks the men a missed grade named as the best play on their spin, never your own picks', () => {
    const h = { xi: [
      { spin: 0, slotId: 'gk', id: 'a@1@c', name: 'A. Keeper', rating: 80, yours: true },
      { spin: 1, slotId: 'cb1', id: 'b@1@c', name: 'B. Back', rating: 84, yours: false },
      { spin: 2, slotId: 'st', id: 'c@1@c', name: 'C. Nine', rating: 86, yours: false },
    ], rating: 83.3, yours: 81, gap: 2.3, kept: 1 }
    const g = (spin: number, bestName: string, bestSlotId: string, left: number): GradedPick => ({ spin, pickedId: 'x', slotId: 'cb1', rating: 80, best: 84, bestName, bestSlotId, left, grade: left ? 'C' : 'A' })
    expect(bestPlayMarks(null, [])).toEqual([])
    expect(bestPlayMarks(h, [g(1, 'B. Back', 'cb1', 3), g(2, 'C. Nine', 'gk', 2), g(0, 'A. Keeper', 'gk', 1)])).toEqual(['cb1'])
    // Level with the best play: no mark
    expect(bestPlayMarks(h, [g(1, 'B. Back', 'cb1', 0)])).toEqual([])
  })

  it('appear on seeded drafts and point at Hindsight XI men', () => {
    let marks = 0
    for (const seed of ['recap-1', 'recap-2', 'recap-3', 'recap-4', 'recap-5', 'recap-6', 'recap-7', 'recap-8']) {
      const g = createGame(quick(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      const r = draftRecap(u, g.draft!, playerLookup(g, u), true)
      for (const slot of r.bestPlays) expect(r.hindsight!.xi.some((p) => p.slotId === slot && !p.yours)).toBe(true)
      marks += r.bestPlays.length
      expect(draftRecap(u, g.draft!, playerLookup(g, u), false).bestPlays).toEqual([])
    }
    expect(marks).toBeGreaterThan(0)
  })
})
