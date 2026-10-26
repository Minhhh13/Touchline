import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { assistantChoice, bestSlotFor, canSpin, eligibleSlots, isComplete, newDraft, pick, QUICK_RULES, spin, suggestSlot, type DraftState } from '../draft'
import { h2hAutoPick, h2hComplete, h2hPick, h2hSpin, h2hUsable, newH2HDraft, type H2HDraft } from '../h2h'
import { FORMATIONS, getFormation } from '../formations'
import { positionFactor } from '../positions'
import type { PlayerSeason } from '../types'

/**
 * TL-04: the assistant places a man where he plays best. The playtest's head-to-head (seed QEWA-3V9H) sent Grimes
 * (DM/CM, 76) to centre-back at 65 with both central midfield slots open, and finished with Van Dijk at left-back,
 * Aguero in midfield and two strikers on the wings: ENGINE_VERSION 4's head-to-head assistant took the highest overall
 * into the first eligible slot in formation order.
 */
const u = loadTestUniverse()
const RULES = { ...QUICK_RULES, respins: 0, leagues: ['england'], twists: false }
const shapes = FORMATIONS.map((f) => f.id)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** The slot the last pick filled, or null for the bench. */
function filled(before: DraftState, after: DraftState): { slot: DraftState['formation']['slots'][number]; p: PlayerSeason } | null {
  const slot = after.formation.slots.find((s) => after.lineup[s.id] && !before.lineup[s.id])
  return slot ? { slot, p: u.index[after.lineup[slot.id]] } : null
}

/** Whether that pick took a cover slot while a natural one for the same man was open. */
function wasted(before: DraftState, after: DraftState): boolean {
  const f = filled(before, after)
  if (!f || f.p.positions.includes(f.slot.position)) return false
  return eligibleSlots(before, f.p).some((s) => f.p.positions.includes(s.position))
}

/** The mean positional cost of an XI: 1 − positionFactor over its slots. */
const penalty = (d: DraftState) => {
  const xs = d.formation.slots.filter((s) => d.lineup[s.id]).map((s) => 1 - positionFactor(u.index[d.lineup[s.id]], s.position))
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
}

/** ENGINE_VERSION 4's head-to-head assistant, for comparison: the highest overall into the first eligible slot. */
function legacyAutoPick(h: H2HDraft): void {
  if (h.picking === null) return
  const d = h.drafts[h.picking]
  for (const p of h2hUsable(u, h).sort((a, b) => b.overall - a.overall)) {
    const slots = eligibleSlots(d, p)
    if (slots.length) return void h2hPick(u, h, p.id, slots[0].id)
    if (Object.keys(d.lineup).length >= d.formation.slots.length) return void h2hPick(u, h, p.id, 'bench')
  }
}

function h2hDraft(seed: string, shapesOf: [string, string], auto: (h: H2HDraft) => void, onPick?: (before: [DraftState, DraftState], h: H2HDraft) => void): H2HDraft {
  const rng = new Rng(seed)
  const h = newH2HDraft([getFormation(shapesOf[0]), getFormation(shapesOf[1])], RULES)
  while (!h2hComplete(h)) {
    h2hSpin(u, h, rng)
    for (let guard = 0; h.picking !== null && guard < 4; guard++) {
      const before = clone(h.drafts)
      auto(h)
      onPick?.(before, h)
    }
  }
  return h
}

describe('the assistant’s slot choice (TL-04)', { timeout: 300_000 }, () => {
  it('bestSlotFor: the natural slot first, then the scarcest open position, never a cover over an open natural slot', () => {
    const d = newDraft(getFormation('4-3-3'), RULES)
    const dmcm = { ...u.clubSeasonByKey['coventry-city@2026'].squad.find((p) => /Grimes/.test(p.name))! }
    expect(dmcm.positions).toEqual(['DM', 'CM'])
    // One DM slot and two CMs open: the lone DM, so the two CMs stay for the many who play there
    expect(bestSlotFor(d, dmcm)?.id).toBe('dm')
    expect(suggestSlot(d, dmcm)).toBe('dm')
    d.lineup.dm = 'someone'
    expect(bestSlotFor(d, dmcm)?.position).toBe('CM')
    d.lineup.cm1 = 'someone'
    d.lineup.cm2 = 'someone'
    // Only covers left: the best of them
    const cover = bestSlotFor(d, dmcm)
    expect(cover).not.toBeNull()
    const best = Math.max(...eligibleSlots(d, dmcm).map((s) => positionFactor(dmcm, s.position)))
    expect(positionFactor(dmcm, cover!.position)).toBe(best)
  })

  it('the playtest head-to-head: Grimes goes into midfield at his own rating', () => {
    const rng = new Rng('QEWA-3V9H')
    const h = newH2HDraft([getFormation('4-3-3'), getFormation('4-4-2')], RULES)
    h2hSpin(u, h, rng)
    const before = clone(h.drafts)
    h2hAutoPick(u, h)
    const f = filled(before[0], h.drafts[0])!
    expect(f.p.name).toBe('M. Grimes')
    expect(['DM', 'CM']).toContain(f.slot.position)
    expect(positionFactor(f.p, f.slot.position)).toBe(1)
  })

  it('never takes a cover slot while a natural one for the man is open: 160 head-to-heads and 160 Quick Drafts', () => {
    let picks = 0
    for (let i = 0; i < 160; i++) {
      h2hDraft(`fit-h2h-${i}`, [shapes[i % shapes.length], shapes[(i + 3) % shapes.length]], (h) => h2hAutoPick(u, h), (before, h) => {
        for (const k of [0, 1] as const) {
          expect(wasted(before[k], h.drafts[k])).toBe(false)
          if (filled(before[k], h.drafts[k])) picks++
        }
      })
      const rng = new Rng(`fit-quick-${i}`)
      const d = newDraft(getFormation(shapes[i % shapes.length]), { ...QUICK_RULES, leagues: ['england'] })
      for (let guard = 0; !isComplete(d) && guard < 200 && canSpin(u, d); guard++) {
        const choice = assistantChoice(u, d, spin(u, d, rng))
        if (!choice) {
          d.current = null
          d.twist = null
          continue
        }
        const before = clone(d)
        pick(u, d, choice.id, choice.slot)
        expect(wasted(before, d)).toBe(false)
        picks++
      }
    }
    expect(picks).toBeGreaterThan(5000)
  })

  it('cuts the head-to-head XI’s positional cost against ENGINE_VERSION 4’s first-slot assistant, over 120 drafts', () => {
    const mean = (auto: (h: H2HDraft) => void) => {
      let pen = 0
      let covers = 0
      let slots = 0
      for (let i = 0; i < 60; i++) {
        const h = h2hDraft(`fit-stats-${i}`, [shapes[i % shapes.length], shapes[(i + 5) % shapes.length]], auto)
        for (const d of h.drafts) {
          pen += penalty(d)
          covers += d.formation.slots.filter((s) => d.lineup[s.id] && !u.index[d.lineup[s.id]].positions.includes(s.position)).length
          slots += d.formation.slots.length
        }
      }
      return { pen: pen / 120, covers: covers / slots }
    }
    const before = mean(legacyAutoPick)
    const after = mean((h) => h2hAutoPick(u, h))
    console.log(`head-to-head XI: mean positional cost ${(100 * before.pen).toFixed(2)}% → ${(100 * after.pen).toFixed(2)}%, cover slots ${(100 * before.covers).toFixed(1)}% → ${(100 * after.covers).toFixed(1)}%`)
    expect(before.pen).toBeGreaterThan(0.03)
    expect(after.pen).toBeLessThan(0.005)
    expect(after.covers).toBeLessThan(0.03)
    expect(after.pen).toBeLessThan(before.pen / 10)
  })
})
