import type { ChallengeSettings, Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { ENGINE_VERSION } from '@engine/version'
import { encodeChallenge, historyKey, payloadVersionFor, picksFromHistory, replayDraft, rulesDiff, rulesFromPayload, sameClaim, type ChallengeClaim, type ChallengePayload, type ReplayedPick } from '@engine/challenge'
import { createGame } from './setup'
import { runQuickSeason } from './quick'
import { playerLookup } from './players'

/** The settings a challenge link fixes; the team name is the only free choice at setup. */
export function settingsFromChallenge(c: ChallengePayload, teamName: string, shortName: string, challenge: ChallengeSettings): GameSettings {
  return {
    mode: 'quick',
    seed: c.s.seed,
    formationId: c.s.f,
    teamName,
    shortName,
    leagueId: c.s.l,
    wheelLeagues: c.s.wl,
    hostClubId: c.s.h,
    leagueSeason: c.s.ls,
    rules: rulesFromPayload(c),
    jobSecurity: false,
    difficulty: c.s.d,
    challenge,
  }
}

/** The claim a finished quick game makes. */
export function claimOf(game: Game): ChallengeClaim | null {
  const q = game.quickResult
  if (!q) return null
  return { pts: q.points, w: q.won, d: q.drawn, l: q.lost, t: q.tier }
}

/**
 * Pack a finished quick draft (quick mode keeps `game.draft` after the season)
 * into a challenge. Null when the game has no draft or no result to claim.
 */
export function challengeFromGame(game: Game, u: LoadedUniverse, name: string): ChallengePayload | null {
  const d = game.draft
  const claim = claimOf(game)
  if (!d || !claim || game.phase !== 'summary') return null
  const get = playerLookup(game, u)
  const s = game.settings
  const r = rulesDiff(s.rules)
  const body = {
    data: u.generatedAt,
    engine: ENGINE_VERSION,
    name,
    s: { seed: s.seed, f: s.formationId, l: s.leagueId, wl: s.wheelLeagues, h: s.hostClubId, ls: s.leagueSeason, d: s.difficulty ?? 'calibrated', r },
    p: picksFromHistory(d.history, (id) => get(id)?.playerId),
    c: claim,
    k: historyKey(d.history),
  }
  // A rule a v1 build does not know travels as v2, so that build says "newer version" rather than "not a link"
  return payloadVersionFor(r, 'quick') === 1 ? { v: 1, ...body } : { v: 2, kind: 'quick', ...body }
}

export interface ReplayOutcome {
  verified: ChallengeSettings['verified']
  reason?: string
  /** The challenger's spins resolved to this universe's player-season ids; empty when the draft could not be replayed. */
  picks: ReplayedPick[]
  /** What the replay produced, when it ran to the end. */
  result?: ChallengeClaim
}

/**
 * Replay a challenge from scratch: a fresh game from its settings, every spin
 * and pick in order, then the quick season. The claim is verified when the
 * season reproduces it. A data or engine mismatch is reported as unverified
 * without replaying (the wheel would not land in the same places), and a draft
 * that does not follow the picks, or a season that does not match the claim,
 * is a 'no' with the reason. Nothing here throws.
 */
export function replayChallenge(u: LoadedUniverse, c: ChallengePayload): ReplayOutcome {
  const placeholder: ChallengeSettings = { name: c.name, picks: [], claim: c.c, verified: 'unverified', data: c.data, engine: c.engine }
  if (c.data !== u.generatedAt) return { verified: 'unverified', reason: `built on data from ${c.data}, this build has ${u.generatedAt}`, picks: safeDraftOnly(u, c, placeholder) }
  if (c.engine !== ENGINE_VERSION) return { verified: 'unverified', reason: `built with engine ${c.engine}, this build is ${ENGINE_VERSION}`, picks: safeDraftOnly(u, c, placeholder) }
  const game = createGame(settingsFromChallenge(c, 'Ghost', 'GHO', placeholder))
  let picks: ReplayedPick[]
  try {
    const rng = Rng.fromState(game.rngState)
    picks = replayDraft(u, game.draft!, rng, c)
    game.rngState = rng.getState()
  } catch (e) {
    return { verified: 'no', reason: e instanceof Error ? e.message : String(e), picks: [] }
  }
  try {
    runQuickSeason(game, u)
  } catch (e) {
    return { verified: 'no', reason: `the season could not be replayed: ${e instanceof Error ? e.message : String(e)}`, picks }
  }
  const result = claimOf(game)
  if (!result) return { verified: 'no', reason: 'the season produced no result', picks }
  if (!sameClaim(result, c.c)) return { verified: 'no', reason: `the picks replay to ${result.pts} points (${result.w}-${result.d}-${result.l}), not ${c.c.pts}`, picks, result }
  return { verified: 'yes', picks, result }
}

/** On different data the draft alone is still tried, so the ghost chips can show; a failure leaves them empty. */
function safeDraftOnly(u: LoadedUniverse, c: ChallengePayload, placeholder: ChallengeSettings): ReplayedPick[] {
  try {
    const game = createGame(settingsFromChallenge(c, 'Ghost', 'GHO', placeholder))
    return replayDraft(u, game.draft!, Rng.fromState(game.rngState), c)
  } catch {
    return []
  }
}

/** The settings block a game played from this challenge carries. */
export function challengeSettings(c: ChallengePayload, outcome: ReplayOutcome): ChallengeSettings {
  return {
    name: c.name,
    picks: outcome.picks.map((p) => ({ id: p.id, slotId: p.slotId, clubId: p.clubId, season: p.season })),
    claim: c.c,
    verified: outcome.verified,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    data: c.data,
    engine: c.engine,
  }
}

/** The link for a challenge, relative to where the app is served (hash links survive the service worker and a base path). */
export function challengeLink(c: ChallengePayload, origin: string, pathname: string): string {
  return `${origin}${pathname}#c=${encodeChallenge(c)}`
}

/** The head-to-head verdict for the share text and the summary: points first, then fewer defeats. */
export function verdictLine(challenge: ChallengeSettings, mine: ChallengeClaim): string {
  const diff = mine.pts - challenge.claim.pts
  if (diff > 0) return `⚔️ Beat ${challenge.name} by ${diff} point${diff === 1 ? '' : 's'}: ${mine.pts} to ${challenge.claim.pts}`
  if (diff < 0) return `⚔️ ${challenge.name} wins by ${-diff} point${diff === -1 ? '' : 's'}: ${challenge.claim.pts} to ${mine.pts}`
  if (mine.l < challenge.claim.l) return `⚔️ Level with ${challenge.name} on ${mine.pts}, fewer defeats`
  if (mine.l > challenge.claim.l) return `⚔️ Level with ${challenge.name} on ${mine.pts}, more defeats`
  return `⚔️ Dead level with ${challenge.name}: ${mine.pts} points each`
}
