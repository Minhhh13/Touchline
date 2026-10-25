/**
 * The pure client side of the ranked boards: which settings today's Daily (or this week's challenge) starts with
 * when a pin exists, whether it ranks on this build, and the body a finished run posts. The network parts (fetching
 * the pin, the outbox) arrive with the online Daily client; the Daily mapping itself (`dailySettings`,
 * `DAILY_FORMATIONS`, `dailyGameSettings`) is not touched (CLAUDE.md invariant 4).
 */
import { encodeChallenge } from '@engine/challenge'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { dailyGameSettings, shortNameFor } from '@game/logic/setup'
import { challengeFromGame } from '@game/logic/challenge'
import { settingsHash, type PuzzlePin, type RankedBody } from './server/dailyVerify'
import { weekKeyOfSeed, weeklyGameSettings } from './weekly'

export type StartSource = 'local' | 'pinned' | 'missing_data'

export interface StartDecision {
  settings: GameSettings
  /** `local`: this build's own mapping (no pin, or the pin agrees); `pinned`: the pin's settings, because the
   * mapping here differs (a data rebuild or a rules change since the pin); `missing_data`: the pin names a club
   * season this build does not have, so the local puzzle is played and the card asks for a reload. */
  source: StartSource
  /** Whether a finished run can rank: a pin exists and runs on this build's engine. */
  ranked: boolean
}

function decide(u: LoadedUniverse, local: GameSettings, pin: PuzzlePin | null): StartDecision {
  if (!pin) return { settings: local, source: 'local', ranked: false }
  const ranked = pin.engineVersion === ENGINE_VERSION
  if (settingsHash(local) === pin.settingsHash) return { settings: local, source: 'local', ranked }
  const s = pin.settings
  const host = u.clubSeasonByKey[`${s.hostClubId}@${s.leagueSeason}`]
  if (!host || host.leagueId !== s.leagueId) return { settings: local, source: 'missing_data', ranked: false }
  return { settings: { ...s, teamName: local.teamName, shortName: shortNameFor(local.teamName) }, source: 'pinned', ranked }
}

/** What today's Daily starts with: `dailyGameSettings` unless a pin says otherwise. */
export function dailyStartSettings(u: LoadedUniverse, seed: string, teamName: string, pin: PuzzlePin | null): StartDecision {
  return decide(u, dailyGameSettings(u, seed, teamName), pin && pin.kind === 'daily' && pin.seed === seed ? pin : null)
}

/** What this week's challenge starts with: `weeklyGameSettings` unless a pin says otherwise. */
export function weeklyStartSettings(u: LoadedUniverse, key: string, teamName: string, pin: PuzzlePin | null): StartDecision {
  return decide(u, weeklyGameSettings(u, key, teamName), pin && pin.kind === 'weekly' && pin.key === key ? pin : null)
}

export interface RankedSubmission extends RankedBody {
  op: 'daily.submit' | 'weekly.submit'
}

/**
 * The body a finished ranked run posts: the existing ghost-draft payload (so a board row can later be raced) plus
 * the names played with. Null for anything that is not a finished Daily or weekly challenge with its draft.
 */
export function buildRankedSubmission(game: Game, u: LoadedUniverse, name: string): RankedSubmission | null {
  const isDaily = game.settings.mode === 'daily'
  const isWeekly = game.settings.mode === 'quick' && weekKeyOfSeed(game.settings.seed) !== null && !game.settings.challenge
  if (!isDaily && !isWeekly) return null
  const payload = challengeFromGame(game, u, name)
  if (!payload) return null
  return { op: isDaily ? 'daily.submit' : 'weekly.submit', encoded: encodeChallenge(payload), teamName: game.settings.teamName, shortName: game.settings.shortName }
}
