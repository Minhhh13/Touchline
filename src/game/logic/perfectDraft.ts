/**
 * A perfect draft for the Trophy Room (`CabinetFeats.perfectDrafts`): every pick of a quick-like draft took an A, the
 * best play on its spin (`pickGrades`). Kept apart from `feats.ts`, which `cabinet.ts` imports, so the pick grades never
 * reach the cabinet's module graph. Pure, no RNG: it only reads the draft log.
 */
import type { LoadedUniverse } from '@engine/universe'
import type { PlayerSeason } from '@engine/types'
import type { Game } from '../types'
import { pickGrades } from './pickGrades'
import { isQuickLike } from './modes'

/** The fewest graded picks a perfect draft needs: a whole XI. */
export const PERFECT_DRAFT_PICKS = 11

export function isPerfectDraft(game: Pick<Game, 'draft' | 'settings' | 'endCase'>, u: LoadedUniverse, get: (id: string) => PlayerSeason | undefined): boolean {
  // The case's Icon makes a non-standard season: no perfect draft on its back
  if (!game.draft || !isQuickLike(game.settings.mode) || game.endCase?.sub) return false
  const grades = pickGrades(u, game.draft, get)
  return grades.length >= PERFECT_DRAFT_PICKS && grades.every((g) => g.grade === 'A')
}
