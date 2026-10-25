/**
 * Arena claims and the head-to-head around an arena challenge, pure: a run's
 * claim (rounds won, the trophy, every step's score), the verdict between two
 * runs (further first, then goal difference, then fewer conceded) and the
 * ghost's line on each step. No imports from the arena's logic, so `arena.ts`
 * (the share text) and `challenge.ts` (links and replay) both read it.
 */
import type { ArenaState, ArenaStep, ChallengeSettings, Game } from '../types'
import type { ArenaClaim, ArenaClaimStep, ChallengeClaim } from '@engine/challenge'
import { cupRoundName, roundTies } from '@engine/cup'
import { GAUNTLET_RUNGS } from '@engine/gauntlet'

/** A step of a run as a claim: the score, and the shoot-out when it was level. */
export function claimStep(s: Pick<ArenaStep, 'gf' | 'ga' | 'pens'>): ArenaClaimStep {
  return s.pens ? [s.gf, s.ga, s.pens.us, s.pens.them] : [s.gf, s.ga]
}

/** What a run claims: rounds won, the trophy (or the top of the ladder), every step's score. */
export function arenaClaimOf(a: Pick<ArenaState, 'log' | 'won'>): ArenaClaim {
  const g = a.log.map(claimStep)
  return { s: g.filter(claimWon).length, w: a.won, g }
}

/** Did a claimed step go the challenger's way (in 90 minutes or on penalties)? */
export function claimWon(g: ArenaClaimStep): boolean {
  return g[0] > g[1] || (g.length === 4 && g[2] > g[3])
}

/** The quick claim an arena challenge's `claim` mirrors, so every reader of `ChallengeSettings.claim` still finds numbers: `pts` is the rounds won. */
export function mirrorClaim(ac: ArenaClaim): ChallengeClaim {
  const won = ac.g.filter(claimWon).length
  return { pts: ac.s, w: won, d: 0, l: ac.g.length - won, t: 'MID_TABLE' }
}


export const sameStep = (row: ArenaStep, claim: ArenaClaimStep | undefined): boolean => !!claim && claimStep(row).join() === claim.join()
export const stepText = (g: ArenaClaimStep) => `${g[0]}-${g[1]}${g.length === 4 ? ` (${g[2]}-${g[3]} pens)` : ''}`


/** Steps won, goal difference and goals against over a claim: the verdict's three keys. */
function runKeys(ac: ArenaClaim): { s: number; gd: number; ga: number } {
  return { s: ac.s, gd: ac.g.reduce((t, g) => t + g[0] - g[1], 0), ga: ac.g.reduce((t, g) => t + g[1], 0) }
}

/** How a claim's run ended, in words for the verdict: `fell at rung 6`, `climbed all 15 rungs`, `lifted it`, `went out in the semi-final`. */
function runEnd(ac: ArenaClaim, format: 'cup' | 'gauntlet', size: number): string {
  if (format === 'gauntlet') return ac.w ? `climbed all ${GAUNTLET_RUNGS} rungs` : `fell at rung ${ac.g.length}`
  if (ac.w) return 'lifted it'
  const step = ac.g.length - 1
  return roundTies(size, step) === 1 ? 'lost the final' : `went out in the ${cupRoundName(size, step).name.toLowerCase()}`
}

/**
 * The head-to-head verdict of an arena challenge: further first, then goal
 * difference over the run, then fewer conceded. `⚔️ Climbed 9 rungs; Minh
 * fell at rung 6`, `⚔️ Both lifted it; Minh conceded fewer`.
 */
export function arenaVerdictLine(name: string, theirs: ArenaClaim, mine: ArenaClaim, format: 'cup' | 'gauntlet', size = 2): string {
  const t = runKeys(theirs)
  const m = runKeys(mine)
  const rungs = (n: number) => `${n} rung${n === 1 ? '' : 's'}`
  if (m.s !== t.s) {
    if (format === 'gauntlet') return m.s > t.s ? `⚔️ Climbed ${rungs(m.s)}; ${name} ${runEnd(theirs, format, size)}` : `⚔️ ${name} climbed ${rungs(t.s)}; you ${runEnd(mine, format, size)}`
    return m.s > t.s ? `⚔️ You ${runEnd(mine, format, size)}; ${name} ${runEnd(theirs, format, size)}` : `⚔️ ${name} ${runEnd(theirs, format, size)}; you ${runEnd(mine, format, size)}`
  }
  const both = format === 'gauntlet' ? (mine.w ? `Both climbed all ${GAUNTLET_RUNGS} rungs` : m.s ? `Both climbed ${rungs(m.s)}` : 'Both fell at rung 1') : mine.w ? 'Both lifted it' : `Both ${runEnd(mine, format, size)}`
  if (m.gd !== t.gd) return m.gd > t.gd ? `⚔️ ${both}; your goal difference was better` : `⚔️ ${both}; ${name}'s goal difference was better`
  if (m.ga !== t.ga) return m.ga < t.ga ? `⚔️ ${both}; you conceded fewer` : `⚔️ ${both}; ${name} conceded fewer`
  return `⚔️ ${both}; dead level with ${name}`
}

/** The verdict of a finished arena game played from a challenge, or null. */
export function arenaVerdictOf(game: Game): string | null {
  const ch = game.settings.challenge
  const a = game.arena
  if (!ch?.arena || !a?.over) return null
  return arenaVerdictLine(ch.name, ch.arena.claim, arenaClaimOf(a), a.format, a.size ?? 2)
}

/** The challenger on a step (0-based) of the friend's run: `Minh here: 2-1`, `Minh fell here: 1-2`, `Minh went no further`. */
export function ghostStepLine(ch: Pick<ChallengeSettings, 'name' | 'arena'> | undefined, step: number): string | null {
  const claim = ch?.arena?.claim
  if (!ch || !claim) return null
  const g = claim.g[step]
  if (!g) return `${ch.name} went no further`
  const won = claimWon(g)
  const last = step === claim.g.length - 1
  if (!won) return `${ch.name} fell here: ${stepText(g)}`
  return `${ch.name} here: ${stepText(g)}${last && claim.w ? ', the last step' : ''}`
}

/** A challenge in a few words for the Draft header: `12 pts`, `6 rungs`, `lifted it`. */
export function challengeHeadline(ch: Pick<ChallengeSettings, 'claim' | 'arena'>, format?: 'cup' | 'gauntlet'): string {
  if (!ch.arena) return `${ch.claim.pts} pts`
  if (format === 'gauntlet') return `${ch.arena.claim.s} rung${ch.arena.claim.s === 1 ? '' : 's'}`
  return ch.arena.claim.w ? 'lifted it' : `${ch.arena.claim.s} round${ch.arena.claim.s === 1 ? '' : 's'} won`
}

/** The challenger's run in one line for the challenge's setup: `Minh climbed 6 rungs, then fell at rung 7 (1-2)`, `Minh lifted it`. */
export function claimLine(name: string, claim: ArenaClaim, format: 'cup' | 'gauntlet', size = 2): string {
  const last = claim.g[claim.g.length - 1]
  const score = last ? ` (${stepText(last)})` : ''
  if (format === 'gauntlet') {
    if (claim.w) return `${name} climbed all ${GAUNTLET_RUNGS} rungs`
    if (!claim.s) return `${name} fell at rung 1${score}`
    return `${name} climbed ${claim.s} rung${claim.s === 1 ? '' : 's'}, then fell at rung ${claim.g.length}${score}`
  }
  return claim.w ? `${name} lifted it` : `${name} ${runEnd(claim, format, size)}${score}`
}
