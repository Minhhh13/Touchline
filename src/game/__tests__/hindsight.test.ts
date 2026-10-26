import { describe, expect, it } from 'vitest'
import { loadTestUniverse } from '../../engine/__tests__/helpers'
import { autoDraft, QUICK_RULES } from '@engine/draft'
import { ratingAt } from '@engine/positions'
import { Rng } from '@engine/rng'
import { createGame } from '../logic/setup'
import { playerLookup } from '../logic/players'
import { hindsightXI } from '../logic/hindsight'
import { draftRecap } from '../logic/draftRecap'
import type { GameSettings } from '../types'

const u = loadTestUniverse(['england'])

function quick(seed: string, formationId = '4-3-3', ratings: 'season' | 'prime' = 'season'): GameSettings {
  return { mode: 'quick', seed, formationId, teamName: 'Hindsight XI', shortName: 'HND', leagueId: 'england', wheelLeagues: ['england'], hostClubId: 'wolves', leagueSeason: 2020, rules: { ...QUICK_RULES, leagues: ['england'], ratings }, jobSecurity: false, difficulty: 'calibrated' }
}

function drafted(seed: string, formationId?: string, ratings?: 'season' | 'prime') {
  const g = createGame(quick(seed, formationId, ratings))
  autoDraft(u, g.draft!, Rng.fromState(g.rngState))
  return { g, d: g.draft!, get: playerLookup(g, u) }
}

describe('the Hindsight XI', () => {
  it('fills the slots you filled from the spins you had, one man each, never below your XI', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `hindsight-${i}`)
    let better = 0
    for (const seed of seeds) {
      // Season and Prime ratings, two shapes
      const { d, get } = drafted(seed, seed.endsWith('1') ? '4-4-2' : '4-3-3', Number(seed.split('-')[1]) % 2 ? 'prime' : 'season')
      const h = hindsightXI(u, d, get)!
      expect(h).not.toBeNull()
      const xiSpins = d.history.map((x, i) => ({ x, i })).filter(({ x }) => x.pickedId && x.slotId)
      // Every slot you filled once, every XI spin once
      expect(h.xi.map((p) => p.slotId).sort()).toEqual(xiSpins.map(({ x }) => x.slotId!).sort())
      expect(h.xi.map((p) => p.spin).sort((a, b) => a - b)).toEqual(xiSpins.map(({ i }) => i))
      // In the formation's slot order, no man twice
      const order = d.formation.slots.map((s) => s.id).filter((id) => h.xi.some((p) => p.slotId === id))
      expect(h.xi.map((p) => p.slotId)).toEqual(order)
      expect(new Set(h.xi.map((p) => get(p.id)!.playerId)).size).toBe(h.xi.length)
      for (const p of h.xi) {
        const row = d.history[p.spin]
        const squad = u.clubSeasonByKey[`${row.clubId}@${row.season}`].squad
        const man = get(p.id)!
        expect(squad.some((q) => q.id === p.id)).toBe(true)
        const pos = d.formation.slots.find((s) => s.id === p.slotId)!.position
        expect(p.rating).toBe(Math.round(ratingAt(man, pos)))
        // The best man that spin held for that slot
        for (const q of squad) if (!h.xi.some((o) => o !== p && get(o.id)!.playerId === q.playerId)) expect(Math.round(ratingAt(get(q.id)!, pos))).toBeLessThanOrEqual(p.rating)
        expect(p.yours).toBe(row.pickedId === p.id && row.slotId === p.slotId)
      }
      // No swap of two spins' slots does better (the search is exact)
      const rate = (spin: number, slotId: string) => {
        const row = d.history[spin]
        const pos = d.formation.slots.find((s) => s.id === slotId)!.position
        return Math.max(...u.clubSeasonByKey[`${row.clubId}@${row.season}`].squad.map((q) => Math.round(ratingAt(get(q.id)!, pos))))
      }
      for (const a of h.xi) for (const b of h.xi) if (a !== b) expect(rate(a.spin, b.slotId) + rate(b.spin, a.slotId)).toBeLessThanOrEqual(a.rating + b.rating)
      // Totals: one decimal, never below yours, the recap's XI rating is yours
      expect(h.rating).toBeGreaterThanOrEqual(h.yours)
      expect(h.gap).toBeCloseTo(h.rating - h.yours, 5)
      expect(h.kept).toBe(h.xi.filter((p) => p.yours).length)
      expect(draftRecap(u, d, get, true).xiRating).toBe(h.yours)
      if (h.gap > 0) better++
    }
    // Over many drafts the spins usually held a better XI than the auto-pick took
    expect(better).toBeGreaterThan(seeds.length / 2)
  }, 120_000)

  it('is pure: the same answer twice, and the draft untouched', () => {
    const { g, d, get } = drafted('hindsight-pure')
    const before = JSON.stringify(g)
    expect(hindsightXI(u, d, get)).toEqual(hindsightXI(u, d, get))
    expect(JSON.stringify(g)).toBe(before)
  })

  it('stays out of a capped or chained draft, and of a recap without grades', () => {
    const { d, get } = drafted('hindsight-rules')
    expect(hindsightXI(u, { ...d, rules: { ...d.rules, budget: 300 } }, get)).toBeNull()
    expect(hindsightXI(u, { ...d, rules: { ...d.rules, chain: true } }, get)).toBeNull()
    expect(draftRecap(u, d, get, false).hindsight).toBeNull()
    expect(draftRecap(u, d, get, true).hindsight).toEqual(hindsightXI(u, d, get))
  })

  it('keeps every pick when each spin gave its best man in the best slot', () => {
    const { d, get } = drafted('hindsight-keep')
    const h = hindsightXI(u, d, get)!
    // Rebuild the draft from the Hindsight XI itself: its hindsight is itself
    const history = d.history.map((row, i) => {
      const p = h.xi.find((x) => x.spin === i)
      return p ? { ...row, pickedId: p.id, slotId: p.slotId } : row
    })
    const again = hindsightXI(u, { ...d, history }, get)!
    expect(again.gap).toBe(0)
    expect(again.kept).toBe(h.xi.length)
    expect(again.rating).toBe(h.rating)
  })
})
