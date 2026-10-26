import type { GameSettings } from '../types'
import { startFormation } from './setup'

/**
 * The summary's Draft again: the same settings on a new seed, without the challenge. Under Crazy the formation is
 * drawn again from the new seed (`startFormation`), as Start would have drawn it; otherwise the shape is kept. Pure.
 * Kept out of `setup.ts`, which the edge verifier bundles (a change there renames its hash).
 */
export function draftAgainSettings(s: GameSettings, seed: string): GameSettings {
  const { challenge: _challenge, ...rest } = s
  void _challenge
  return { ...rest, seed, formationId: startFormation(s.rules, seed, s.formationId) }
}
