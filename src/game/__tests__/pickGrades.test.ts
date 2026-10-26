import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { discRating } from '../logic/slotSheet'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { bestPick, gradeFor, inSlotRating, pickGrades } from '../logic/pickGrades'
import { hindsightXI } from '../logic/hindsight'
import { slotRating } from '../logic/slotRating'
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
        expect(gr.rating).toBe(discRating(get(h.pickedId!)!, pos))
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
        const best = Math.max(...u.clubSeasonByKey[`${h.clubId}@${h.season}`].squad.filter((p) => p.id === h.pickedId || !drafted.has(p.playerId)).map((p) => discRating(get(p.id)!, pos)))
        expect(gr.best).toBe(best)
        expect(gr.rating).toBe(discRating(get(h.pickedId!)!, pos))
      }
    }
  }, 60_000)

  it('shows the number on the pitch disc: a graded pick and a Hindsight XI man read as their slot rating there', () => {
    for (const seed of ['grade-disc-1', 'grade-disc-2', 'grade-disc-3', 'grade-disc-4']) {
      const g = createGame(quick(seed, seed.endsWith('2') ? 'prime' : 'season'))
      autoDraft(u, g.draft!, Rng.fromState(g.rngState))
      const get = playerLookup(g, u)
      const posOf = (slotId: string) => g.draft!.formation.slots.find((s) => s.id === slotId)!.position
      for (const gr of pickGrades(u, g.draft!, get)) {
        const r = slotRating(get(gr.pickedId)!, posOf(gr.slotId))
        expect(gr.rating).toBe(r.inSlot)
        expect(inSlotRating(get(gr.pickedId)!, posOf(gr.slotId))).toBe(r.inSlot)
      }
      for (const p of hindsightXI(u, g.draft!, get)?.xi ?? []) expect(p.rating).toBe(slotRating(get(p.id)!, posOf(p.slotId)).inSlot)
    }
  }, 60_000)
})
