/**
 * Engine 9, playtest round 2's P3: the assistant's lineups put a natural in his position when one is in the XI. The
 * playtest saw Bruno Fernandes at DM (acc. −7) while Lukić, a natural DM, played CM (the Daily Arena), and Hazard at RW
 * (−5) with David Silva at LW (the Cup). Round 6's repair (`assistantLineup`) only looked at the men left out; it now
 * also swaps two men of the XI when the swap makes it stronger.
 */
import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { autoDraft, QUICK_RULES, SEASON_RULES } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { positionFactor } from '@engine/positions'
import { DEFAULT_ROLE, getRole } from '@engine/roles'
import { assistantLineup, autoPickLineup, roleRating } from '@engine/ratings'
import { defaultTactics } from '@engine/tactics'
import type { Formation, Lineup, PlayerSeason, Tactics } from '@engine/types'
import { beginSeason, createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'

const u = loadTestUniverse(['england'])

const slotScore = (p: PlayerSeason, slot: Formation['slots'][number], t: Tactics) => roleRating(p, getRole(t.roles[slot.id] ?? DEFAULT_ROLE[slot.position]), slot.position)
const total = (f: Formation, lineup: Lineup, t: Tactics) => f.slots.reduce((sum, s) => sum + slotScore(u.index[lineup[s.id]], s, t), 0)

/** Two men of the XI who would both gain from swapping: a cover in a slot whose position the other plays naturally. */
function swapLeft(f: Formation, lineup: Lineup, t: Tactics): boolean {
  return f.slots.some((s) => {
    const p = u.index[lineup[s.id]]
    if (positionFactor(p, s.position) >= 1) return false
    return f.slots.some((x) => {
      const r = u.index[lineup[x.id]]
      if (x.id === s.id || !r.positions.includes(s.position)) return false
      return slotScore(r, s, t) + slotScore(p, x, t) - slotScore(p, s, t) - slotScore(r, x, t) > 1e-9
    })
  })
}

/** A cover in a slot while the XI holds a natural for it elsewhere (what the playtest saw). */
function naturalElsewhere(f: Formation, lineup: Lineup): boolean {
  return f.slots.some((s) => positionFactor(u.index[lineup[s.id]], s.position) < 1 && f.slots.some((x) => x.id !== s.id && u.index[lineup[x.id]].positions.includes(s.position) && positionFactor(u.index[lineup[x.id]], x.position) < 1))
}

describe("the assistant's lineups put naturals in their positions (engine 9, P3)", () => {
  it('leaves no swap inside the XI that makes it stronger, never scores below the greedy, over 200 squads', async () => {
    let squads = 0
    let greedySwaps = 0
    let afterSwaps = 0
    let greedyNatural = 0
    let afterNatural = 0
    for (const formationId of ['4-3-3', '4-4-2', '3-5-2', '4-2-3-1', '5-3-2']) {
      const f = getFormation(formationId)
      const t = defaultTactics(formationId)
      for (let i = 0; i < 40; i++) {
        if (i % 10 === 0) await breathe()
        // Season squads (22 men) and Quick Draft squads with a bench, drafted by the assistant
        const season = i % 2 === 0
        const g = createGame({ mode: season ? 'season' : 'quick', seed: `p3-xi-${formationId}-${i}`, formationId, teamName: 'Test XI', shortName: 'TST', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'burnley', leagueSeason: 2025, rules: { ...(season ? SEASON_RULES : { ...QUICK_RULES, benchPicks: 5 }), leagues: ['england'] }, jobSecurity: false, difficulty: 'calibrated' })
        const rng = Rng.fromState(g.rngState)
        autoDraft(u, g.draft!, rng)
        const get = playerLookup(g, u)
        const pool = [...Object.values(g.draft!.lineup), ...g.draft!.bench].map((id) => get(id)!)
        const greedy = autoPickLineup(f, pool, t).lineup
        const mine = assistantLineup(f, pool, t).lineup
        expect(Object.keys(mine).length).toBe(f.slots.length)
        expect(new Set(Object.values(mine)).size).toBe(f.slots.length)
        expect(total(f, mine, t)).toBeGreaterThanOrEqual(total(f, greedy, t) - 1e-9)
        expect(swapLeft(f, mine, t), `p3-xi-${formationId}-${i}`).toBe(false)
        if (swapLeft(f, greedy, t)) greedySwaps++
        if (naturalElsewhere(f, greedy)) greedyNatural++
        if (naturalElsewhere(f, mine)) afterNatural++
        if (swapLeft(f, mine, t)) afterSwaps++
        squads++
        if (season) {
          // The hub's eleven is the assistant's
          beginSeason(g, u)
          expect(g.lineup).toEqual(assistantLineup(f, Object.keys(g.squad).map((id) => get(id)!), g.tactics, () => true, (id) => g.squad[id]).lineup)
        }
      }
    }
    console.log(`P3: ${squads} assistant squads; a swap inside the greedy's XI that helps: ${greedySwaps}, after the repair: ${afterSwaps}; two covers each in the other's natural slot: greedy ${greedyNatural}, after ${afterNatural}`)
    expect(afterSwaps).toBe(0)
  }, 240_000)

  it('is the greedy when every slot already holds a natural man, and the AI keeps the greedy', () => {
    const f = getFormation('4-3-3')
    const t = defaultTactics('4-3-3')
    let natural = 0
    for (const cs of u.clubSeasons.filter((c) => c.season === 2019)) {
      const greedy = autoPickLineup(f, cs.squad, t).lineup
      if (f.slots.some((s) => positionFactor(u.index[greedy[s.id]], s.position) < 1)) continue
      natural++
      expect(assistantLineup(f, cs.squad, t).lineup).toEqual(greedy)
    }
    expect(natural).toBeGreaterThan(5)
  })
})
