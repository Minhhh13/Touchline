import type { ChallengeSettings, Game, GameSettings } from '../types'
import type { LoadedUniverse } from '@engine/universe'
import { Rng } from '@engine/rng'
import { ENGINE_VERSION } from '@engine/version'
import { CHALLENGE_TACTIC_VALUES, encodeChallenge, historyKey, picksFromHistory, replayDraft, rulesDiff, rulesFromPayload, sameClaim, type ChallengeClaim, type ChallengePayload, type ChallengeSeason, type ChallengeTactics, type ReplayedPick } from '@engine/challenge'
import type { Tactics } from '@engine/types'
import { defaultTactics } from '@engine/tactics'
import { createGame } from './setup'
import { closeJanuary, openJanuary, runQuickSeason } from './quick'
import { playerLookup } from './players'
import { upgradePlayer } from '@engine/upgrader'
import { giveArmband, lockPlayer } from '@engine/powerups'
import type { ChallengePowerUp } from '@engine/challenge'
import type { DraftState } from '@engine/draft'

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
    // The friend's own season may stop for the window too; the challenger's deal travels in the link
    january: true,
    challenge,
  }
}

const INSTRUCTIONS = Object.keys(CHALLENGE_TACTIC_VALUES) as Array<keyof typeof CHALLENGE_TACTIC_VALUES>

/** The instructions, captain and penalty taker that differ from `defaultTactics`, or undefined when none do. */
export function tacticsDiff(t: Tactics, captainId: string | undefined): ChallengeTactics | undefined {
  const base = defaultTactics(t.formationId)
  const out: ChallengeTactics = {}
  for (const k of INSTRUCTIONS) if (t[k] !== base[k]) (out as Record<string, string>)[k] = t[k]
  if (captainId) out.captain = captainId
  if (t.setPieces?.penalties) out.penalties = t.setPieces.penalties
  return Object.keys(out).length ? out : undefined
}

/** Put a link's instructions on a game: the defaults, the instructions it names, its captain and penalty taker. */
export function applyTactics(game: Game, t: ChallengeTactics | undefined): void {
  const base = defaultTactics(game.tactics.formationId)
  game.tactics = { ...base, ...Object.fromEntries(INSTRUCTIONS.flatMap((k) => (t?.[k] ? [[k, t[k]]] : []))), ...(t?.penalties ? { setPieces: { penalties: t.penalties } } : {}) }
  if (t?.captain) game.captainId = t.captain
  else delete game.captainId
}

/** The season block of a finished quick game: the tactics of each half, the January deal and the bench changes, or undefined for a default season. */
export function seasonOf(game: Game): ChallengeSeason | undefined {
  const j = game.quickJanuary && game.quickJanuary.move !== undefined ? game.quickJanuary : null
  const now = tacticsDiff(game.tactics, game.captainId)
  const first = j ? tacticsDiff(j.firstHalfTactics, j.firstHalfCaptainId) : now
  const changed = !!j && JSON.stringify(first ?? {}) !== JSON.stringify(now ?? {})
  const x: ChallengeSeason = {
    ...(first ? { t: first } : {}),
    // A second half that differs from the first, defaults included, is written even when it is all defaults
    ...(changed ? { t2: now ?? {} } : {}),
    ...(j?.move ? { j: [j.move.playerSeasonId, j.move.slotId] as [string, string] } : {}),
    ...(game.quickChanges?.length ? { s: game.quickChanges.map((c) => [c.from, c.slotId, c.inId] as [number, string, string]) } : {}),
  }
  return Object.keys(x).length ? x : undefined
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
  const x = seasonOf(game)
  const upgraded = d.upgrade ? d.history.findIndex((h) => h.pickedId === d.upgrade!.id) : -1
  const w = powerUpRows(d)
  return {
    v: 1,
    data: u.generatedAt,
    engine: ENGINE_VERSION,
    name,
    s: { seed: s.seed, f: s.formationId, l: s.leagueId, wl: s.wheelLeagues, h: s.hostClubId, ls: s.leagueSeason, d: s.difficulty ?? 'calibrated', r: rulesDiff(s.rules) },
    p: picksFromHistory(d.history, (id) => get(id)?.playerId),
    c: claim,
    k: historyKey(d.history),
    ...(x ? { x } : {}),
    ...(upgraded >= 0 && d.upgrade ? { g: [upgraded, d.upgrade.boost] as [number, number] } : {}),
    ...(w.length ? { w } : {}),
  }
}

/** The power-ups a draft used as link rows (`ChallengePayload.w`): the armband and the lock by the row of the pick. */
function powerUpRows(d: DraftState): ChallengePowerUp[] {
  const rowOf = (id: string) => d.history.findIndex((h) => h.pickedId === id)
  return (d.powerUps ?? []).flatMap((x): ChallengePowerUp[] => {
    switch (x.kind) {
      case 'reroll':
        return [['r', x.at]]
      // A peek no spin followed (the bench closed while it showed) changed nothing, and has no row to name
      case 'peek':
        return x.at < d.history.length ? [['p', x.at]] : []
      case 'swap':
        return [['s', x.at, x.from, x.to]]
      case 'armband':
        return rowOf(x.id) >= 0 ? [['a', rowOf(x.id)]] : []
      case 'lock':
        return rowOf(x.id) >= 0 ? [['l', rowOf(x.id)]] : []
    }
  })
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
    // The Lock comes before the Upgrader (it changes what a loss costs); the armband any time
    const pickAt = (row: number) => {
      const id = picks[row]?.id
      if (!id) throw new Error(`Spin ${row + 1} drafted no one to give a power-up to`)
      return id
    }
    for (const x of c.w ?? []) if (x[0] === 'l') lockPlayer(game.draft!, pickAt(x[1]))
    // The Player Upgrader: the same player and boost; its roll comes from the draft's own stream, so it lands the same
    if (c.g) {
      const id = picks[c.g[0]]?.id
      if (!id) throw new Error(`Spin ${c.g[0] + 1} drafted no one to upgrade`)
      upgradePlayer(u, game.draft!, id, c.g[1])
    }
    for (const x of c.w ?? []) if (x[0] === 'a') giveArmband(game.draft!, pickAt(x[1]))
  } catch (e) {
    return { verified: 'no', reason: e instanceof Error ? e.message : String(e), picks: [] }
  }
  try {
    playSeason(game, u, c.x)
  } catch (e) {
    return { verified: 'no', reason: `the season could not be replayed: ${e instanceof Error ? e.message : String(e)}`, picks }
  }
  const result = claimOf(game)
  if (!result) return { verified: 'no', reason: 'the season produced no result', picks }
  if (!sameClaim(result, c.c)) return { verified: 'no', reason: `the picks replay to ${result.pts} points (${result.w}-${result.d}-${result.l}), not ${c.c.pts}`, picks, result }
  return { verified: 'yes', picks, result }
}

/**
 * The challenger's season from a link's `x`: the first-half tactics and the bench changes, then, when the link names a second half or a
 * January deal, the window opened, the second-half tactics set and the deal found among the listings (a deal that was
 * not on offer throws), else the season in one go.
 */
function playSeason(game: Game, u: LoadedUniverse, x: ChallengeSeason | undefined): void {
  applyTactics(game, x?.t)
  // The bench changes travel as made; the season applies each at its matchweek (one that does not fit throws)
  if (x?.s?.length) game.quickChanges = x.s.map(([from, slotId, inId]) => ({ from, slotId, inId }))
  if (!x?.t2 && !x?.j) {
    runQuickSeason(game, u)
    return
  }
  openJanuary(game, u)
  if (x.t2) applyTactics(game, x.t2)
  let index: number | null = null
  if (x.j) {
    const [id, slotId] = x.j
    index = game.quickJanuary!.listings.findIndex((l) => l.playerSeasonId === id && l.slotId === slotId)
    if (index < 0) throw new Error('the January deal was not on offer')
  }
  closeJanuary(game, u, index)
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
