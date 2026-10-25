import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from './helpers'
import { Rng } from '../rng'
import { autoDraft, canSpin, isComplete, newDraft, pick, QUICK_RULES, SEASON_RULES, spin, wheelPool, canUse, eligibleSlots } from '../draft'
import { getFormation } from '../formations'
import { canCover } from '../positions'

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

describe('one-nation draft', () => {
  const u = loadTestUniverse(['england', 'spain'])
  const rules = { ...QUICK_RULES, onlyNation: 'BRA' }

  it('drafts only Brazilians, keeps the wheel alive and completes a 4-3-3 across 20 seeds', () => {
    for (let i = 0; i < 20; i++) {
      const d = newDraft(getFormation('4-3-3'), rules)
      const rng = new Rng(`one-nation-${i}`)
      while (!isComplete(d)) {
        expect(canSpin(u, d)).toBe(true)
        const cs = spin(u, d, rng)
        const usable = cs.squad.filter((p) => canUse(d, p))
        expect(usable.length).toBeGreaterThan(0)
        for (const p of cs.squad) if (p.nationality !== 'BRA') expect(canUse(d, p)).toBe(false)
        const p = usable.sort((a, b) => b.overall - a.overall)[0]
        pick(u, d, p.id, eligibleSlots(d, p)[0].id)
      }
      expect(isComplete(d)).toBe(true)
      for (const id of Object.values(d.lineup)) expect(u.index[id].nationality).toBe('BRA')
      // The assistant reaches the same conclusion on its own
      const auto = newDraft(getFormation('4-3-3'), rules)
      autoDraft(u, auto, new Rng(`one-nation-auto-${i}`))
      expect(isComplete(auto)).toBe(true)
      for (const id of Object.values(auto.lineup)) expect(u.index[id].nationality).toBe('BRA')
    }
  })

  it('refuses a pick of another nationality and reports the nation by name', () => {
    const d = newDraft(getFormation('4-3-3'), rules)
    const rng = new Rng('one-nation-refuse')
    const cs = spin(u, d, rng)
    const foreigner = cs.squad.find((p) => p.nationality !== 'BRA')!
    expect(eligibleSlots(d, foreigner)).toEqual([])
    const slot = d.formation.slots.find((s) => canCover(foreigner, s.position, 'accomplished'))
    if (slot) expect(() => pick(u, d, foreigner.id, slot.id)).toThrow(`${foreigner.name} is not Brazil`)
    // Every club-season on a one-nation wheel holds at least one undrafted player of that nation
    for (const pool of wheelPool(u, d)) expect(pool.squad.some((p) => p.nationality === 'BRA')).toBe(true)
  })

  it('runs dry instead of throwing: autoDraft stops short and canSpin says so', () => {
    // A nation with players but no keeper at all cannot start a 4-3-3
    const keepersByNation = new Map<string, number>()
    for (const p of Object.values(u.index)) if (canCover(p, 'GK', 'accomplished')) keepersByNation.set(p.nationality, (keepersByNation.get(p.nationality) ?? 0) + 1)
    const nations = [...new Set(Object.values(u.index).map((p) => p.nationality))].filter((n) => n !== 'UNK' && !keepersByNation.has(n))
    expect(nations.length).toBeGreaterThan(0)
    const d = newDraft(getFormation('4-3-3'), { ...rules, onlyNation: nations[0] })
    const rng = new Rng('one-nation-dry')
    autoDraft(u, d, rng)
    expect(isComplete(d)).toBe(false)
    expect(canSpin(u, d)).toBe(false)
    expect(d.lineup['gk']).toBeUndefined()
    expect(() => spin(u, d, rng)).toThrow('Nothing left on the wheel')
  })
})
