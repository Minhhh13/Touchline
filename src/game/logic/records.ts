import type { LoadedUniverse } from '@engine/universe'
import { benchmarkSeason, isPointsRecord, playedOf, type SeasonFigures } from '@engine/records'
import type { Game, GameSettings } from '../types'

/**
 * Whether a finished game's season goes in the record books: not when the
 * board sacked the manager (fewer matches), and never for a run-in, whose
 * first 28 weeks are a projection of the real table.
 */
export function inRecordBooks(game: Pick<Game, 'season'>): boolean {
  return !game.season?.sacked && !game.season?.carryIn
}

/**
 * The Record Books achievement: an outright league points record, set on
 * Realistic difficulty over a full season. Calibrated handicaps the AI, so its
 * hundred-point seasons are benchmarks, not records; a sacked or otherwise
 * unfinished season has fewer matches than the real ones and is not compared.
 */
export function earnsPointsRecord(u: LoadedUniverse, leagueId: string, difficulty: GameSettings['difficulty'] | undefined, row: SeasonFigures, matchweeks: number, sacked: boolean): boolean {
  if ((difficulty ?? 'calibrated') !== 'realistic') return false
  if (sacked || playedOf(row) !== matchweeks) return false
  return isPointsRecord(benchmarkSeason(u, leagueId, row))
}
