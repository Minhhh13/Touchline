import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { ratingAt } from '@engine/positions'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { bestPick, gradeFor, pickGrades } from '../logic/pickGrades'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function quick(seed: string, ratings: 'season' | 'prime' = 'season'): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Grade XI', shortName: 'GRD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'], ratings }, jobSecurity: false, difficulty: 'calibrated' }
}

describe('pick grades', () => {
  it('maps the gap to the best on the spin to A to D', () => {
    expect(gradeFor(0)).toBe('A')
    expect(gradeFor(1)).toBe('A')
    expect(gradeFor(2.5)).toBe('B')
    expect(gradeFor(6)).toBe('C')
    expect(gradeFor(6.1)).toBe('D')
  })

  it('grades every XI pick against the best still on his club-season, and reads the draft without changing it', () => {
    const counts = { A: 0, B: 0, C: 0, D: 0 }
    for (const seed of ['grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5']) {
      const g = createGame(quick(seed))
      const rng = Rng.fromState(g.rngState)
      autoDraft(u, g.draft!, rng)
      const before = JSON.stringify(g.draft)
      const get = playerLookup(g, u)
      const grades = pickGrades(u, g.draft!, get)
      expect(JSON.stringify(g.draft)).toBe(before)
      expect(grades.length).toBe(g.draft!.formation.slots.length)
      for (const gr of grades) {
        counts[gr.grade]++
        expect(gr.best).toBeGreaterThanOrEqual(gr.rating)
        const h = g.draft!.history[gr.spin]
        const pos = g.draft!.formation.slots.find((s) => s.id === gr.slotId)!.position
        expect(gr.rating).toBe(Math.round(ratingAt(get(h.pickedId!)!, pos)))
        expect(u.clubSeasonByKey[`${h.clubId}@${h.season}`].squad.some((p) => p.name === gr.bestName)).toBe(true)
      }
      const top = bestPick(grades)!
      for (const gr of grades) expect('ABCD'.indexOf(top.grade)).toBeLessThanOrEqual('ABCD'.indexOf(gr.grade))
    }
    // The assistant's picks are usually the best on the wheel, so A dominates
    expect(counts.A).toBeGreaterThan(counts.D)
  }, 60_000)

  it('rates the rest of the squad as the draft rated the pick: under Prime ratings, every man at his best', () => {
    for (const seed of ['grade-prime-1', 'grade-prime-2', 'grade-prime-3']) {
      const g = createGame(quick(seed, 'prime'))
      autoDraft(u, g.draft!, Rng.fromState(g.rngState))
      const get = playerLookup(g, u)
      for (const gr of pickGrades(u, g.draft!, get)) {
        const h = g.draft!.history[gr.spin]
        const pos = g.draft!.formation.slots.find((s) => s.id === gr.slotId)!.position
        const drafted = new Set(g.draft!.history.slice(0, gr.spin).map((x) => (x.pickedId ? get(x.pickedId)?.playerId : undefined)))
        const best = Math.max(...u.clubSeasonByKey[`${h.clubId}@${h.season}`].squad.filter((p) => p.id === h.pickedId || !drafted.has(p.playerId)).map((p) => Math.round(ratingAt(get(p.id)!, pos))))
        expect(gr.best).toBe(best)
        expect(gr.rating).toBe(Math.round(ratingAt(get(h.pickedId!)!, pos)))
      }
    }
  }, 60_000)
})
