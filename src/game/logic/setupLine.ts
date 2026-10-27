import type { LoadedUniverse } from '@engine/universe'
import type { GameSettings } from '../types'
import { quickSetupLine } from './setup'
import { capTotal } from './cap'

/**
 * The Quick Draft's line above Spin with the two casual rules `quickSetupLine` leaves out: Moneyball's cap and the
 * Teammate chain. `quickSetupLine` stays as it is (the edge verifier bundles `setup.ts`); pure, no draws.
 */
export function quickSetupLineFull(u: LoadedUniverse, s: GameSettings): string {
  const words = [quickSetupLine(u, s)]
  if (s.rules.budget !== undefined) words.push(`Moneyball ${capTotal(s.rules.budget)} cap`)
  if (s.rules.chain) words.push('Teammate chain')
  return words.join(' · ')
}
