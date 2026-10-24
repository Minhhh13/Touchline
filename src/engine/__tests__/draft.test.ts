import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, isComplete, newDraft, pick, QUICK_RULES, SEASON_RULES, spin, wheelPool, canUse, eligibleSlots } from '../draft'
import { getFormation } from '../formations'

describe('draft', () => {
  const u = loadTestUniverse()
  it('never spins a dead club-season and completes a quick XI', () => {
    const rng = new Rng('draft-1')
    const d = newDraft(getFormation('4-3-3'), QUICK_RULES)
    while (!isComplete(d)) {
      const cs = spin(u, d, rng)
      const usable = cs.squad.filter((p) => canUse(d, p))
      expect(usable.length).toBeGreaterThan(0)
      const p = usable.sort((a, b) => b.overall - a.overall)[0]
      const slot = eligibleSlots(d, p)[0]
      pick(u, d, p.id, slot.id)
    }
    expect(Object.keys(d.lineup).length).toBe(11)
    expect(new Set(d.takenPlayers).size).toBe(11)
    expect(new Set(d.usedClubSeasons).size).toBe(11)
  })
  it('auto-drafts a full season squad deterministically', () => {
    const a = newDraft(getFormation('4-2-3-1'), SEASON_RULES)
    const b = newDraft(getFormation('4-2-3-1'), SEASON_RULES)
    autoDraft(u, a, new Rng('auto'))
    autoDraft(u, b, new Rng('auto'))
    expect(isComplete(a)).toBe(true)
    expect(a.bench.length).toBe(7)
    expect(a.lineup).toEqual(b.lineup)
    expect(a.bench).toEqual(b.bench)
  })
  it('respects era and one-club filters', () => {
    const d = newDraft(getFormation('4-4-2'), { ...QUICK_RULES, fromSeason: 2016, onlyClub: 'liverpool' })
    const pool = wheelPool(u, d)
    expect(pool.length).toBeGreaterThan(5)
    for (const cs of pool) {
      expect(cs.clubId).toBe('liverpool')
      expect(cs.season).toBeGreaterThanOrEqual(2016)
    }
  })
})
