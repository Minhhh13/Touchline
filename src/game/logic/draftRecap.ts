/**
 * The draft recap: what fills the Draft's middle box once every pick is made (it was an empty "All picks made" panel).
 * A grade for the whole draft from the pick grades, a one-line verdict, the best pick, the one that got away (the pick
 * that left the most on the table against the best play on his spin), and how far the wheel travelled: clubs, nations and seasons. Pure and
 * draft-preserving, like `pickGrades`: it only reads the draft log, so nothing about a seed moves. The Hindsight XI
 * (`hindsight.ts`) is the best XI the same spins could have given.
 */
import type { DraftRules, DraftState } from '@engine/draft'
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import { bestPick, pickGrades, type GradedPick, type PickGrade } from './pickGrades'
import { hindsightXI, type Hindsight } from './hindsight'
import { isQuickLike } from './modes'
import type { Game } from '../types'

export interface DraftRecap {
  /** The whole draft's grade (the mean of the pick grades, A = 4 to D = 1); null when no pick is graded or grades are hidden. */
  grade: PickGrade | null
  /** One line on the draft, from its grade ("Squad ready" without grades). */
  verdict: string
  /** How many picks took each grade. */
  tally: Record<PickGrade, number>
  /** The pick to boast about (`bestPick`). */
  best: GradedPick | null
  /** The pick that left the most on the table (`GradedPick.left`), when that is 2 or more XI points. */
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
  /**
   * The Hindsight XI's slots whose man is the best play a pick's grade named and the pick missed (`bestPlayMarks`): the
   * men the log's grade notes point to. Empty without a Hindsight XI.
   */
  bestPlays: string[]
  /**
   * The picks no grade covers (a run-in's reinforcements, bench picks, every pick with grades hidden), in spin order:
   * the recap lists them when the draft has no grade, so a draft of signings is not an empty box. `rating` is his
   * overall as the draft rated him, null with grades hidden.
   */
  ungraded: Array<{ spin: number; id: string; rating: number | null }>
}

const POINTS: Record<PickGrade, number> = { A: 4, B: 3, C: 2, D: 1 }

/**
 * The whole draft's grade from the mean of its pick grades: 3.7 and up an A (an XI of A's with three B's at most), 3.2 a
 * B, 2.5 a C, below that a D. Calibrated with `gradeFor` (round 5): the assistant's draft averages a B.
 */
export function draftGrade(grades: GradedPick[]): PickGrade | null {
  if (!grades.length) return null
  const mean = grades.reduce((s, g) => s + POINTS[g.grade], 0) / grades.length
  return mean >= 3.7 ? 'A' : mean >= 3.2 ? 'B' : mean >= 2.5 ? 'C' : 'D'
}

export function recapVerdict(grade: PickGrade | null, tally: Record<PickGrade, number>, graded: number): string {
  if (!grade) return 'Squad ready'
  if (tally.A === graded) return 'A perfect draft: the best play on every spin'
  if (grade === 'A') return 'A sharp draft: the best play on almost every spin'
  if (grade === 'B') return 'A good draft, a few points left on the wheel'
  if (grade === 'C') return 'A mixed draft: some spins got away'
  return 'A draft to forget, but the season is still to play'
}

/**
 * The Hindsight XI's slots that hold the best play a spin's grade named when the pick fell short of it: the man the
 * pick's note names, in the slot it names, from the same spin. Your own picks (ticked) never carry the mark.
 */
export function bestPlayMarks(h: Hindsight | null, graded: GradedPick[]): string[] {
  if (!h) return []
  return h.xi.filter((p) => !p.yours && graded.some((g) => g.left > 0 && g.spin === p.spin && g.bestSlotId === p.slotId && g.bestName === p.name)).map((p) => p.slotId)
}

export function draftRecap(u: LoadedUniverse, d: Pick<DraftState, 'history' | 'formation'> & { rules?: Pick<DraftRules, 'budget' | 'chain' | 'draftMode' | 'modes'> }, get: (id: string) => PlayerSeason | undefined, showGrades: boolean): DraftRecap {
  const graded = showGrades ? pickGrades(u, d, get) : []
  const tally: Record<PickGrade, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const g of graded) tally[g.grade]++
  const grade = draftGrade(graded)
  let miss: GradedPick | null = null
  for (const g of graded) if (g.left >= 2 && (!miss || g.left > miss.left)) miss = g
  const picked = d.history.flatMap((h) => {
    const p = h.pickedId ? get(h.pickedId) : undefined
    return p ? [{ p, h }] : []
  })
  const seasons = picked.map((x) => x.h.season)
  const hindsight = showGrades ? hindsightXI(u, d, get) : null
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
    hindsight,
    bestPlays: bestPlayMarks(hindsight, graded),
    ungraded: d.history.flatMap((h, spin) => {
      const p = h.pickedId ? get(h.pickedId) : undefined
      return p && !graded.some((g) => g.spin === spin) ? [{ spin, id: p.id, rating: showGrades ? p.overall : null }] : []
    }),
  }
}

/**
 * The draft's grade as the share text and the share card print it ("Draft grade B"): the recap's own grade, so the
 * share says what the player saw when the draft ended. Quick Draft, the Daily and the Weekly only (the modes whose
 * summary follows a draft the player made), and only while the game keeps its draft; null otherwise or with no
 * graded pick. Pure, reads the draft log only.
 */
export function draftGradeLine(game: Pick<Game, 'settings' | 'draft'>, u: LoadedUniverse, get: (id: string) => PlayerSeason | undefined): string | null {
  if (!game.draft || !isQuickLike(game.settings.mode)) return null
  const grade = draftGrade(pickGrades(u, game.draft, get))
  return grade ? `Draft grade ${grade}` : null
}
