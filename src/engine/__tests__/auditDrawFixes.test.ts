/**
 * The r8 engine audit's fixes that move draws: each changes what a seed plays in the games it touches, so it waits for
 * the next ENGINE_VERSION. Reproduced here; the pins they move are listed in the audit's report.
 */
import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { BUDGET_FLOOR, CAP_AUTO_STRETCH, QUICK_RULES, assistantChoice, canBench, canSpin, canUse, capPrice, capSpent, fillingXI, isComplete, newDraft, openSlots, pick, spin, type DraftState } from '../draft'
import { getFormation } from '../formations'

describe('under a cap, the assistant spreads the money over the picks a bench draft still owes', () => {
  it('never takes a man dearer than twice an even share of what is left over the open XI slots, bench picks made or not', () => {
    const u = loadTestUniverse()
    let checked = 0
    const over: string[] = []
    for (let i = 0; i < 40; i++) {
      const d: DraftState = newDraft(getFormation('4-3-3'), { ...QUICK_RULES, benchPicks: 3, budget: 150 }, `cap-bench-${i}`)
      const rng = new Rng(`cap-bench-${i}`)
      let guard = 0
      while (!isComplete(d) && fillingXI(d) && guard++ < 60 && canSpin(u, d)) {
        const cs = spin(u, d, rng)
        // The first three picks go to the bench, as cheaply as the spin allows; the assistant fills the XI after
        if (d.bench.length < 3) {
          const cheap = cs.squad.filter((p) => canBench(d, p)).sort((a, b) => capPrice(a) - capPrice(b))[0]
          if (cheap) pick(u, d, cheap.id, 'bench')
          else d.current = null
          continue
        }
        const choice = assistantChoice(u, d, cs)
        if (!choice) {
          d.current = null
          continue
        }
        const p = u.index[choice.id]
        const share = (d.rules.budget! - capSpent(d)) / openSlots(d).length
        const usable = cs.squad.filter((x) => canUse(d, x))
        const within = usable.filter((x) => capPrice(x) <= share * CAP_AUTO_STRETCH)
        // Within the stretch, or the cheapest usable man on the spin when nobody is
        const ok = within.length ? within.some((x) => x.id === p.id) : capPrice(p) === Math.min(...usable.map((x) => capPrice(x)))
        if (!ok) over.push(`${i}: £${capPrice(p)}M with £${share.toFixed(1)}M for each of ${openSlots(d).length} open slots`)
        checked++
        pick(u, d, choice.id, choice.slot)
      }
      // The cap still holds for every open slot
      expect(capSpent(d) + BUDGET_FLOOR * Math.max(0, openSlots(d).length)).toBeLessThanOrEqual(d.rules.budget! + 1e-9)
    }
    expect(checked).toBeGreaterThan(100)
    expect(over).toEqual([])
  }, 120000)
})
