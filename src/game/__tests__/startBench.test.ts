/**
 * Engine 9, playtest round 2's P2: a Quick Draft bench man who outrates a starter in his slot starts at kick-off. The
 * playtest's assistant benched David Raya (88) and started Dúbravka (83) in goal: the bench is drafted once the XI is
 * full, so the better keeper came second. `quickXI` now ends with `startBetterBench`.
 */
import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, type DraftRules } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { ratingAt } from '@engine/positions'
import { eligibleReplacement } from '@engine/match'
import type { PlayerSeason } from '@engine/types'
import { createGame } from '../logic/setup'
import { quickXI, runQuickSeason, toKickoff } from '../logic/quick'
import { canPlayFor, startBetterBench } from '../logic/quickBench'
import { playerLookup } from '../logic/players'
import type { Game, GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function drafted(seed: string, rules: Partial<DraftRules>, formationId = '4-3-3'): Game {
  const s: GameSettings = { mode: 'quick', seed, formationId, teamName: 'Bench XI', shortName: 'BEN', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...QUICK_RULES, leagues: ['england'], ...rules }, jobSecurity: false, difficulty: 'calibrated', january: false }
  const g = createGame(s)
  const rng = Rng.fromState(g.rngState)
  autoDraft(u, g.draft!, rng)
  g.rngState = rng.getState()
  return g
}

const byId = (ids: string[]) => ids.map((id) => u.index[id]).filter(Boolean) as PlayerSeason[]

describe('a bench man who outrates a starter starts at kick-off (engine 9, P2)', () => {
  it('starts the better keeper of two and benches the other', () => {
    const keepers = u.clubSeasons.filter((cs) => cs.leagueId === 'england' && cs.season === 2025).flatMap((cs) => cs.squad).filter((p) => p.positions[0] === 'GK').sort((a, b) => ratingAt(b, 'GK') - ratingAt(a, 'GK'))
    const [better, worse] = [keepers[0], keepers[keepers.length - 1]]
    const formation = getFormation('4-3-3')
    const lineup = { [formation.slots[0].id]: worse.id }
    const out = startBetterBench(formation, lineup, ['x-unknown', better.id], (id) => u.index[id])
    expect(out.lineup[formation.slots[0].id]).toBe(better.id)
    expect(out.bench).toEqual(['x-unknown', worse.id])
    // Nobody better on the bench: nothing moves
    expect(startBetterBench(formation, out.lineup, out.bench, (id) => u.index[id])).toEqual(out)
  })

  it("leaves no bench man who outrates a starter where the draft's rules let him play, over 120 bench drafts", async () => {
    let swapped = 0
    let drafts = 0
    let gainSum = 0
    for (let i = 0; i < 40; i++) {
      if (i % 10 === 0) await breathe()
      for (const [rules, formationId] of [[{ benchPicks: 3 }, '4-3-3'], [{ benchPicks: 5 }, '4-2-3-1'], [{ benchPicks: 3, minFit: 'natural' as const }, '3-5-2']] as const) {
        const g = drafted(`p2-bench-${i}`, rules, formationId)
        const d = g.draft!
        const formation = getFormation(formationId)
        const { lineup, bench } = quickXI(g, u)
        // The same men, one place each
        expect([...Object.values(lineup), ...bench].sort()).toEqual([...Object.values(d.lineup), ...d.bench].sort())
        const canPlay = canPlayFor(g)
        for (const p of byId(bench)) {
          for (const slot of formation.slots) {
            if (!eligibleReplacement(p, slot.position) || !canPlay(p, slot.position)) continue
            expect(ratingAt(p, slot.position), `${p.name} at ${slot.id}`).toBeLessThanOrEqual(ratingAt(u.index[lineup[slot.id]], slot.position) + 1e-9)
          }
        }
        const before = formation.slots.reduce((t, s) => t + ratingAt(u.index[d.lineup[s.id]], s.position), 0)
        const after = formation.slots.reduce((t, s) => t + ratingAt(u.index[lineup[s.id]], s.position), 0)
        expect(after).toBeGreaterThanOrEqual(before)
        if (after > before) {
          swapped++
          gainSum += after - before
        }
        // Kick-off fields the same XI the season plays
        toKickoff(g, u)
        expect(g.lineup).toEqual(lineup)
        expect(g.bench).toEqual(bench)
        drafts++
      }
    }
    console.log(`P2: a bench man started in ${swapped} of ${drafts} assistant bench drafts, the XI's total in-slot rating up ${(gainSum / Math.max(1, swapped)).toFixed(1)} when he did`)
    expect(swapped).toBeGreaterThan(0)
  }, 180_000)

  it('moves nothing in a quick season without a bench', () => {
    for (const seed of ['p2-none-1', 'p2-none-2', 'p2-none-3']) {
      const g = drafted(seed, {})
      const { lineup, bench } = quickXI(g, u)
      expect(lineup).toEqual(g.draft!.lineup)
      expect(bench).toEqual([])
      toKickoff(g, u)
      runQuickSeason(g, u)
      expect(g.quickResult?.table.length).toBeGreaterThan(0)
      expect(playerLookup(g, u)(Object.values(lineup)[0])).toBeDefined()
    }
  })
})
