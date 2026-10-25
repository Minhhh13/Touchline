import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, canCloseBench, canSpin, chooseSlot, closeBench, isComplete, pick, positionFirst, QUICK_RULES, respin, spin, spinClubSeason, spinnableSlots, targetSlot, withDifficulty, type DraftRules, type DraftState } from '@engine/draft'
import { withModes } from '@engine/modes'
import { canArmband, canLock, canPeek, canReroll, canSwap, giveArmband, lockPlayer, peekNext, rerollSeason, swapSlots, swapTargets, usePeek } from '@engine/powerups'
import { canUpgrade, upgradeCandidates, upgradePlayer } from '@engine/upgrader'
import { decodeChallenge, encodeChallenge } from '@engine/challenge'
import { createGame } from '../logic/setup'
import { challengeFromGame, replayChallenge } from '../logic/challenge'
import { kickOff, toKickoff } from '../logic/quick'
import type { Game } from '../types'

const u = loadTestUniverse(['england'])
const easy = withDifficulty(QUICK_RULES, 'easy')
const VARIANTS: Array<[string, DraftRules]> = [
  ['plain', QUICK_RULES],
  ['crazy', withModes(easy, ['crazy'])],
  ['gamble', withModes(QUICK_RULES, ['gamble'])],
  ['position first', { ...easy, draftMode: 'position' }],
  ['bench', { ...easy, benchPicks: 3 }],
  ['position first, bench, prime, crazy', withModes({ ...easy, draftMode: 'position', benchPicks: 2, ratings: 'prime' }, ['crazy'])],
]

/** One of the game's own streams, the way the store's spin and re-spin use it. */
function withMain(g: Game, fn: (rng: Rng) => void): void {
  const rng = Rng.fromState(g.rngState)
  fn(rng)
  g.rngState = rng.getState()
}

function randomSwap(d: DraftState, ch: Rng): void {
  const from = ch.pick(Object.keys(d.lineup).filter((s) => swapTargets(u, d, s).length))
  swapSlots(u, d, from, ch.pick(swapTargets(u, d, from)))
}

/** A draft that uses the power-ups at random moments (a chooser stream decides), with re-spins and an early bench close. */
function playRandomly(seed: string, base: DraftRules): Game {
  const ch = new Rng(`chooser:${seed}`)
  const g = createGame({ mode: 'quick', seed, formationId: '4-3-3', teamName: 'Fuzz XI', shortName: 'FUZ', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...base, leagues: ['england'], powerUps: true }, jobSecurity: false, difficulty: 'calibrated', january: false })
  const d = g.draft!
  let guard = 0
  while (!isComplete(d) && guard++ < 80) {
    if (!d.current) {
      if (positionFirst(d) && !targetSlot(d)) chooseSlot(u, d, ch.pick(spinnableSlots(u, d)).id)
      if (ch.chance(0.3) && canSwap(u, d)) randomSwap(d, ch)
      if (positionFirst(d) && !targetSlot(d)) chooseSlot(u, d, ch.pick(spinnableSlots(u, d)).id)
      let peeked: { clubId: string; season: number } | null = null
      if (ch.chance(0.2) && canPeek(u, d)) {
        peeked = peekNext(u, d, g.rngState)
        usePeek(u, d, g.rngState)
      }
      if (canCloseBench(d) && ch.chance(0.3)) break
      if (!canSpin(u, d)) break
      withMain(g, (rng) => spin(u, d, rng))
      // A peek always shows where the spin then lands
      if (peeked) expect(d.current).toEqual(peeked)
    }
    if (ch.chance(0.3) && canReroll(u, d)) rerollSeason(u, d)
    if (d.respinsLeft > 0 && ch.chance(0.15)) {
      withMain(g, (rng) => respin(u, d, rng))
      continue
    }
    if (canCloseBench(d) && ch.chance(0.2)) break
    const best = assistantChoice(u, d, spinClubSeason(u, d)!)!
    pick(u, d, best.id, best.slot)
    if (ch.chance(0.1) && canLock(d)) lockPlayer(d, ch.pick(upgradeCandidates(d)))
    if (ch.chance(0.1) && canArmband(d)) giveArmband(d, ch.pick(upgradeCandidates(d)))
    if (ch.chance(0.08) && canUpgrade(d)) upgradePlayer(u, d, ch.pick(upgradeCandidates(d)), ch.pick([2, 5, 10]))
  }
  if (ch.chance(0.3) && canSwap(u, d)) randomSwap(d, ch)
  if (canCloseBench(d)) closeBench(d)
  toKickoff(g, u)
  kickOff(g, u, true)
  return g
}

describe('power-ups: drafts that use them at random moments', () => {
  for (const [name, base] of VARIANTS) {
    it(`replay verified from their links (${name})`, () => {
      for (let s = 0; s < 4; s++) {
        const g = playRandomly(`PU-FUZZ-${name}-${s}`, base)
        const c = challengeFromGame(g, u, 'Fuzz')
        expect(c).not.toBeNull()
        const out = replayChallenge(u, decodeChallenge(encodeChallenge(c!)))
        expect(out.reason).toBeUndefined()
        expect(out.verified).toBe('yes')
      }
    })
  }
})
