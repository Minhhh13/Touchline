/**
 * Engine 9, playtest round 2's P1: Auto-complete picks from the spin on the wheel. Before, the store logged the spin
 * showing as skipped and the assistant spun again, so a club the player had just landed (Brighton, in the playtest) was
 * thrown away. Now `autoDraft` makes it the assistant's first pick (`assistantChoice`, no draw) and discards it only when
 * nobody on it is usable.
 */
import { describe, expect, it } from 'vitest'
import { breathe, loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { assistantChoice, autoDraft, discardSpin, isComplete, newDraft, pick, QUICK_RULES, SEASON_RULES, spin, spinClubSeason, spinnableSlots, type DraftRules, type DraftState } from '../draft'
import { getFormation } from '../formations'
import { positionFactor } from '../positions'

const u = loadTestUniverse()

/** Position First: choose the first slot the wheel can fill, as the assistant does. */
function aim(d: DraftState): void {
  if (d.rules.draftMode === 'position' && !d.target) d.target = spinnableSlots(u, d)[0].id
}

function draft(rules: DraftRules, formation = '4-3-3'): DraftState {
  return newDraft(getFormation(formation), { ...rules, leagues: ['england'] })
}

/** The XI's mean overall in its slots (overall × the slot's position factor). */
function xiRating(d: DraftState): number {
  const slots = d.formation.slots
  const sum = slots.reduce((t, s) => {
    const p = u.index[d.lineup[s.id]]
    return t + (p ? p.overall * positionFactor(p, s.position) : 0)
  }, 0)
  return sum / slots.length
}

const VARIANTS: Array<[string, DraftRules, string]> = [
  ['quick', QUICK_RULES, '4-3-3'],
  ['quick position first', { ...QUICK_RULES, draftMode: 'position' }, '4-2-3-1'],
  ['quick bench', { ...QUICK_RULES, benchPicks: 3 }, '4-4-2'],
  ['season', SEASON_RULES, '4-3-3'],
]

describe('Auto-complete picks from the spin showing (engine 9, P1)', () => {
  it("takes the showing spin's best man as its first pick, exactly as picking him by hand then auto-completing", async () => {
    let picked = 0
    let discarded = 0
    for (let i = 0; i < 40; i++) {
      if (i % 10 === 0) await breathe()
      for (const [name, rules, formation] of VARIANTS) {
        const d = draft(rules, formation)
        const rng = new Rng(`p1-showing-${i}`)
        // A few picks in, so the spin lands on a part-made squad
        for (let k = 0; k < i % 5; k++) {
          aim(d)
          const cs = spin(u, d, rng)
          const best = assistantChoice(u, d, cs)
          if (best) pick(u, d, best.id, best.slot)
          else discardSpin(d)
        }
        aim(d)
        const shown = spin(u, d, rng)
        const rows = d.history.length
        const by = structuredClone(d)
        const byRng = Rng.fromState(rng.getState())
        autoDraft(u, d, rng)
        expect(isComplete(d), `${name} ${i}`).toBe(true)
        // The same draft as the assistant's pick by hand, then Auto-complete with nothing showing
        const best = assistantChoice(u, by, spinClubSeason(u, by)!)
        if (best) pick(u, by, best.id, best.slot)
        else discardSpin(by)
        autoDraft(u, by, byRng)
        expect(d, `${name} ${i}`).toEqual(by)
        expect(rng.getState()).toEqual(byRng.getState())
        // The showing spin's row: a pick when anyone on it was usable, never a skipped row otherwise
        const row = d.history[rows]
        expect(`${row.clubId}@${row.season}`).toBe(`${shown.clubId}@${shown.season}`)
        if (best) {
          expect(row.pickedId).toBe(best.id)
          expect(row.skipped).toBeUndefined()
          picked++
        } else {
          expect(row.skipped).toBe(true)
          discarded++
        }
      }
    }
    console.log(`P1: the showing spin picked ${picked}, discarded ${discarded} (engine 8 discarded all ${picked + discarded})`)
    // Almost every spin has someone the assistant takes
    expect(picked).toBeGreaterThan(0.9 * (picked + discarded))
  }, 120_000)

  it('drafts as strong an XI as discarding the spin did, over 200 drafts (reported)', async () => {
    let before = 0
    let after = 0
    let n = 0
    for (let i = 0; i < 50; i++) {
      if (i % 10 === 0) await breathe()
      for (const [, rules, formation] of VARIANTS) {
        const a = draft(rules, formation)
        const rng = new Rng(`p1-strength-${i}`)
        aim(a)
        spin(u, a, rng)
        const b = structuredClone(a)
        const rngB = Rng.fromState(rng.getState())
        autoDraft(u, a, rng)
        // Engine 8: the showing spin logged as skipped, then the assistant from a fresh spin
        discardSpin(b)
        autoDraft(u, b, rngB)
        after += xiRating(a)
        before += xiRating(b)
        n++
      }
    }
    console.log(`P1: XI mean in-slot rating over ${n} drafts with a spin showing: engine 8 ${(before / n).toFixed(2)}, engine 9 ${(after / n).toFixed(2)}`)
    // One pick from a given spin instead of a fresh one: the XI's strength barely moves either way
    expect(Math.abs(after - before) / n).toBeLessThan(1)
  }, 120_000)
})
