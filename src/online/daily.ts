/**
 * The pure client side of the ranked boards: which settings today's Daily (or this week's challenge) starts with
 * when a pin exists, whether it ranks on this build, and the body a finished run posts. The network parts (fetching
 * the pin, the outbox) arrive with the online Daily client; the Daily mapping itself (`dailySettings`,
 * `DAILY_FORMATIONS`, `dailyGameSettings`) is not touched (CLAUDE.md invariant 4).
 */
import { encodeChallenge } from '@engine/challenge'
import { dailyDateOf } from '@engine/rng'
import type { LoadedUniverse } from '@engine/universe'
import { ENGINE_VERSION } from '@engine/version'
import type { Game, GameSettings } from '@game/types'
import { dailyGameSettings, shortNameFor } from '@game/logic/setup'
import { challengeFromGame } from '@game/logic/challenge'
import { nonStandardRun, settingsHash, type PuzzlePin, type RankedBody } from './server/dailyVerify'
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

/**
 * The draft rules that make a run non-standard for the ranked boards: Quick Draft modes (Crazy, Hard, Gamble...), the
 * Player Upgrader, the power-up tray, the Super League, managers and the manager spin, the end-of-draft case, classic
 * seasons, and the casual modes' salary cap and teammate chain. The ranked rules (`DAILY_RULES`, also the weekly's)
 * have none of them, and the server refuses any rules that differ from the pin's anyway; this keeps the device from
 * filing such a run at all. A new optional rule that changes what a season can be belongs here.
 */
export const NON_STANDARD_RULES = ['modes', 'upgrader', 'powerUps', 'superLeague', 'managers', 'managerSpin', 'endCase', 'classic', 'budget', 'chain'] as const

/** The first non-standard rule a game's settings switch on, or null. */
export function nonStandardRule(settings: Pick<GameSettings, 'rules'>): (typeof NON_STANDARD_RULES)[number] | null {
  const r = settings.rules
  for (const k of NON_STANDARD_RULES) {
    const v = r[k]
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false) return k
  }
  return null
}

/**
 * Why a finished game on a ranked board's seed cannot rank, or null when it can: a non-standard rule, or a draft
 * or season that used something outside the puzzle (the Upgrader, tray or locker power-ups, the case's Icon, a
 * manager), the same checks the verifier makes (`nonStandardRun`).
 */
export function unrankedReason(game: Game, u: LoadedUniverse): string | null {
  if (nonStandardRule(game.settings)) return 'This run used rules outside the ranked puzzle'
  if (game.draft?.locker?.length) return 'Power-ups from the locker are not part of the ranked puzzle'
  if (game.endCase?.sub) return "The case's Icon is not part of the ranked puzzle"
  const payload = challengeFromGame(game, u, 'check')
  return payload ? nonStandardRun(payload, game.settings.rules) : null
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
  if (unrankedReason(game, u)) return null
  const payload = challengeFromGame(game, u, name)
  if (!payload) return null
  return { op: isDaily ? 'daily.submit' : 'weekly.submit', encoded: encodeChallenge(payload), teamName: game.settings.teamName, shortName: game.settings.shortName }
}

/** The ranked board a game's settings belong to (the Daily's date, or the week key), or null for any other game. */
export function rankedBoardOf(settings: GameSettings): { kind: 'daily' | 'weekly'; key: string } | null {
  if (settings.challenge || nonStandardRule(settings)) return null
  if (settings.mode === 'daily') {
    const d = dailyDateOf(settings.seed)
    return d ? { kind: 'daily', key: d.toISOString().slice(0, 10) } : null
  }
  const week = settings.mode === 'quick' ? weekKeyOfSeed(settings.seed) : null
  return week ? { kind: 'weekly', key: week } : null
}
