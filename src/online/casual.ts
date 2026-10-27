/**
 * The casual modes' boards on the device (docs/ONLINE.md section 5g): which board a finished game belongs to, whether
 * it can rank (the same checks the verifier makes, so a run that cannot rank is never filed), and the body it posts.
 * Pure; the network parts are the outbox (`outbox.ts`) and the board readers (`boards.ts`).
 *
 * - The Daily Arena (`arena`): today's arena (`dailyArenaGameSettings`), played by the assistant from the draft on
 *   (no live match, no changed training or penalty order: `arena.handManaged` stays false).
 * - The Weekly Challenge (`themed`, mode `weekly`): this week's themed wheel (`weeklyGameSettings`), with nothing
 *   outside its rules (no locker power-up, no case Icon, no January gamble).
 * - The Run-in of the week (`runin`): this week's job (`weeklyRunInSettings`), the four picks, then the assistant to
 *   the end (Sim to end); the device replays it itself to know it will rank (`runInReplayProblem`).
 */
import { encodeChallenge } from '@engine/challenge'
import type { LoadedUniverse } from '@engine/universe'
import type { Game, GameSettings } from '@game/types'
import { arenaChallengeFromGame, challengeFromGame } from '@game/logic/challenge'
import { dailyArenaGameSettings } from '@game/logic/arenaDaily'
import { weeklyGameSettings } from '@game/logic/weekly'
import { encodeRunIn, isWeeklyRunIn, runInClaimOf, runInPayloadFromGame, runInReplayProblem } from '@game/logic/runinWeekly'
import { nonStandardRun, puzzleOf, samePuzzle } from './server/dailyVerify'
import { ARENA_HAND_REASON, arenaPuzzleProblem, casualKeyOfSeed, casualShortName, type CasualBoard } from './server/casualVerify'

export type { CasualBoard } from './server/casualVerify'
export { CASUAL_BOARDS, casualClosesAt, casualKeyOfSeed, casualSeedOf } from './server/casualVerify'

/** The casual board a game's settings belong to, or null (any other game, a replayed link, a Daily Arena practised again). */
export function casualBoardOf(settings: Pick<GameSettings, 'mode' | 'seed' | 'challenge' | 'arena'>): { board: CasualBoard; key: string } | null {
  if (settings.challenge) return null
  const board: CasualBoard | null = settings.mode === 'arena' && settings.arena?.daily ? 'arena' : settings.mode === 'weekly' ? 'themed' : isWeeklyRunIn(settings) ? 'runin' : null
  const key = board ? casualKeyOfSeed(board, settings.seed) : null
  return board && key ? { board, key } : null
}

/** The board in words: `the Daily Arena`, `this week's Weekly Challenge`, `the Run-in of the week`. */
export const CASUAL_BOARD_NAME: Record<CasualBoard, string> = { arena: 'the Daily Arena', themed: 'the Weekly Challenge', runin: 'the Run-in of the week' }

/** Why a finished casual game cannot rank, or null when it can: the checks the verifier makes before it replays. */
export function casualUnrankedReason(game: Game, u: LoadedUniverse): string | null {
  const b = casualBoardOf(game.settings)
  if (!b) return 'Not a ranked casual board'
  if (game.phase !== 'summary') return 'The run has not finished'
  if (b.board === 'arena') {
    const c = arenaChallengeFromGame(game, u, 'check')
    if (!c) return 'The run has not finished'
    const problem = arenaPuzzleProblem(c, puzzleOf(dailyArenaGameSettings(u, game.settings.seed, game.settings.teamName)))
    if (problem) return problem
    return c.auto ? null : ARENA_HAND_REASON
  }
  if (b.board === 'themed') {
    const expected = weeklyGameSettings(u, game.settings.seed, game.settings.teamName)
    if (!expected) return "This week's packs are not loaded"
    if (game.draft?.locker?.length) return 'Power-ups from the locker are not part of the ranked Weekly'
    if (game.endCase?.sub) return "The case's Icon is not part of the ranked Weekly"
    if (game.quickJanuary?.spin || game.quickJanuary?.upgrade) return 'The January spin and Upgrader are not part of the ranked Weekly'
    const c = challengeFromGame(game, u, 'check')
    if (!c) return 'The season has not finished'
    if (!samePuzzle(c.s, puzzleOf(expected))) return 'This run was played on a different puzzle from the ranked one'
    return nonStandardRun(c, expected.rules)
  }
  return runInReplayProblem(game, u)
}

export interface CasualSubmission {
  op: 'casual.submit'
  board: CasualBoard
  encoded: string
  teamName: string
  shortName: string
}

/** The body a finished casual run posts, or null when it cannot rank. */
export function buildCasualSubmission(game: Game, u: LoadedUniverse, name: string): CasualSubmission | null {
  const b = casualBoardOf(game.settings)
  if (!b || casualUnrankedReason(game, u)) return null
  const shortName = casualShortName(game.settings)
  if (b.board === 'runin') {
    const p = runInPayloadFromGame(game, u, name)
    return p ? { op: 'casual.submit', board: 'runin', encoded: encodeRunIn(p), teamName: game.settings.teamName, shortName } : null
  }
  const c = b.board === 'arena' ? arenaChallengeFromGame(game, u, name) : challengeFromGame(game, u, name)
  return c ? { op: 'casual.submit', board: b.board, encoded: encodeChallenge(c), teamName: game.settings.teamName, shortName } : null
}

/** A finished game's own score on its board, before the server answers: arena steps won, or league points. */
export function casualScoreOf(game: Game): number {
  if (game.settings.mode === 'arena') return game.arena?.log.filter((s) => s.gf > s.ga || (s.pens ? s.pens.us > s.pens.them : false)).length ?? 0
  if (game.settings.mode === 'weekly') return game.quickResult?.points ?? 0
  return runInClaimOf(game)?.pts ?? 0
}
