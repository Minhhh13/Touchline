/**
 * The r8 engine audit's PERF changes leave every output as it was: the draft's usability pass (built once per pass,
 * position cover cached as bits), the spin weights and the AI's lineup order are checked here against the logic they
 * replaced, written out in full, over many seeded states. The pins, noMove, dailyPin and marketPin suites cover the
 * same changes end to end.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { QUICK_RULES, SEASON_RULES, affordable, autoDraft, canSpin, canUse, fillingXI, isComplete, nationAllows, newDraft, openSlots, pick, assistantChoice, spin, spinWeight, targetSlot, positionFirst, spinnableSlots, type DraftRules, type DraftState } from '../draft'
import { FORMATIONS, getFormation } from '../formations'
import { defaultTactics } from '../tactics'
import { ACCOMPLISHED_FACTOR, canCover, positionFactor } from '../positions'
import { autoPickLineup, liveModifiers, roleRating } from '../ratings'
import { DEFAULT_ROLE, getRole } from '../roles'
import { aiClubOf } from '../season'
import type { ClubSeason, Formation, Lineup, PlayerSeason, Tactics } from '../types'
import type { LoadedUniverse } from '../universe'

/** `canUse` as it was before the audit: every check per player, the open slots and the cover worked out each time. */
function oldCanUse(d: DraftState, p: PlayerSeason): boolean {
  if (d.takenPlayers.includes(p.playerId)) return false
  const floor = d.ageFloor?.[p.playerId]
  if (floor !== undefined && p.age < floor) return false
  if (!nationAllows(d, p)) return false
  if (d.rules.chain && d.chainMates && !new Set(d.chainMates).has(p.playerId)) return false
  if (!affordable(d, p)) return false
  const t = targetSlot(d)
  const slots = t ? [t] : openSlots(d)
  if (fillingXI(d)) return slots.some((s) => canCover(p, s.position, d.rules.minFit))
  return true
}

function oldSpinWeight(d: DraftState, cs: ClubSeason): number {
  const quality = cs.position > 0 ? 1 + 0.06 * (21 - cs.position) : 1.6
  return quality * (1 + Math.min(10, cs.squad.filter((p) => oldCanUse(d, p)).length) / 10)
}

/** `autoPickLineup` as it was before the audit: the natural counts recomputed inside the sort's comparator. */
function oldAutoPick(formation: Formation, pool: PlayerSeason[], tactics: Tactics): { lineup: Lineup; bench: string[] } {
  const available = pool
  const lineup: Lineup = {}
  const used = new Set<string>()
  const slots = [...formation.slots].sort((a, b) => {
    const na = available.filter((p) => p.positions.includes(a.position)).length
    const nb = available.filter((p) => p.positions.includes(b.position)).length
    if (a.position === 'GK') return -1
    if (b.position === 'GK') return 1
    return na - nb
  })
  for (const pass of [ACCOMPLISHED_FACTOR, 0]) {
    for (const slot of slots) {
      if (lineup[slot.id]) continue
      const role = getRole(tactics.roles[slot.id] ?? DEFAULT_ROLE[slot.position])
      let best: PlayerSeason | undefined
      let bestScore = -1
      for (const p of available) {
        if (used.has(p.id)) continue
        if (positionFactor(p, slot.position) < pass) continue
        const mods = liveModifiers(undefined)
        const score = roleRating(p, role, slot.position) * mods.condition * mods.sharpness
        if (score > bestScore) {
          bestScore = score
          best = p
        }
      }
      if (best) {
        lineup[slot.id] = best.id
        used.add(best.id)
      }
    }
  }
  const bench = available
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 9)
    .map((p) => p.id)
  return { lineup, bench }
}

/** Drive a draft by the assistant, checking every squad on every spin against the old usability rule. */
function checkDraft(u: LoadedUniverse, rules: DraftRules, formation: string, seed: string, spinsChecked = { n: 0 }): void {
  const d = newDraft(getFormation(formation), rules, seed)
  const rng = new Rng(seed)
  let guard = 0
  while (!isComplete(d) && guard++ < 60 && canSpin(u, d)) {
    if (positionFirst(d) && !targetSlot(d)) d.target = spinnableSlots(u, d)[0].id
    const cs = spin(u, d, rng)
    for (const p of cs.squad) expect(canUse(d, p)).toBe(oldCanUse(d, p))
    expect(spinWeight(d, cs)).toBe(oldSpinWeight(d, cs))
    spinsChecked.n++
    const best = assistantChoice(u, d, cs)
    if (best) pick(u, d, best.id, best.slot)
    else {
      d.history.push({ ...d.current!, pickedId: null, slotId: null, skipped: true })
      d.current = null
      d.twist = null
    }
  }
}

describe('the audit PERF changes are byte-identical', () => {
  const u = loadTestUniverse(['england', 'spain', 'germany'])

  it('canUse and spinWeight agree with the old per-player checks over 120 seeded drafts of every kind', () => {
    const variants: Array<[DraftRules, string]> = [
      [QUICK_RULES, '4-3-3'],
      [SEASON_RULES, '4-2-3-1'],
      [{ ...QUICK_RULES, budget: 120 }, '4-4-2'],
      [{ ...QUICK_RULES, chain: true, leagues: ['england'] }, '4-3-3'],
      [{ ...QUICK_RULES, onlyNation: 'BRA' }, '4-3-3'],
      [{ ...QUICK_RULES, draftMode: 'position' }, '3-5-2'],
      [{ ...QUICK_RULES, benchPicks: 3, budget: 150 }, '4-1-4-1'],
      [{ ...QUICK_RULES, minFit: 'natural' }, '5-3-2'],
      [{ ...QUICK_RULES, minFit: 'awkward', modes: ['underdog'] }, '4-4-2-diamond'],
      [{ ...SEASON_RULES, onlyClub: 'arsenal' }, '3-4-3'],
      [{ ...QUICK_RULES, modes: ['crazy', 'gamble'] }, '4-3-3'],
      [{ ...QUICK_RULES, ratings: 'prime', modes: ['legends'] }, '4-2-3-1'],
    ]
    const spins = { n: 0 }
    variants.forEach(([rules, formation], v) => {
      for (let i = 0; i < 10; i++) checkDraft(u, rules, formation, `audit-perf-${v}-${i}`, spins)
    })
    expect(spins.n).toBeGreaterThan(1000)
  }, 180000)

  it('a Dynasty-style age floor reads the same', () => {
    const d = newDraft(getFormation('4-3-3'), SEASON_RULES, 'floor')
    const someone = u.clubSeasons[40].squad
    d.ageFloor = Object.fromEntries(someone.map((p) => [p.playerId, p.age + 1]))
    autoDraft(u, d, new Rng('floor'))
    for (const cs of u.clubSeasons.slice(0, 200)) for (const p of cs.squad) expect(canUse(d, p)).toBe(oldCanUse(d, p))
  })

  it('autoPickLineup picks the same XI and bench as the comparator that counted every time, over every England club-season', () => {
    let n = 0
    for (const cs of u.clubSeasons.filter((x) => x.leagueId === 'england' && x.squad.length >= 11)) {
      const club = aiClubOf(u, cs)
      const formation = getFormation(club.tactics.formationId)
      const pool = club.squad.map((id) => u.index[id])
      expect(autoPickLineup(formation, pool, club.tactics)).toEqual(oldAutoPick(formation, pool, club.tactics))
      n++
      // Every shape, not only the styles' own, on a slice of the club-seasons
      if (n % 10 === 0) {
        for (const f of FORMATIONS) {
          const t = defaultTactics(f.id)
          expect(autoPickLineup(f, pool, t)).toEqual(oldAutoPick(f, pool, t))
        }
      }
    }
    expect(n).toBeGreaterThan(300)
  }, 120000)
})
