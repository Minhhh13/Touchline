import { describe, expect, it } from 'vitest'
import { fitGroups, fitsFirst, slotLabelText } from '../draftFit'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { Rng } from '@engine/rng'
import { assistantChoice, newDraft, pick, QUICK_RULES, spin, spinClubSeason, type DraftRules } from '@engine/draft'
import { getFormation } from '@engine/formations'
import { draftSlotChoices } from '@game/logic/slotSheet'

describe('fitGroups: a draft row’s fits and covers apart', () => {
  it('splits a midfielder’s own positions from the centre-back slot he only covers', () => {
    expect(fitGroups({ positions: ['CM', 'DM'] }, ['CB', 'CB', 'DM', 'CM', 'CM'])).toEqual({ fits: ['DM', 'CM'], covers: ['CB'] })
  })
  it('a player who only covers gets no "fits" chip, and one who fits everything no cover chip', () => {
    expect(fitGroups({ positions: ['RB'] }, ['CB']).fits).toEqual([])
    expect(fitGroups({ positions: ['GK'] }, ['GK']).covers).toEqual([])
  })
})

describe('fitsFirst: the slot chips lead with the slots he fits', () => {
  it('is a stable partition: fits in their order, then covers in theirs', () => {
    const c = [{ id: 'lw', fit: 'can cover' }, { id: 'st', fit: 'fits' }, { id: 'rw', fit: 'can cover' }, { id: 'st2', fit: 'fits' }]
    expect(fitsFirst(c).map((x) => x.id)).toEqual(['st', 'st2', 'lw', 'rw'])
    expect(c.map((x) => x.id)).toEqual(['lw', 'st', 'rw', 'st2'])
  })
  it('over real seeded drafts it reorders the logic’s choices and never adds or drops one', () => {
    const u = loadTestUniverse(['england'])
    const rules: DraftRules = { ...QUICK_RULES, leagues: ['england'] }
    let checked = 0
    for (const seed of ['fits-first-a', 'fits-first-b', 'fits-first-c']) {
      const d = newDraft(getFormation('4-3-3'), rules, seed)
      const rng = new Rng(seed)
      for (let i = 0; i < 6; i++) {
        spin(u, d, rng)
        const cs = spinClubSeason(u, d)!
        for (const p of cs.squad) {
          const choices = draftSlotChoices(d, p)
          const ordered = fitsFirst(choices)
          expect([...ordered].sort((a, b) => a.slotId.localeCompare(b.slotId))).toEqual([...choices].sort((a, b) => a.slotId.localeCompare(b.slotId)))
          const firstCover = ordered.findIndex((x) => x.fit !== 'fits')
          if (firstCover >= 0) expect(ordered.slice(firstCover).every((x) => x.fit !== 'fits')).toBe(true)
          checked++
        }
        const best = assistantChoice(u, d, cs)!
        pick(u, d, best.id, best.slot)
      }
    }
    expect(checked).toBeGreaterThan(200)
  })
})

describe('slotLabelText: a slot chip leads with a capital', () => {
  it('capitalises the first letter only, over real seeded drafts’ slot choices', () => {
    expect(slotLabelText('left CM')).toBe('Left CM')
    expect(slotLabelText('ST')).toBe('ST')
    expect(slotLabelText('')).toBe('')
    const u = loadTestUniverse(['england'])
    const rules: DraftRules = { ...QUICK_RULES, leagues: ['england'] }
    let seen = 0
    for (const seed of ['slot-label-a', 'slot-label-b']) {
      const d = newDraft(getFormation('4-4-2'), rules, seed)
      const rng = new Rng(seed)
      spin(u, d, rng)
      for (const p of spinClubSeason(u, d)!.squad) {
        for (const c of draftSlotChoices(d, p)) {
          const shown = slotLabelText(c.label)
          expect(shown.toLowerCase()).toBe(c.label.toLowerCase())
          expect(shown[0]).toBe(shown[0].toUpperCase())
          seen++
        }
      }
    }
    expect(seen).toBeGreaterThan(10)
  })
})
