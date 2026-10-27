import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '@engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, canUse, eligibleSlots, pick, spin } from '@engine/draft'
import { RUN_IN_LEAGUES, RUN_IN_TEMPLATES } from '@engine/scenario'
import type { Game } from '../types'
import { createGame } from '../logic/setup'
import { beginRunIn, seedRunInDraft } from '../logic/runin'
import { decodeRunIn, encodeRunIn, replayRunIn, runInClaimOf, runInPayloadFromGame, runInReplayProblem, runInWeekKeyOfSeed, runInWeekSeed, sameRunInClaim, simRunIn, weeklyRunInJob, weeklyRunInPlan, weeklyRunInSettings } from '../logic/runinWeekly'
import { playMatchweek } from '../logic/week'

const u = loadTestUniverse(['england', 'spain', 'italy', 'germany'])

/** The store's run-in: createGame, the inherited squad, then the draft actions on `rngState`. */
function started(seed: string): Game {
  const s = weeklyRunInSettings(u, seed)
  if (!s) throw new Error(`no job for ${seed}`)
  const g = createGame(s)
  seedRunInDraft(g, u)
  return g
}

function draftBest(g: Game): void {
  const rng = Rng.fromState(g.rngState)
  const d = g.draft!
  while (d.history.filter((h) => h.pickedId).length < 4) {
    const cs = spin(u, d, rng)
    const best = cs.squad.filter((p) => canUse(d, p)).sort((a, b) => b.overall - a.overall)[0]
    if (!best) {
      d.history.push({ clubId: cs.clubId, season: cs.season, pickedId: null, slotId: null })
      d.current = null
      d.respinsLeft = Math.max(0, d.respinsLeft - 1)
      continue
    }
    pick(u, d, best.id, eligibleSlots(d, best)[0]?.id ?? 'bench')
  }
  g.rngState = rng.getState()
}

function draftAuto(g: Game): void {
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
}

function finish(g: Game): Game {
  beginRunIn(g, u)
  simRunIn(g, u)
  g.phase = 'summary'
  return g
}

describe('the Run-in of the week', { timeout: 120_000 }, () => {
  it('reads its seed and maps every week to a job in a run-in league', () => {
    expect(runInWeekSeed(new Date('2026-10-27T10:00:00Z'))).toBe('runin-2026-W44')
    expect(runInWeekKeyOfSeed('runin-2026-W44')).toBe('2026-W44')
    expect(runInWeekKeyOfSeed('runin-2026-W54')).toBeNull()
    expect(runInWeekKeyOfSeed('weekly-2026-W44')).toBeNull()
    const seen = new Set<string>()
    for (let w = 40; w <= 52; w++) {
      const seed = `runin-2026-W${w}`
      const plan = weeklyRunInPlan(seed)!
      expect(RUN_IN_LEAGUES).toContain(plan.leagueId)
      expect(RUN_IN_TEMPLATES).toContain(plan.template)
      const job = weeklyRunInJob(u, seed)
      expect(job, seed).not.toBeNull()
      expect(job!.leagueId).toBe(plan.leagueId)
      expect(job!.template).toBe(plan.template)
      seen.add(`${plan.leagueId}|${plan.template}`)
    }
    expect(seen.size).toBeGreaterThan(4)
  })

  it('needs only its own league: the same job on a universe of that league alone', () => {
    const seed = 'runin-2026-W44'
    const plan = weeklyRunInPlan(seed)!
    const alone = loadTestUniverse([plan.leagueId])
    expect(weeklyRunInSettings(alone, seed)).toEqual(weeklyRunInSettings(u, seed))
  })

  it("replays the assistant's run from the draft to the same table row, on the league's own universe too", () => {
    for (const seed of ['runin-2026-W44', 'runin-2026-W45']) {
      const g = finish((() => {
        const s = started(seed)
        draftBest(s)
        return s
      })())
      expect(runInReplayProblem(g, u)).toBeNull()
      const payload = runInPayloadFromGame(g, u, 'Minh')!
      expect(decodeRunIn(encodeRunIn(payload))).toEqual(payload)
      const alone = loadTestUniverse([weeklyRunInPlan(seed)!.leagueId])
      const again = replayRunIn(alone, weeklyRunInSettings(alone, seed)!, payload.p, payload.k)
      expect(sameRunInClaim(runInClaimOf(again)!, payload.c)).toBe(true)
    }
  })

  it('replays an auto-completed draft, and refuses a run-in managed by hand or a draft that is not the one played', () => {
    const auto = finish((() => {
      const s = started('runin-2026-W46')
      draftAuto(s)
      return s
    })())
    expect(runInReplayProblem(auto, u)).toBeNull()

    // By hand: a different shape's tactics for the run before the assistant takes over
    const hand = started('runin-2026-W46')
    draftAuto(hand)
    beginRunIn(hand, u)
    hand.tactics = { ...hand.tactics, mentality: hand.tactics.mentality === 'attacking' ? 'defensive' : 'attacking', pressing: 'high', tempo: 'fast' }
    playMatchweek(hand, u, false)
    if (hand.phase === 'match') hand.phase = 'week'
    simRunIn(hand, u)
    hand.phase = 'summary'
    const handClaim = runInClaimOf(hand)!
    if (!sameRunInClaim(handClaim, runInClaimOf(auto)!)) expect(runInReplayProblem(hand, u)).toMatch(/Managed by hand/)

    const payload = runInPayloadFromGame(auto, u, 'x')!
    const s = weeklyRunInSettings(u, 'runin-2026-W46')!
    expect(() => replayRunIn(u, s, payload.p.slice(1), payload.k)).toThrow()
    expect(() => replayRunIn(u, s, [[null, null], [null, null], ...payload.p], payload.k)).toThrow()
  })

  it('a run-in saved before the draft rows were kept loads and says why it is not on the board', () => {
    const g = finish((() => {
      const x = started('runin-2026-W44')
      draftAuto(x)
      return x
    })())
    const old = structuredClone(g)
    delete old.runInDraft
    expect(runInPayloadFromGame(old, u, 'x')).toBeNull()
    expect(runInReplayProblem(old, u)).toMatch(/before the game kept its draft/)
    expect(runInClaimOf(old)).toEqual(runInClaimOf(g))
  })

    it('refuses a malformed payload', () => {
    expect(() => decodeRunIn('eyJ2IjoyfQ')).toThrow()
    expect(() => decodeRunIn('!!!')).toThrow()
  })
})
