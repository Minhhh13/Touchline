import type { ChallengeSettings, Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { ENGINE_VERSION } from '@engine/version'
import { draftClosed, encodeChallenge, historyKey, isArenaPayload, payloadVersionFor, picksFromHistory, replayDraft, replayRow, rulesDiff, rulesFromPayload, sameClaim, TRAINING_CODE, trainingOfCode, type ArenaChallengePayload, type ArenaClaim, type ChallengeClaim, type ChallengePayload, type QuickChallengePayload, type ReplayedPick } from '@engine/challenge'
import type { DraftState } from '@engine/draft'
import { createGame } from './setup'
import { runQuickSeason } from './quick'
import { playerLookup } from './players'
import { beginArena, changeTheDraw, closeArenaMatch, playArenaStep } from './arena'
import { arenaDay } from './arenaDaily'
import { arenaClaimOf, claimStep, mirrorClaim, sameStep, stepText } from './arenaClaim'

/** The settings a challenge link fixes; the team name is the only free choice at setup. */
export function settingsFromChallenge(c: ChallengePayload, teamName: string, shortName: string, challenge: ChallengeSettings): GameSettings {
  if (isArenaPayload(c)) return settingsFromArenaChallenge(c, teamName, shortName, challenge)
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
export function challengeFromGame(game: Game, u: LoadedUniverse, name: string): QuickChallengePayload | null {
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
  /** What an arena replay produced, when the assistant's run was played out. */
  arena?: ArenaClaim
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
  if (isArenaPayload(c)) return replayArenaChallenge(u, c)
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
function safeDraftOnly(u: LoadedUniverse, c: QuickChallengePayload, placeholder: ChallengeSettings): ReplayedPick[] {
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
    claim: isArenaPayload(c) ? mirrorClaim(c.ac) : c.c,
    verified: outcome.verified,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    data: c.data,
    engine: c.engine,
    ...(isArenaPayload(c) ? { arena: { claim: c.ac, auto: c.auto } } : {}),
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

// ---------------------------------------------------------------------------
// Arena challenge links: a finished Gauntlet or Cup packed into a link, the
// friend's run fixed to the same seed, rules and format, the claim verified
// by replaying it with the assistant when the assistant played every match.
// ---------------------------------------------------------------------------

/**
 * Pack a finished arena run into a challenge: the settings, every draft row
 * (bonus spins included, in order), the format, the training letter of each
 * step, the lifeline's rung, whether the assistant played it all, the claim.
 * Null until the run is over.
 */
export function arenaChallengeFromGame(game: Game, u: LoadedUniverse, name: string): ArenaChallengePayload | null {
  const a = game.arena
  const d = game.draft
  const s = game.settings
  if (!a?.over || !d || !s.arena || game.phase !== 'summary' || !a.log.length) return null
  const get = playerLookup(game, u)
  const f = s.arena.format
  return {
    v: 2,
    kind: 'arena',
    data: u.generatedAt,
    engine: ENGINE_VERSION,
    name,
    s: { seed: s.seed, f: s.formationId, l: s.leagueId, wl: s.wheelLeagues, h: s.hostClubId, ls: s.leagueSeason, d: s.difficulty ?? 'calibrated', r: rulesDiff(s.rules) },
    arena: { f, ...(f === 'cup' ? { n: s.arena.size ?? 2 } : {}), ...(s.arena.field && f === 'cup' ? { fd: s.arena.field } : {}), ...(s.arena.field === 'decade' && s.arena.decade !== undefined ? { dc: s.arena.decade } : {}), ...(s.arena.daily ? { dl: arenaDay(s.seed) } : {}) },
    p: picksFromHistory(d.history, (id) => get(id)?.playerId),
    t: a.log.map((x) => TRAINING_CODE[x.training]).join(''),
    ...(a.lifelineUsed !== undefined ? { lf: a.lifelineUsed } : {}),
    auto: !a.handManaged,
    ac: arenaClaimOf(a),
    k: historyKey(d.history),
  }
}

/** The settings an arena link fixes: every choice but the team name. A Daily Arena's link plays as an ordinary run on that seed, off the streak. */
export function settingsFromArenaChallenge(c: ArenaChallengePayload, teamName: string, shortName: string, challenge: ChallengeSettings): GameSettings {
  const f = c.arena.f
  return {
    mode: 'arena',
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
    continental: false,
    arena: { format: f, ...(f === 'cup' ? { size: (c.arena.n ?? 2) as 2 | 8 | 16 | 32 } : {}), ...(c.arena.fd ? { field: c.arena.fd } : {}), ...(c.arena.dc !== undefined ? { decade: c.arena.dc } : {}) },
    challenge,
  }
}

/** Replay the rows of the challenger's draft from `from` until the draft may close; returns the next row. */
function replayUntilClosed(u: LoadedUniverse, d: DraftState, rng: Rng, c: ArenaChallengePayload, from: number, out: ReplayedPick[]): number {
  let i = from
  while (!draftClosed(u, d)) {
    if (i >= c.p.length) throw new Error(`The draft stopped after ${d.history.filter((h) => h.pickedId).length} picks`)
    out.push(replayRow(u, d, rng, c.p[i], i + 1))
    i++
  }
  return i
}

/** The draft before the first match, for the ghost chips; empty when it does not replay. */
function firstDraftOnly(u: LoadedUniverse, c: ArenaChallengePayload, placeholder: ChallengeSettings): ReplayedPick[] {
  try {
    const game = createGame(settingsFromArenaChallenge(c, 'Ghost', 'GHO', placeholder))
    const picks: ReplayedPick[] = []
    replayUntilClosed(u, game.draft!, Rng.fromState(game.rngState), c, 0, picks)
    return picks
  } catch {
    return []
  }
}

/**
 * Replay an arena challenge: a fresh game from its settings, the draft to its
 * first close, `beginArena`, then step by step the training from `t`, the
 * lifeline at `lf` and the assistant's match (penalties with the default
 * takers), each bonus spin's rows through `spin`/`pick`, comparing every
 * step's score with the claim.
 *
 * - The assistant's run (`auto`): 'yes' when every figure matches, 'no' naming
 *   the first step that differs.
 * - A run managed by hand: 'hand' once the draft replays. Its ladder or draw
 *   comes from the seed's streams, so the friend meets the same sides, but
 *   its matches (and the bonus spins after them) are the challenger's word.
 * - Other data or another engine: 'unverified', with the first draft resolved.
 *
 * Nothing here throws.
 */
export function replayArenaChallenge(u: LoadedUniverse, c: ArenaChallengePayload): ReplayOutcome {
  const placeholder: ChallengeSettings = { name: c.name, picks: [], claim: mirrorClaim(c.ac), verified: 'unverified', data: c.data, engine: c.engine, arena: { claim: c.ac, auto: c.auto } }
  if (c.data !== u.generatedAt) return { verified: 'unverified', reason: `built on data from ${c.data}, this build has ${u.generatedAt}`, picks: firstDraftOnly(u, c, placeholder) }
  if (c.engine !== ENGINE_VERSION) return { verified: 'unverified', reason: `built with engine ${c.engine}, this build is ${ENGINE_VERSION}`, picks: firstDraftOnly(u, c, placeholder) }
  const game = createGame(settingsFromArenaChallenge(c, 'Ghost', 'GHO', placeholder))
  const picks: ReplayedPick[] = []
  let row = 0
  const draftRows = () => {
    const rng = Rng.fromState(game.rngState)
    row = replayUntilClosed(u, game.draft!, rng, c, row, picks)
    game.rngState = rng.getState()
  }
  try {
    draftRows()
  } catch (e) {
    return { verified: 'no', reason: e instanceof Error ? e.message : String(e), picks: [] }
  }
  if (!c.auto) return { verified: 'hand', reason: `managed by hand: the draft and the ${c.arena.f === 'gauntlet' ? 'ladder' : 'draw'} replay, the matches are ${c.name}'s word`, picks }
  try {
    beginArena(game, u)
    const a = game.arena!
    for (let i = 0; game.phase !== 'summary'; i++) {
      const claimed = c.ac.g[i]
      if (!claimed) return { verified: 'no', reason: `the run goes on past step ${c.ac.g.length}: the assistant wins step ${i}`, picks }
      game.training = trainingOfCode(c.t[i]) ?? game.training
      if (c.lf === i + 1 && !changeTheDraw(game, u).ok) return { verified: 'no', reason: `the lifeline could not be used at rung ${c.lf}`, picks }
      playArenaStep(game, u, false)
      const played = a.log[i]
      if (!played) return { verified: 'no', reason: `step ${i + 1} could not be played`, picks }
      if (!sameStep(played, claimed)) return { verified: 'no', reason: `step ${i + 1} (${played.label}) replays to ${stepText(claimStep(played))}, not ${stepText(claimed)}`, picks, arena: arenaClaimOf(a) }
      closeArenaMatch(game)
      if (game.phase === 'draft') {
        draftRows()
        beginArena(game, u)
      }
    }
    const result = arenaClaimOf(a)
    if (result.g.length !== c.ac.g.length) return { verified: 'no', reason: `the run ends after step ${result.g.length}, not ${c.ac.g.length}`, picks, arena: result }
    if (result.s !== c.ac.s || result.w !== c.ac.w) return { verified: 'no', reason: `the run replays to ${result.s} won, not ${c.ac.s}`, picks, arena: result }
    if (row !== c.p.length || historyKey(game.draft!.history) !== c.k) return { verified: 'no', reason: 'the wheel did not land on the same club-seasons', picks, arena: result }
    return { verified: 'yes', picks, arena: result }
  } catch (e) {
    return { verified: 'no', reason: `the run could not be replayed: ${e instanceof Error ? e.message : String(e)}`, picks }
  }
}

/** What the verification of an arena challenge says, for the setup banner and the summary. */
export function arenaVerifiedLine(ch: ChallengeSettings, format: 'cup' | 'gauntlet'): string {
  if (ch.verified === 'yes') return `Verified: ${ch.name}'s run, played by the assistant, replays step by step on this data.`
  if (ch.verified === 'hand') return `Managed by hand: the draft and the ${format === 'gauntlet' ? 'ladder' : 'draw'} replay, the matches are ${ch.name}'s word.`
  if (ch.verified === 'unverified') return `Unverified: ${ch.reason ?? 'built on different data'}.`
  return `Could not verify the claim: ${ch.reason ?? 'the run does not replay'}.`
}

/** Run it back: the same seed and rules again, your own finished run as the ghost (an assistant's run is your verified word on this device). */
export function runItBackArena(game: Game, u: LoadedUniverse): GameSettings | null {
  const a = game.arena
  const d = game.draft
  if (!a?.over || !d || !game.settings.arena) return null
  const claim = arenaClaimOf(a)
  return {
    ...game.settings,
    arena: { ...game.settings.arena, daily: undefined },
    challenge: {
      name: 'your ghost',
      picks: d.history.map((h) => ({ id: h.pickedId, slotId: h.pickedId ? h.slotId : null, clubId: h.clubId, season: h.season })),
      claim: mirrorClaim(claim),
      verified: a.handManaged ? 'hand' : 'yes',
      data: u.generatedAt,
      engine: ENGINE_VERSION,
      arena: { claim, auto: !a.handManaged },
    },
  }
}
