import type { LoadedUniverse } from '@engine/universe'
import { benchmarkSeason, isPointsRecord, playedOf, type SeasonFigures } from '@engine/records'
import type { GameSettings } from '../types'

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
