/**
 * The draft recap: what fills the Draft's middle box once every pick is made (it was an empty "All picks made" panel).
 * A grade for the whole draft from the pick grades, a one-line verdict, the best pick, the one that got away (the pick
 * furthest short of the best man on his spin), and how far the wheel travelled: clubs, nations and seasons. Pure and
 * draft-preserving, like `pickGrades`: it only reads the draft log, so nothing about a seed moves. The Hindsight XI
 * (`hindsight.ts`) is the best XI the same spins could have given.
 */
import type { DraftRules, DraftState } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import { bestPick, pickGrades, type GradedPick, type PickGrade } from './pickGrades'
import { hindsightXI, type Hindsight } from './hindsight'

export interface DraftRecap {
  /** The whole draft's grade (the mean of the pick grades, A = 4 to D = 1); null when no pick is graded or grades are hidden. */
  grade: PickGrade | null
  /** One line on the draft, from its grade ("Squad ready" without grades). */
  verdict: string
  /** How many picks took each grade. */
  tally: Record<PickGrade, number>
  /** The pick to boast about (`bestPick`). */
  best: GradedPick | null
  /** The pick furthest short of the best man on his spin, when that is 3 or more rating points (a B or worse). */
  miss: GradedPick | null
  /** The graded XI's mean rating in the slots they were drafted into, one decimal; null without grades. */
  xiRating: number | null
  /** Different clubs, nationalities and the first and last season the picks came from. */
  clubs: number
  nations: number
  seasons: [number, number] | null
  picks: number
  /** The best XI the same spins could have given (`hindsightXI`); null without grades, under a cap or a chain. */
  hindsight: Hindsight | null
}

const POINTS: Record<PickGrade, number> = { A: 4, B: 3, C: 2, D: 1 }

/** The whole draft's grade from the mean of its pick grades: 3.5 and up an A, 2.75 a B, 2 a C, below that a D. */
export function draftGrade(grades: GradedPick[]): PickGrade | null {
  if (!grades.length) return null
  const mean = grades.reduce((s, g) => s + POINTS[g.grade], 0) / grades.length
  return mean >= 3.5 ? 'A' : mean >= 2.75 ? 'B' : mean >= 2 ? 'C' : 'D'
}

export function recapVerdict(grade: PickGrade | null, tally: Record<PickGrade, number>, graded: number): string {
  if (!grade) return 'Squad ready'
  if (tally.A === graded) return 'A perfect draft: the best man on every spin'
  if (grade === 'A') return 'A sharp draft: the best man on almost every spin'
  if (grade === 'B') return 'A good draft, a point or two left on the wheel'
  if (grade === 'C') return 'A mixed draft: some spins got away'
  return 'A draft to forget, but the season is still to play'
}

export function draftRecap(u: LoadedUniverse, d: Pick<DraftState, 'history' | 'formation'> & { rules?: Pick<DraftRules, 'budget' | 'chain'> }, get: (id: string) => PlayerSeason | undefined, showGrades: boolean): DraftRecap {
  const graded = showGrades ? pickGrades(u, d, get) : []
  const tally: Record<PickGrade, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const g of graded) tally[g.grade]++
  const grade = draftGrade(graded)
  let miss: GradedPick | null = null
  for (const g of graded) if (g.best - g.rating >= 3 && (!miss || g.best - g.rating > miss.best - miss.rating)) miss = g
  const picked = d.history.flatMap((h) => {
    const p = h.pickedId ? get(h.pickedId) : undefined
    return p ? [{ p, h }] : []
  })
  const seasons = picked.map((x) => x.h.season)
  return {
    grade,
    verdict: recapVerdict(grade, tally, graded.length),
    tally,
    best: bestPick(graded),
    miss,
    xiRating: graded.length ? Math.round((graded.reduce((s, g) => s + g.rating, 0) / graded.length) * 10) / 10 : null,
    clubs: new Set(picked.map((x) => x.h.clubId)).size,
    nations: new Set(picked.map((x) => x.p.nationality).filter(Boolean)).size,
    seasons: seasons.length ? [Math.min(...seasons), Math.max(...seasons)] : null,
    picks: picked.length,
    hindsight: showGrades ? hindsightXI(u, d, get) : null,
  }
}
