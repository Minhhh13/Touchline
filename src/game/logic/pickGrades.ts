/**
 * Pick grades for a finished draft (draft-preserving: it only reads the draft log). Each XI pick is graded A to D by
 * his rating in the slot he was drafted into against the best rating in that slot the spun club-season held, leaving
 * out players already drafted by then. Every man is rated as the draft rated him (`get`: under Prime ratings at his
 * career best), so the pick and the rest of his squad compare like with like. Display only: nothing about spins,
 * picks or power-ups changes.
 */
import type { DraftState } from '@engine/draft'
import { isIcons } from '@engine/icons'
import { ratingAt } from '@engine/positions'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'

export type PickGrade = 'A' | 'B' | 'C' | 'D'

/** Rating points short of the best on the spin for each grade: within 1 an A, 3 a B, 6 a C, more a D. */
export function gradeFor(gap: number): PickGrade {
  return gap <= 1 ? 'A' : gap <= 3 ? 'B' : gap <= 6 ? 'C' : 'D'
}

export interface GradedPick {
  /** Index of the spin in the draft history. */
  spin: number
  pickedId: string
  slotId: string
  rating: number
  best: number
  bestName: string
  grade: PickGrade
}

/** Grades for every XI pick with a slot, in spin order (bench picks, re-spins and the Icons case are not graded). */
export function pickGrades(u: LoadedUniverse, d: Pick<DraftState, 'history' | 'formation'>, get: (id: string) => PlayerSeason | undefined): GradedPick[] {
  const out: GradedPick[] = []
  const taken = new Set<string>()
  d.history.forEach((h, spin) => {
    const picked = h.pickedId ? get(h.pickedId) : undefined
    const slot = h.slotId ? d.formation.slots.find((s) => s.id === h.slotId) : undefined
    if (picked && slot && !isIcons(h)) {
      // Every man as the draft rated him (`get`: Prime ratings, an upgrade), as the man you took is, so like meets like
      const pool = (u.clubSeasonByKey[`${h.clubId}@${h.season}`]?.squad ?? []).filter((p) => p.id === picked.id || !taken.has(p.playerId)).map((p) => (p.id === picked.id ? picked : get(p.id) ?? p))
      let best = ratingAt(picked, slot.position)
      let bestName = picked.name
      for (const p of pool) {
        const r = ratingAt(p, slot.position)
        if (r > best) {
          best = r
          bestName = p.name
        }
      }
      const rating = ratingAt(picked, slot.position)
      out.push({ spin, pickedId: picked.id, slotId: slot.id, rating: Math.round(rating), best: Math.round(best), bestName, grade: gradeFor(best - rating) })
    }
    if (picked) taken.add(picked.playerId)
  })
  return out
}

/** The pick to boast about: the best grade, then the highest rating, earliest first. */
export function bestPick(grades: GradedPick[]): GradedPick | null {
  const order: Record<PickGrade, number> = { A: 0, B: 1, C: 2, D: 3 }
  return [...grades].sort((a, b) => order[a.grade] - order[b.grade] || b.rating - a.rating || a.spin - b.spin)[0] ?? null
}
