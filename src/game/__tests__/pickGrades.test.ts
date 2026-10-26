import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, canSpin, eligibleSlots, isComplete, pick, QUICK_RULES, spin } from '@engine/draft'
import { discRating } from '../logic/slotSheet'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { bestPick, gradeFor, gradeNote, inSlotRating, pickGrades } from '../logic/pickGrades'
import { draftGrade } from '../logic/draftRecap'
import { hindsightXI } from '../logic/hindsight'
import { slotRating } from '../logic/slotRating'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function quick(seed: string, ratings: 'season' | 'prime' = 'season'): GameSettings {
  return { mode: 'quick', seed, formationId: '4-3-3', teamName: 'Grade XI', shortName: 'GRD', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'], ratings }, jobSecurity: false, difficulty: 'calibrated' }
}

describe('pick grades', () => {
  it('maps the XI points a pick left on the table to A to D', () => {
    expect(gradeFor(0)).toBe('A')
    expect(gradeFor(1)).toBe('B')
    expect(gradeFor(2)).toBe('B')
    expect(gradeFor(3)).toBe('C')
    expect(gradeFor(4)).toBe('C')
    expect(gradeFor(5)).toBe('D')
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
        expect(gr.left).toBeGreaterThanOrEqual(0)
        expect(gr.grade).toBe(gradeFor(gr.left))
        const h = g.draft!.history[gr.spin]
        const pos = g.draft!.formation.slots.find((s) => s.id === gr.slotId)!.position
        expect(gr.rating).toBe(discRating(get(h.pickedId!)!, pos))
        expect(u.clubSeasonByKey[`${h.clubId}@${h.season}`].squad.some((p) => p.name === gr.bestName)).toBe(true)
        // Level with the best play, the best play is the pick itself
        if (gr.left === 0) expect([gr.bestName, gr.best, gr.bestSlotId]).toEqual([get(h.pickedId!)!.name, gr.rating, gr.slotId])
        else expect(gr.bestSlotId !== gr.slotId || gr.best > gr.rating).toBe(true)
      }
      const top = bestPick(grades)!
      for (const gr of grades) expect('ABCD'.indexOf(top.grade)).toBeLessThanOrEqual('ABCD'.indexOf(gr.grade))
    }
    // The assistant's picks are usually the best play, so A leads
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
        // Every man drafted on another spin is out of this one's reckoning
        const drafted = new Set(g.draft!.history.flatMap((x, i) => (x.pickedId && i !== gr.spin ? [get(x.pickedId)?.playerId] : [])))
        const best = Math.max(...u.clubSeasonByKey[`${h.clubId}@${h.season}`].squad.filter((p) => p.id === h.pickedId || !drafted.has(p.playerId)).map((p) => discRating(get(p.id)!, pos)))
        // The best man left in his own slot is a floor: a pick leaves at least that gap
        expect(gr.left).toBeGreaterThanOrEqual(best - gr.rating)
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

/** A draft by a player who takes any man who fits, into any open slot he fits, at random (the test's own stream). */
function randomDraft(g: ReturnType<typeof createGame>, seed: string): void {
  const d = g.draft!
  const rng = Rng.fromState(g.rngState)
  const choose = new Rng(seed)
  for (let guard = 0; !isComplete(d) && guard < 200 && canSpin(u, d); guard++) {
    const cs = spin(u, d, rng)
    const options = cs.squad.flatMap((p) => eligibleSlots(d, p).map((s) => ({ id: p.id, slot: s.id })))
    if (!options.length) break
    const o = options[Math.floor(choose.next() * options.length)]
    pick(u, d, o.id, o.slot)
  }
}

describe('pick grade calibration', () => {
  const POINTS = { A: 4, B: 3, C: 2, D: 1 }

  it("spreads the assistant's drafts around a B, not straight A's, and puts a random draft well below", () => {
    for (const ratings of ['season', 'prime'] as const) {
      const drafts = { A: 0, B: 0, C: 0, D: 0 }
      const picks = { A: 0, B: 0, C: 0, D: 0 }
      let auto = 0
      let random = 0
      const N = 40
      for (let i = 0; i < N; i++) {
        const g = createGame(quick(`calibrate-${ratings}-${i}`, ratings))
        autoDraft(u, g.draft!, Rng.fromState(g.rngState))
        const grades = pickGrades(u, g.draft!, playerLookup(g, u))
        for (const x of grades) picks[x.grade]++
        const grade = draftGrade(grades)!
        drafts[grade]++
        auto += POINTS[grade]
        const r = createGame(quick(`calibrate-random-${ratings}-${i}`, ratings))
        randomDraft(r, `calibrate-random-picker-${i}`)
        random += POINTS[draftGrade(pickGrades(u, r.draft!, playerLookup(r, u)))!]
      }
      // Around a B on average: 2.7 to 3.4 grade points, A for fewer than half, and every pick grade in use
      expect(auto / N).toBeGreaterThan(2.7)
      expect(auto / N).toBeLessThan(3.4)
      expect(drafts.A).toBeLessThan(N / 2)
      expect(drafts.B).toBeGreaterThan(drafts.A)
      for (const k of ['A', 'B', 'C', 'D'] as const) expect(picks[k]).toBeGreaterThan(0)
      expect(picks.A).toBeGreaterThan(picks.B)
      // A pick at random from what fits grades a full grade lower or worse
      expect(random / N).toBeLessThan(auto / N - 1)
    }
  }, 300_000)

  it('counts only the slot you filled under Position First and the salary cap', () => {
    for (const [seed, extra] of [['grade-position', { draftMode: 'position' as const }], ['grade-cap', { budget: 400 }]] as const) {
      const g = createGame({ ...quick(seed), rules: { ...quick(seed).rules, ...extra } })
      autoDraft(u, g.draft!, Rng.fromState(g.rngState))
      const get = playerLookup(g, u)
      const grades = pickGrades(u, g.draft!, get)
      expect(grades.length).toBeGreaterThan(0)
      for (const gr of grades) {
        expect(gr.bestSlotId).toBe(gr.slotId)
        expect(gr.left).toBe(gr.best - gr.rating)
      }
    }
  }, 60_000)

  it('words the tooltip from the best play', () => {
    const base = { spin: 0, pickedId: 'x', slotId: 'cb1', rating: 84, best: 84, bestName: 'A. Man', bestSlotId: 'cb1', left: 0, grade: 'A' as const }
    expect(gradeNote(base, () => 'CB')).toBe('84 at CB: the best play on that spin')
    expect(gradeNote({ ...base, best: 86, bestName: 'B. Keeper', bestSlotId: 'gk', left: 3, grade: 'C' }, (id) => (id === 'gk' ? 'GK' : 'CB'))).toBe('84 at CB; the best play on that spin was B. Keeper, 86 at GK (3 XI points left)')
  })
})
